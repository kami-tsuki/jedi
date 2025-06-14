/**
 * System Monitoring Module
 *
 * This module provides real-time system monitoring functionality:
 * - CPU, memory, disk, and network usage monitoring
 * - Docker container management
 * - Process monitoring and management
 * - System logs viewing and filtering
 * - Charts and visualizations for system metrics
 */

const SystemMonitoring = (function() {
    'use strict';

    // Configuration
    const config = {
        refreshInterval: 60000, // Refresh data every 60 seconds
        chartUpdateInterval: 300000, // Update charts every 5 minutes
        endpoints: {
            system: '/api/monitoring/system',
            docker: '/api/monitoring/docker',
            logs: '/api/monitoring/logs',
            charts: {
                cpu: '/api/monitoring/charts/cpu',
                memory: '/api/monitoring/charts/memory',
                network: '/api/monitoring/charts/network',
                diskio: '/api/monitoring/charts/diskio'
            }
        }
    };

    // State
    const state = {
        activeTab: null,
        refreshTimer: null,
        chartUpdateTimer: null,

        // Store previous data for trend calculations
        previousData: {
            cpu: {
                total_cpu_usage: 0
            },
            memory: {
                percent: 0
            },
            network: {
                total_bytes_received: 0,
                total_bytes_sent: 0
            }
        }
    };

    /**
     * Initialize the monitoring functionality
     */
    function init() {
        // Set up tab navigation
        setupTabNavigation();

        // Initial data load
        loadAllData();

        // Set up image load event handlers
        setupImageLoadHandlers();

        // Add global refresh button handler
        document.getElementById('global-refresh')?.addEventListener('click', loadAllData);

        // Setup periodic data refresh
        state.refreshTimer = setInterval(loadAllData, config.refreshInterval);

        console.log('System monitoring initialized');
    }

    /**
     * Set up tab navigation functionality
     */
    function setupTabNavigation() {
        const tabLinks = document.querySelectorAll('.tab-link');
        if (tabLinks.length === 0) return;

        tabLinks.forEach(tab => {
            tab.addEventListener('click', function(event) {
                const tabName = this.getAttribute('data-tab');
                switchTab(event, tabName);
            });
        });

        // Open tab from URL hash if available
        if (location.hash) {
            const tabId = location.hash.substring(1);
            const tabLink = document.querySelector(`.tab-link[data-tab="${tabId}"]`);
            if (tabLink) {
                tabLink.click();
            } else {
                tabLinks[0].click(); // Default to first tab
            }
        } else {
            // Default to first tab
            tabLinks[0].click();
        }
    }

    /**
     * Switch between monitoring tabs
     * @param {Event} evt - Click event
     * @param {string} tabName - Name of tab to switch to
     */
    function switchTab(evt, tabName) {
        // Hide all tab content
        const tabcontent = document.getElementsByClassName("monitoring-tab-content");
        for (let i = 0; i < tabcontent.length; i++) {
            tabcontent[i].style.display = "none";
        }

        // Deactivate all tabs
        const tablinks = document.getElementsByClassName("tab-link");
        for (let i = 0; i < tablinks.length; i++) {
            tablinks[i].classList.remove("active");
        }

        // Show active tab content and highlight tab
        document.getElementById(tabName).style.display = "block";
        evt.currentTarget.classList.add("active");

        // Update URL hash for persistent tab state
        location.hash = tabName;

        // Remember active tab
        state.activeTab = tabName;

        // Refresh data for the selected tab
        switch(tabName) {
            case 'system-tab':
                loadSystemInfo();
                loadAllCharts();
                break;
            case 'docker-tab':
                loadDockerInfo();
                break;
            case 'processes-tab':
                loadSystemInfo();
                break;
            case 'logs-tab':
                loadSystemLogs();
                break;
        }
    }

    /**
     * Format bytes to human-readable format
     * @param {number} bytes - Byte value to format
     * @param {number} decimals - Number of decimal places (default: 2)
     * @returns {string} Formatted size string (e.g., "1.5 MB")
     */
    function formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';

        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    /**
     * Format uptime to human-readable format
     * @param {number} seconds - Uptime in seconds
     * @returns {string} Formatted uptime string (e.g., "2 days, 5 hours, 30 minutes")
     */
    function formatUptime(seconds) {
        const days = Math.floor(seconds / (3600*24));
        const hours = Math.floor(seconds % (3600*24) / 3600);
        const minutes = Math.floor(seconds % 3600 / 60);

        let result = '';
        if (days > 0) result += days + (days === 1 ? ' day, ' : ' days, ');
        if (hours > 0 || days > 0) result += hours + (hours === 1 ? ' hour, ' : ' hours, ');
        result += minutes + (minutes === 1 ? ' minute' : ' minutes');

        return result;
    }

    /**
     * Format date for detailed logs
     * @param {number} timestamp - Unix timestamp
     * @returns {string} Formatted date string
     */
    function formatDateTime(timestamp) {
        const date = new Date(timestamp * 1000);
        return date.toLocaleString();
    }

    /**
     * Show loading animation
     * @param {string} elementId - ID of chart element
     */
    function showLoading(elementId) {
        const container = document.querySelector(`#${elementId}`).closest('.card-body').querySelector('.chart-container');
        if (container) {
            const loadingOverlay = container.querySelector('.loading-overlay');
            if (loadingOverlay) {
                loadingOverlay.classList.add('active');
            }
        }
    }

    /**
     * Hide loading animation
     * @param {string} elementId - ID of chart element
     */
    function hideLoading(elementId) {
        const container = document.querySelector(`#${elementId}`).closest('.card-body').querySelector('.chart-container');
        if (container) {
            const loadingOverlay = container.querySelector('.loading-overlay');
            if (loadingOverlay) {
                loadingOverlay.classList.remove('active');
            }
        }
    }

    /**
     * Highlight updated element with animation
     * @param {Element} element - DOM element to highlight
     */
    function highlightUpdate(element) {
        if (element) {
            element.classList.add('highlight-update');
            setTimeout(() => {
                element.classList.remove('highlight-update');
            }, 1500);
        }
    }

    /**
     * Create a trend indicator based on previous and current values
     * @param {number} current - Current value
     * @param {number} previous - Previous value
     * @returns {string} HTML for trend indicator
     */
    function createTrendIndicator(current, previous) {
        if (previous === undefined || current === previous) {
            return '<span class="trend-neutral"><i class="fas fa-minus"></i></span>';
        } else if (current > previous) {
            return '<span class="trend-up"><i class="fas fa-arrow-up"></i></span>';
        } else {
            return '<span class="trend-down"><i class="fas fa-arrow-down"></i></span>';
        }
    }

    /**
     * Get usage class based on percentage
     * @param {number} percentage - Usage percentage
     * @returns {string} CSS class based on usage level
     */
    function getUsageClass(percentage) {
        if (percentage < 50) return 'usage-low';
        if (percentage < 80) return 'usage-medium';
        return 'usage-high';
    }

    /**
     * Format temperature value
     * @param {number|null} temp - Temperature value
     * @returns {string} Formatted temperature string
     */
    function formatTemperature(temp) {
        if (temp === null || temp === undefined) return 'N/A';
        return temp.toFixed(1) + '°C';
    }

    /**
     * Show notification
     * @param {string} message - Message to display
     * @param {string} type - Notification type (success, error, warning, info)
     */
    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
                <span>${message}</span>
            </div>
            <button class="notification-close" onclick="this.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        `;

        const container = document.getElementById('notification-container');
        if (!container) {
            const newContainer = document.createElement('div');
            newContainer.id = 'notification-container';
            document.body.appendChild(newContainer);
            newContainer.appendChild(notification);
        } else {
            container.appendChild(notification);
        }

        setTimeout(() => {
            notification.classList.add('show');
            setTimeout(() => {
                notification.classList.remove('show');
                setTimeout(() => notification.remove(), 300);
            }, 5000);
        }, 10);
    }

    /**
     * Load all monitoring data (system, docker, charts)
     */
    function loadAllData() {
        const refreshBtn = document.getElementById('global-refresh');
        if (refreshBtn) {
            refreshBtn.classList.add('loading');
        }

        loadSystemInfo();
        loadDockerInfo();
        loadAllCharts();

        // Hide loading animation after all data is fetched
        setTimeout(() => {
            if (refreshBtn) {
                refreshBtn.classList.remove('loading');
            }
        }, 1000);
    }

    /**
     * Load system information data
     */
    function loadSystemInfo() {
        fetch(config.endpoints.system)
            .then(response => response.json())
            .then(data => {
                updateSystemInfoUI(data);

                // Update previous data for trend calculations
                state.previousData = {
                    cpu: {
                        total_cpu_usage: data.cpu.total_cpu_usage
                    },
                    memory: {
                        percent: data.memory.percent
                    },
                    network: {
                        total_bytes_received: data.network.total_bytes_received,
                        total_bytes_sent: data.network.total_bytes_sent
                    }
                };
            })
            .catch(error => console.error('Error fetching system info:', error));
    }

    /**
     * Update system information UI with data
     * @param {Object} data - System information data from API
     */
    function updateSystemInfoUI(data) {
        // System info
        document.getElementById('platform').textContent = data.system.platform;
        document.getElementById('python-version').textContent = data.system.python_version;
        document.getElementById('uptime').textContent = formatUptime(data.system.uptime_seconds);

        // Add boot time
        if (data.system.boot_time) {
            document.getElementById('boot-time').textContent = formatDateTime(data.system.boot_time);
        }

        // Add hostname
        if (data.system.hostname) {
            document.getElementById('hostname').textContent = data.system.hostname;
        }

        // Add OS details
        if (data.system.os_info) {
            document.getElementById('os-version').textContent = data.system.os_info;
        }

        // CPU info
        document.getElementById('physical-cores').textContent = data.cpu.physical_cores;
        document.getElementById('logical-cores').textContent = data.cpu.total_cores;
        document.getElementById('cpu-frequency').textContent = data.cpu.current_frequency + ' MHz';

        // Add CPU model
        if (data.cpu.model) {
            document.getElementById('cpu-model').textContent = data.cpu.model;
        }

        const totalCpuElement = document.getElementById('total-cpu-usage');
        totalCpuElement.textContent = data.cpu.total_cpu_usage + '%';
        totalCpuElement.className = 'metric-value ' + getUsageClass(data.cpu.total_cpu_usage);

        // Add trend indicator for CPU usage
        const cpuTrendElement = document.getElementById('cpu-trend');
        if (cpuTrendElement) {
            cpuTrendElement.innerHTML = createTrendIndicator(data.cpu.total_cpu_usage, state.previousData.cpu.total_cpu_usage);
        }

        highlightUpdate(totalCpuElement);

        // Add CPU temperature if available
        if (data.cpu.temperature && document.getElementById('cpu-temperature')) {
            document.getElementById('cpu-temperature').textContent = formatTemperature(data.cpu.temperature);
            highlightUpdate(document.getElementById('cpu-temperature'));
        }

        // Add detailed per-core usage
        if (data.cpu.per_core_usage && document.getElementById('core-usage-container')) {
            const coreContainer = document.getElementById('core-usage-container');
            coreContainer.innerHTML = '';

            data.cpu.per_core_usage.forEach((usage, index) => {
                const coreDiv = document.createElement('div');
                coreDiv.className = 'core-usage';

                const usageClass = getUsageClass(usage);
                coreDiv.innerHTML = `
                    <span class="core-label">Core ${index}</span>
                    <div class="progress-container">
                        <div class="progress-bar ${usage > 85 ? 'danger' : usage > 70 ? 'warning' : ''}"
                             style="width: ${usage}%"></div>
                    </div>
                    <span class="${usageClass}">${usage.toFixed(1)}%</span>
                `;
                coreContainer.appendChild(coreDiv);
            });
        }

        // Memory info
        document.getElementById('total-memory').textContent = formatBytes(data.memory.total);
        document.getElementById('used-memory').textContent = formatBytes(data.memory.used);
        document.getElementById('available-memory').textContent = formatBytes(data.memory.available);

        const memoryPercentElement = document.getElementById('memory-percent');
        memoryPercentElement.textContent = data.memory.percent + '%';
        memoryPercentElement.className = 'metric-value ' + getUsageClass(data.memory.percent);

        // Add trend indicator for memory usage
        const memoryTrendElement = document.getElementById('memory-trend');
        if (memoryTrendElement) {
            memoryTrendElement.innerHTML = createTrendIndicator(data.memory.percent, state.previousData.memory.percent);
        }

        highlightUpdate(memoryPercentElement);

        // Add swap memory information
        if (data.memory.swap && document.getElementById('swap-total')) {
            document.getElementById('swap-total').textContent = formatBytes(data.memory.swap.total);
            document.getElementById('swap-used').textContent = formatBytes(data.memory.swap.used);
            document.getElementById('swap-free').textContent = formatBytes(data.memory.swap.free);

            const swapPercentElement = document.getElementById('swap-percent');
            if (swapPercentElement) {
                swapPercentElement.textContent = data.memory.swap.percent + '%';
                swapPercentElement.className = 'metric-value ' + getUsageClass(data.memory.swap.percent);
                highlightUpdate(swapPercentElement);
            }
        }

        // Update disk info
        updateDiskInfo(data.disk);

        // Update network info
        updateNetworkInfo(data.network);

        // Load system processes if available
        if (data.processes && document.getElementById('system-processes')) {
            loadProcessTable(data.processes);
        }
    }

    /**
     * Update disk information UI with data
     * @param {Array} diskData - Disk information data
     */
    function updateDiskInfo(diskData) {
        const diskTableBody = document.getElementById('disk-stats');
        if (!diskTableBody) return;

        diskTableBody.innerHTML = '';

        if (diskData.length === 0) {
            const row = document.createElement('tr');
            row.innerHTML = '<td colspan="8" class="text-center">No disk information available</td>';
            diskTableBody.appendChild(row);
        } else {
            diskData.forEach(disk => {
                const row = document.createElement('tr');
                const usageClass = getUsageClass(disk.percent);

                row.innerHTML = `
                    <td>${disk.device}</td>
                    <td>${disk.mountpoint}</td>
                    <td>${disk.fstype || 'N/A'}</td>
                    <td>${formatBytes(disk.total_size)}</td>
                    <td>${formatBytes(disk.used)}</td>
                    <td>${formatBytes(disk.free)}</td>
                    <td>
                        <div class="progress-container">
                            <div class="progress-bar ${disk.percent > 85 ? 'danger' : disk.percent > 70 ? 'warning' : ''}"
                                 style="width: ${disk.percent}%"></div>
                        </div>
                        <span class="${usageClass}">${disk.percent}%</span>
                    </td>
                    <td>${disk.read_write_stats ? disk.read_write_stats : 'N/A'}</td>
                `;
                diskTableBody.appendChild(row);
            });
        }
    }

    /**
     * Update network information UI with data
     * @param {Object} networkData - Network information data
     */
    function updateNetworkInfo(networkData) {
        // Update totals
        document.getElementById('total-bytes-received').textContent = formatBytes(networkData.total_bytes_received);
        document.getElementById('total-bytes-sent').textContent = formatBytes(networkData.total_bytes_sent);

        // Add network trends
        const networkReceivedTrendElement = document.getElementById('received-trend');
        if (networkReceivedTrendElement) {
            networkReceivedTrendElement.innerHTML = createTrendIndicator(
                networkData.total_bytes_received,
                state.previousData.network.total_bytes_received
            );
        }

        const networkSentTrendElement = document.getElementById('sent-trend');
        if (networkSentTrendElement) {
            networkSentTrendElement.innerHTML = createTrendIndicator(
                networkData.total_bytes_sent,
                state.previousData.network.total_bytes_sent
            );
        }

        // Update network interfaces table
        const networkTableBody = document.getElementById('network-stats');
        if (!networkTableBody) return;

        networkTableBody.innerHTML = '';

        if (Object.keys(networkData.interfaces).length === 0) {
            const row = document.createElement('tr');
            row.innerHTML = '<td colspan="7" class="text-center">No network interfaces available</td>';
            networkTableBody.appendChild(row);
        } else {
            for (const [_interface, stats] of Object.entries(networkData.interfaces)) {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${_interface}</td>
                    <td>${formatBytes(stats.bytes_sent)}</td>
                    <td>${formatBytes(stats.bytes_received)}</td>
                    <td>${stats.packets_sent.toLocaleString()}</td>
                    <td>${stats.packets_received.toLocaleString()}</td>
                    <td>${stats.errors || 0}</td>
                    <td>${stats.dropin || 0 + stats.dropout || 0}</td>
                `;
                networkTableBody.appendChild(row);
                highlightUpdate(row);
            }
        }
    }

    /**
     * Load process information into the table
     * @param {Array} processes - Process information data
     */
    function loadProcessTable(processes) {
        const processTableBody = document.getElementById('process-tbody');
        if (!processTableBody) return;

        processTableBody.innerHTML = '';

        // Sort processes by CPU usage
        processes.sort((a, b) => b.cpu_percent - a.cpu_percent);

        // Display top 20 processes
        processes.slice(0, 20).forEach(proc => {
            const row = document.createElement('tr');
            const cpuClass = getUsageClass(proc.cpu_percent);
            const memClass = getUsageClass(proc.memory_percent);

            row.innerHTML = `
                <td>${proc.pid}</td>
                <td title="${proc.cmdline}">${proc.name}</td>
                <td>${proc.username || 'N/A'}</td>
                <td class="${cpuClass}">${proc.cpu_percent.toFixed(1)}%</td>
                <td class="${memClass}">${proc.memory_percent.toFixed(1)}%</td>
                <td>${formatBytes(proc.memory_rss)}</td>
                <td>${formatUptime(proc.running_time || 0)}</td>
                <td>${proc.status || 'unknown'}</td>
            `;
            processTableBody.appendChild(row);
        });
    }

    /**
     * Load Docker information data
     */
    function loadDockerInfo() {
        fetch(config.endpoints.docker)
            .then(response => response.json())
            .then(data => {
                updateDockerUI(data);
            })
            .catch(error => console.error('Error fetching Docker info:', error));
    }

    /**
     * Update Docker information UI with data
     * @param {Object} data - Docker information data from API
     */
    function updateDockerUI(data) {
        if (data.error) {
            document.getElementById('docker-status').innerHTML = `
                <div class="alert-message">
                    Docker information is not available: ${data.error}
                </div>
            `;
            document.getElementById('docker-table').style.display = 'none';
            return;
        }

        document.getElementById('total-containers').textContent = data.total;
        document.getElementById('running-containers').textContent = data.running;

        // Add additional Docker stats if available
        if (data.version && document.getElementById('docker-version')) {
            document.getElementById('docker-version').textContent = data.version;
        }

        if (data.api_version && document.getElementById('docker-api-version')) {
            document.getElementById('docker-api-version').textContent = data.api_version;
        }

        if (data.images && document.getElementById('docker-images')) {
            document.getElementById('docker-images').textContent = data.images;
        }

        const dockerTableBody = document.getElementById('docker-stats');
        if (!dockerTableBody) return;

        dockerTableBody.innerHTML = '';

        if (data.containers.length === 0) {
            const row = document.createElement('tr');
            row.innerHTML = '<td colspan="9" class="text-center">No containers available</td>';
            dockerTableBody.appendChild(row);
        } else {
            data.containers.forEach(container => {
                const row = document.createElement('tr');
                let statusClass = 'container-other';

                if (container.status === 'running') {
                    statusClass = 'container-running';
                } else if (container.status === 'exited') {
                    statusClass = 'container-exited';
                }

                // Calculate uptime if available
                let uptimeStr = 'N/A';
                if (container.created && container.status === 'running') {
                    const createdTime = new Date(container.created * 1000);
                    const now = new Date();
                    const uptimeSeconds = Math.floor((now - createdTime) / 1000);
                    uptimeStr = formatUptime(uptimeSeconds);
                }

                row.innerHTML = `
                    <td>${container.id}</td>
                    <td>${container.name}</td>
                    <td>${container.image}</td>
                    <td>
                        <span class="status-dot status-${container.status === 'running' ? 'running' : container.status === 'exited' ? 'error' : 'stopped'}"></span>
                        <span class="${statusClass}">${container.status}</span>
                    </td>
                    <td>${container.cpu_percent ? container.cpu_percent.toFixed(2) + '%' : 'N/A'}</td>
                    <td>${container.memory_percent ? container.memory_percent.toFixed(2) + '%' : 'N/A'}</td>
                    <td>${container.memory_usage ? formatBytes(container.memory_usage) : 'N/A'}</td>
                    <td>${uptimeStr}</td>
                    <td>
                        <button class="action-btn" onclick="SystemMonitoring.containerAction('${container.id}', '${container.status === 'running' ? 'stop' : 'start'}')">
                            <i class="fas fa-${container.status === 'running' ? 'stop' : 'play'}"></i>
                        </button>
                        <button class="action-btn" onclick="SystemMonitoring.containerAction('${container.id}', 'restart')">
                            <i class="fas fa-sync-alt"></i>
                        </button>
                    </td>
                `;
                dockerTableBody.appendChild(row);
                highlightUpdate(row);
            });
        }
    }

    /**
     * Container action function (start, stop, restart)
     * @param {string} containerId - Docker container ID
     * @param {string} action - Action to perform (start, stop, restart)
     */
    function containerAction(containerId, action) {
        const actionBtn = event.currentTarget;
        actionBtn.disabled = true;
        actionBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        fetch(`/api/monitoring/docker/${containerId}/${action}`, {
            method: 'POST'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showNotification(`Container ${action} successful`, 'success');
                setTimeout(() => loadDockerInfo(), 1000);
            } else {
                showNotification(`Failed to ${action} container: ${data.error}`, 'error');
                actionBtn.disabled = false;
                actionBtn.innerHTML = `<i class="fas fa-${action === 'stop' ? 'stop' : action === 'start' ? 'play' : 'sync-alt'}"></i>`;
            }
        })
        .catch(error => {
            console.error(`Error during container ${action}:`, error);
            showNotification(`Error during container ${action}`, 'error');
            actionBtn.disabled = false;
            actionBtn.innerHTML = `<i class="fas fa-${action === 'stop' ? 'stop' : action === 'start' ? 'play' : 'sync-alt'}"></i>`;
        });
    }

    /**
     * Load system logs
     */
    function loadSystemLogs() {
        const logsContainer = document.getElementById('logs-container');
        if (!logsContainer) return;

        logsContainer.innerHTML = '<div class="loading-spinner centered"></div>';

        fetch(config.endpoints.logs)
            .then(response => response.json())
            .then(data => {
                updateLogsUI(data, logsContainer);
            })
            .catch(error => {
                console.error('Error fetching system logs:', error);
                logsContainer.innerHTML = '<div class="alert-message">Failed to load system logs</div>';
            });
    }

    /**
     * Update logs UI with data
     * @param {Object} data - Logs data from API
     * @param {HTMLElement} logsContainer - Container element for logs
     */
    function updateLogsUI(data, logsContainer) {
        if (data.error) {
            logsContainer.innerHTML = `
                <div class="alert-message">
                    System logs are not available: ${data.error}
                </div>
            `;
            return;
        }

        logsContainer.innerHTML = '';

        if (!data.logs || data.logs.length === 0) {
            logsContainer.innerHTML = '<div class="alert-message">No logs available</div>';
            return;
        }

        // Create log filter controls
        const filterContainer = document.createElement('div');
        filterContainer.className = 'log-filters';
        filterContainer.innerHTML = `
            <div class="filter-group">
                <label>Log Level:</label>
                <select id="log-level-filter" onchange="SystemMonitoring.filterLogs()">
                    <option value="all">All Levels</option>
                    <option value="error">Error</option>
                    <option value="warning">Warning</option>
                    <option value="info">Info</option>
                    <option value="debug">Debug</option>
                </select>
            </div>
            <div class="filter-group">
                <label>Search:</label>
                <input type="text" id="log-search" placeholder="Filter logs..." oninput="SystemMonitoring.filterLogs()">
            </div>
            <div class="filter-group">
                <button onclick="SystemMonitoring.refreshLogs()" class="refresh-btn-sm">
                    <i class="fas fa-sync-alt"></i> Refresh
                </button>
            </div>
        `;
        logsContainer.appendChild(filterContainer);

        // Create logs list
        const logsList = document.createElement('div');
        logsList.className = 'logs-list';

        data.logs.forEach(log => {
            const logEntry = document.createElement('div');
            logEntry.className = `log-entry log-level-${log.level}`;

            logEntry.innerHTML = `
                <div class="log-timestamp">${log.timestamp}</div>
                <div class="log-level">${log.level}</div>
                <div class="log-source">${log.source}</div>
                <div class="log-message">${log.message}</div>
            `;

            logsList.appendChild(logEntry);
        });

        logsContainer.appendChild(logsList);
    }

    /**
     * Filter logs based on level and search term
     */
    function filterLogs() {
        const levelFilter = document.getElementById('log-level-filter').value;
        const searchTerm = document.getElementById('log-search').value.toLowerCase();

        const logEntries = document.querySelectorAll('.log-entry');

        logEntries.forEach(entry => {
            const level = entry.querySelector('.log-level').textContent.toLowerCase();
            const text = entry.textContent.toLowerCase();

            const levelMatch = levelFilter === 'all' || level === levelFilter;
            const searchMatch = searchTerm === '' || text.includes(searchTerm);

            entry.style.display = levelMatch && searchMatch ? 'grid' : 'none';
        });
    }

    /**
     * Refresh logs data
     */
    function refreshLogs() {
        loadSystemLogs();
    }

    /**
     * Set up image load event handlers
     */
    function setupImageLoadHandlers() {
        // CPU chart
        document.getElementById('cpu-chart')?.addEventListener('load', function() {
            hideLoading('cpu-chart');
        });

        // Memory chart
        document.getElementById('memory-chart')?.addEventListener('load', function() {
            hideLoading('memory-chart');
        });

        // Network chart
        document.getElementById('network-chart')?.addEventListener('load', function() {
            hideLoading('network-chart');
        });

        // Disk IO chart
        document.getElementById('diskio-chart')?.addEventListener('load', function() {
            hideLoading('diskio-chart');
        });
    }

    /**
     * Load CPU chart
     */
    function loadCpuChart() {
        showLoading('cpu-chart');
        fetch(config.endpoints.charts.cpu)
            .then(response => response.json())
            .then(data => {
                document.getElementById('cpu-chart').src = data.image;
            })
            .catch(error => {
                console.error('Error fetching CPU chart:', error);
                hideLoading('cpu-chart');
            });
    }

    /**
     * Load memory chart
     */
    function loadMemoryChart() {
        showLoading('memory-chart');
        fetch(config.endpoints.charts.memory)
            .then(response => response.json())
            .then(data => {
                document.getElementById('memory-chart').src = data.image;
            })
            .catch(error => {
                console.error('Error fetching memory chart:', error);
                hideLoading('memory-chart');
            });
    }

    /**
     * Load network chart
     */
    function loadNetworkChart() {
        showLoading('network-chart');
        fetch(config.endpoints.charts.network)
            .then(response => response.json())
            .then(data => {
                document.getElementById('network-chart').src = data.image;
            })
            .catch(error => {
                console.error('Error fetching network chart:', error);
                hideLoading('network-chart');
            });
    }

    /**
     * Load disk IO chart
     */
    function loadDiskIOChart() {
        showLoading('diskio-chart');
        fetch(config.endpoints.charts.diskio)
            .then(response => response.json())
            .then(data => {
                document.getElementById('diskio-chart').src = data.image;
            })
            .catch(error => {
                console.error('Error fetching disk IO chart:', error);
                hideLoading('diskio-chart');
            });
    }

    /**
     * Load all charts at once
     */
    function loadAllCharts() {
        loadCpuChart();
        loadMemoryChart();
        loadNetworkChart();
        loadDiskIOChart();
    }

    // Clean up when page is unloaded
    function destroy() {
        if (state.refreshTimer) {
            clearInterval(state.refreshTimer);
            state.refreshTimer = null;
        }

        if (state.chartUpdateTimer) {
            clearInterval(state.chartUpdateTimer);
            state.chartUpdateTimer = null;
        }
    }

    // Public API
    return {
        init,
        loadAllData,
        loadSystemInfo,
        loadDockerInfo,
        loadSystemLogs,
        refreshLogs,
        filterLogs,
        containerAction,
        loadAllCharts,
        destroy
    };
})();

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    SystemMonitoring.init();

    // Clean up when page is unloaded
    window.addEventListener('beforeunload', SystemMonitoring.destroy);
});
/*-神-*/