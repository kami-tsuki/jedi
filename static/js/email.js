/**
 * EmailClient - Modern, immersive email client with dynamic content loading
 *
 * This script handles all client-side functionality for the email client:
 * - Asynchronous loading of folders, emails, and email content
 * - Dynamic navigation without page reloads
 * - Collapsible folder hierarchies
 * - Real-time content updates
 * - Modal dialogs for compose and settings
 * - Comprehensive error handling
 */

const EmailClient = (function() {
    // Configuration and state
    let config = {
        folder: 'INBOX',
        search: '',
        page: 1,
        emailsPerPage: 20,
        csrfToken: null
    };

    let state = {
        selectedEmailId: null,
        folders: [],
        currentEmails: [],
        totalEmails: 0,
        totalPages: 1,
        loading: {
            folders: false,
            emails: false,
            content: false
        },
        error: {
            folders: null,
            emails: null,
            content: null
        },
        retries: {
            folders: 0,
            emails: 0,
            content: 0
        },
        maxRetries: 3
    };

    // Cached DOM elements
    let elements = {};

    /**
     * Initialize the email client
     */
    function init(options = {}) {
        // Merge options with default config
        config = { ...config, ...options };

        // Initialize CSRF token from meta tag
        const csrfMeta = document.querySelector('meta[name="csrf-token"]');
        if (csrfMeta) {
            config.csrfToken = csrfMeta.getAttribute('content');
        } else {
            console.warn('CSRF token meta tag not found. AJAX operations may fail.');
        }

        // Cache DOM elements
        cacheElements();

        // Set up event listeners
        setupEventListeners();

        // Set up global AJAX error handling
        setupAjaxErrorHandling();

        // Load initial data
        loadFolders();
        loadEmails();

        // Update URL to reflect current state
        updateUrl();

        console.log('Email client initialized with config:', config);
    }

    /**
     * Cache frequently accessed DOM elements
     */
    function cacheElements() {
        elements = {
            folderTree: document.getElementById('folderTree'),
            emailList: document.getElementById('emailList'),
            emailContent: document.getElementById('emailContent'),
            emailPagination: document.getElementById('emailPagination'),
            currentFolderName: document.getElementById('currentFolderName'),
            searchForm: document.getElementById('searchForm'),
            searchInput: document.getElementById('searchInput'),
            refreshFolders: document.getElementById('refreshFolders'),
            refreshEmails: document.getElementById('refreshEmails'),
            composeButton: document.getElementById('composeButton'),
            settingsButton: document.getElementById('settingsButton'),
            composeModal: document.getElementById('composeModal'),
            closeComposeModal: document.getElementById('closeComposeModal'),
            composeContainer: document.getElementById('composeContainer'),
            settingsModal: document.getElementById('settingsModal'),
            closeSettingsModal: document.getElementById('closeSettingsModal'),
            settingsContainer: document.getElementById('settingsContainer'),
            deleteModal: document.getElementById('deleteModal'),
            closeDeleteModal: document.getElementById('closeDeleteModal'),
            confirmDeleteBtn: document.getElementById('confirmDeleteBtn'),
            cancelDeleteBtn: document.getElementById('cancelDeleteBtn')
        };
    }

    /**
     * Set up event listeners for user interactions
     */
    function setupEventListeners() {
        // Search form submission
        if (elements.searchForm) {
            elements.searchForm.addEventListener('submit', function(e) {
                e.preventDefault();
                const searchValue = elements.searchInput.value.trim();
                searchEmails(searchValue);
            });
        }

        // Refresh buttons
        if (elements.refreshFolders) {
            elements.refreshFolders.addEventListener('click', function(e) {
                e.preventDefault();
                loadFolders();
            });
        }

        if (elements.refreshEmails) {
            elements.refreshEmails.addEventListener('click', function(e) {
                e.preventDefault();
                loadEmails(config.folder, config.page, config.search);
            });
        }

        // Compose button
        if (elements.composeButton) {
            elements.composeButton.addEventListener('click', function(e) {
                e.preventDefault();
                openComposeModal();
            });
        }

        // Settings button
        if (elements.settingsButton) {
            elements.settingsButton.addEventListener('click', function(e) {
                e.preventDefault();
                openSettingsModal();
            });
        }

        // Modal close buttons
        if (elements.closeComposeModal) {
            elements.closeComposeModal.addEventListener('click', closeComposeModal);
        }

        if (elements.closeSettingsModal) {
            elements.closeSettingsModal.addEventListener('click', closeSettingsModal);
        }

        if (elements.closeDeleteModal) {
            elements.closeDeleteModal.addEventListener('click', closeDeleteModal);
        }

        // Delete email confirmation
        if (elements.confirmDeleteBtn) {
            elements.confirmDeleteBtn.addEventListener('click', confirmDeleteEmail);
        }

        if (elements.cancelDeleteBtn) {
            elements.cancelDeleteBtn.addEventListener('click', closeDeleteModal);
        }

        // Handle escape key for modals
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                if (elements.composeModal.style.display === 'flex') closeComposeModal();
                if (elements.settingsModal.style.display === 'flex') closeSettingsModal();
                if (elements.deleteModal.style.display === 'flex') closeDeleteModal();
            }
        });

        // Window popstate handler (for browser back/forward)
        window.addEventListener('popstate', function(e) {
            if (e.state && e.state.folder) {
                // Don't trigger another history update
                navigateToFolder(e.state.folder, e.state.page || 1, e.state.search || '', false);
            }
        });
    }

    /**
     * Set up global AJAX error handling
     */
    function setupAjaxErrorHandling() {
        window.addEventListener('unhandledrejection', function(event) {
            console.error('Unhandled Promise Rejection:', event.reason);

            // Show a user-friendly error toast
            showToast('An error occurred. Please try again later.', 'error');
        });
    }

    /**
     * Create a fetch request with standard headers and error handling
     * @param {string} url - The URL to fetch
     * @param {Object} options - Fetch options
     * @returns {Promise} - Fetch promise with consistent error handling
     */
    async function safeFetch(url, options = {}) {
        // Add default headers
        const headers = {
            'X-Requested-With': 'XMLHttpRequest',
            ...options.headers || {}
        };

        // Add CSRF token for non-GET requests
        if (options.method && options.method !== 'GET') {
            // Try to get CSRF token from meta tag
            if (!config.csrfToken) {
                const csrfMeta = document.querySelector('meta[name="csrf-token"]');
                if (csrfMeta) {
                    config.csrfToken = csrfMeta.getAttribute('content');
                }
            }

            // Add token if available
            if (config.csrfToken) {
                headers['X-CSRFToken'] = config.csrfToken;
            } else {
                // Get CSRF token from cookie as a fallback
                const csrfCookie = document.cookie.split('; ').find(row => row.startsWith('csrf_token='));
                if (csrfCookie) {
                    const csrfToken = csrfCookie.split('=')[1];
                    headers['X-CSRFToken'] = csrfToken;
                    config.csrfToken = csrfToken; // Cache for future requests
                }
            }
        }

        // Add cookies for CSRF validation
        options.credentials = 'same-origin';
        options.headers = headers;

        try {
            const response = await fetch(url, options);

            // Handle HTTP error status
            if (!response.ok) {
                // Handle specific error codes
                if (response.status === 401) {
                    // Unauthorized - redirect to login
                    window.location.href = '/auth/login?next=' + encodeURIComponent(window.location.pathname);
                    return Promise.reject(new Error('Authentication required'));
                } else if (response.status === 403) {
                    // Forbidden - likely CSRF error
                    showToast('Session expired. Please refresh the page.', 'error');
                    return Promise.reject(new Error('CSRF validation failed'));
                } else if (response.status === 429) {
                    // Rate limited
                    showToast('Too many requests. Please try again later.', 'warning');
                    return Promise.reject(new Error('Rate limit exceeded'));
                } else {
                    // Try to parse error message from response
                    try {
                        const errorData = await response.json();
                        return Promise.reject(new Error(errorData.error || `HTTP error ${response.status}`));
                    } catch (parseError) {
                        return Promise.reject(new Error(`HTTP error ${response.status}`));
                    }
                }
            }

            return response;
        } catch (error) {
            // Network or other fetch errors
            console.error('Fetch error:', error);

            // Enhance error with more context
            const enhancedError = new Error(`Network error: ${error.message}`);
            enhancedError.originalError = error;
            return Promise.reject(enhancedError);
        }
    }

    /**
     * Show toast notification
     * @param {string} message - Message to display
     * @param {string} type - Type of toast (success, error, warning, info)
     */
    function showToast(message, type = 'info') {
        // Create toast container if it doesn't exist
        let toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            document.body.appendChild(toastContainer);

            // Add styles for toast container
            toastContainer.style.position = 'fixed';
            toastContainer.style.bottom = '20px';
            toastContainer.style.right = '20px';
            toastContainer.style.zIndex = '9999';
        }

        // Create toast element
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;

        // Style the toast
        toast.style.padding = '12px 20px';
        toast.style.marginTop = '10px';
        toast.style.backgroundColor =
            type === 'success' ? '#4caf50' :
            type === 'error' ? '#f44336' :
            type === 'warning' ? '#ff9800' : '#2196f3';
        toast.style.color = 'white';
        toast.style.borderRadius = '4px';
        toast.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';

        // Add to container
        toastContainer.appendChild(toast);

        // Trigger animation
        setTimeout(() => { toast.style.opacity = '1'; }, 10);

        // Remove after delay
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                if (toastContainer.contains(toast)) {
                    toastContainer.removeChild(toast);
                }
            }, 300);
        }, 4000);
    }

    /**
     * Load and render the folder tree
     */
    function loadFolders() {
        if (state.loading.folders) return;

        state.loading.folders = true;
        state.error.folders = null;

        // Show loading indicator
        elements.folderTree.innerHTML = `
            <li class="folder-item loading">
                <i class="fas fa-circle-notch fa-spin"></i> Loading folders...
            </li>
        `;

        // Add spinning class to refresh icon if it exists
        if (elements.refreshFolders) {
            elements.refreshFolders.classList.add('spinning');
        }

        // Fetch folder tree HTML from server
        safeFetch(`/email/api/folders/render?active_folder=${encodeURIComponent(config.folder)}`)
            .then(response => response.json())
            .then(data => {
                // Update folder tree with HTML from server
                elements.folderTree.innerHTML = data.html;

                // Set up folder item click handlers
                setupFolderItemHandlers();

                // Remove spinning class from refresh icon
                if (elements.refreshFolders) {
                    elements.refreshFolders.classList.remove('spinning');
                }

                state.loading.folders = false;
                state.retries.folders = 0; // Reset retry counter on success
            })
            .catch(error => {
                console.error('Error loading folders:', error);

                // Retry logic
                if (state.retries.folders < state.maxRetries) {
                    state.retries.folders++;
                    console.log(`Retrying folder load (${state.retries.folders}/${state.maxRetries})...`);
                    setTimeout(loadFolders, 1000 * state.retries.folders); // Increasing delay for each retry
                    return;
                }

                state.error.folders = error;
                elements.folderTree.innerHTML = `
                    <li class="folder-item error">
                        <i class="fas fa-exclamation-circle"></i> Failed to load folders
                        <button class="retry-btn" onclick="EmailClient.loadFolders()">Retry</button>
                    </li>
                `;

                if (elements.refreshFolders) {
                    elements.refreshFolders.classList.remove('spinning');
                }

                state.loading.folders = false;
                showToast('Failed to load folders. Please try again.', 'error');
            });
    }

    /**
     * Set up event handlers for folder items
     */
    function setupFolderItemHandlers() {
        const folderItems = elements.folderTree.querySelectorAll('.folder-item');

        folderItems.forEach(item => {
            const folderPath = item.getAttribute('data-folder');
            const folderName = item.querySelector('.folder-name');
            const toggleBtn = item.querySelector('.folder-toggle');

            // Folder name click (navigate to folder)
            if (folderName) {
                folderName.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    navigateToFolder(folderPath);
                });
            }

            // Toggle button click (expand/collapse)
            if (toggleBtn) {
                toggleBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();

                    const isExpanded = toggleBtn.classList.contains('expanded');
                    const subfolderList = item.querySelector('.subfolder-list');
                    const toggleIcon = toggleBtn.querySelector('i');

                    if (isExpanded) {
                        // Collapse
                        toggleBtn.classList.remove('expanded');
                        if (subfolderList) {
                            subfolderList.classList.replace('visible', 'hidden');
                        }
                        if (toggleIcon) {
                            toggleIcon.classList.replace('fa-chevron-down', 'fa-chevron-right');
                        }
                    } else {
                        // Expand
                        toggleBtn.classList.add('expanded');
                        if (subfolderList) {
                            subfolderList.classList.replace('hidden', 'visible');
                        }
                        if (toggleIcon) {
                            toggleIcon.classList.replace('fa-chevron-right', 'fa-chevron-down');
                        }
                    }
                });
            }
        });
    }

    /**
     * Navigate to a specific folder
     */
    function navigateToFolder(folderPath, page = 1, search = '', updateHistory = true) {
        if (folderPath === config.folder && page === config.page && search === config.search) {
            // Already in this folder with same parameters, just refresh
            loadEmails(folderPath, page, search);
            return;
        }

        // Update config
        config.folder = folderPath;
        config.page = page;
        config.search = search;

        // Update UI
        if (elements.currentFolderName) {
            elements.currentFolderName.textContent = folderPath;
        }

        if (elements.searchInput) {
            elements.searchInput.value = search;
        }

        // Load emails for the new folder
        loadEmails();

        // Clear email content
        showEmailPlaceholder();

        // Update URL
        if (updateHistory) {
            updateUrl();
        }

        // Update folder tree active state
        updateFolderActiveState(folderPath);
    }

    /**
     * Update the active state in the folder tree
     */
    function updateFolderActiveState(activeFolderPath) {
        const folderItems = elements.folderTree.querySelectorAll('.folder-item');

        folderItems.forEach(item => {
            const folderPath = item.getAttribute('data-folder');

            if (folderPath === activeFolderPath) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    /**
     * Load and render emails for the current folder
     */
    function loadEmails(folder = config.folder, page = config.page, search = config.search) {
        if (state.loading.emails) return;

        state.loading.emails = true;
        state.error.emails = null;

        // Update config
        config.folder = folder;
        config.page = page;
        config.search = search;

        // Show loading indicator
        elements.emailList.innerHTML = `
            <div class="loading-indicator">
                <i class="fas fa-circle-notch fa-spin"></i>
                <span>Loading emails...</span>
            </div>
        `;

        // Clear pagination
        if (elements.emailPagination) {
            elements.emailPagination.innerHTML = '';
        }

        // Add spinning class to refresh icon if it exists
        if (elements.refreshEmails) {
            elements.refreshEmails.classList.add('spinning');
        }

        // Build query parameters
        const params = new URLSearchParams({
            folder: folder,
            page: page,
            limit: config.emailsPerPage,
            search: search
        });

        // Fetch emails HTML from server
        safeFetch(`/email/api/emails/render?${params}`)
            .then(response => response.json())
            .then(data => {
                // Update emails list with HTML from server
                elements.emailList.innerHTML = data.html;

                // Update state
                state.totalEmails = data.total;
                state.totalPages = data.pages;

                // Render pagination
                renderPagination(data.page, data.pages);

                // Set up email item click handlers
                setupEmailItemHandlers();

                // Remove spinning class from refresh icon
                if (elements.refreshEmails) {
                    elements.refreshEmails.classList.remove('spinning');
                }

                state.loading.emails = false;
                state.retries.emails = 0; // Reset retry counter on success

                // Update URL
                updateUrl();
            })
            .catch(error => {
                console.error('Error loading emails:', error);

                // Retry logic
                if (state.retries.emails < state.maxRetries) {
                    state.retries.emails++;
                    console.log(`Retrying email load (${state.retries.emails}/${state.maxRetries})...`);
                    setTimeout(() => loadEmails(folder, page, search), 1000 * state.retries.emails);
                    return;
                }

                state.error.emails = error;
                elements.emailList.innerHTML = `
                    <div class="error-message">
                        <i class="fas fa-exclamation-circle"></i>
                        <p>Failed to load emails. Please try again.</p>
                        <button class="retry-btn" onclick="EmailClient.retryLoadEmails()">Retry</button>
                    </div>
                `;

                if (elements.refreshEmails) {
                    elements.refreshEmails.classList.remove('spinning');
                }

                state.loading.emails = false;
                showToast('Failed to load emails. Please try again.', 'error');
            });
    }

    /**
     * Set up event handlers for email items
     */
    function setupEmailItemHandlers() {
        const emailItems = elements.emailList.querySelectorAll('.email-item');

        emailItems.forEach(item => {
            item.addEventListener('click', function() {
                const emailId = this.getAttribute('data-email-id');
                const folder = this.getAttribute('data-folder');

                // Mark this item as selected
                emailItems.forEach(el => el.classList.remove('selected'));
                this.classList.add('selected');

                // Also mark as read visually
                this.classList.remove('unread');

                // Load email content
                loadEmailContent(folder, emailId);

                // Update state
                state.selectedEmailId = emailId;
            });
        });
    }

    /**
     * Load and render email content
     */
    function loadEmailContent(folder, emailId) {
        if (state.loading.content) return;

        state.loading.content = true;
        state.error.content = null;

        // Show loading indicator
        elements.emailContent.innerHTML = `
            <div class="loading-container">
                <i class="fas fa-circle-notch fa-spin loading-spinner"></i>
                <span>Loading email content...</span>
            </div>
        `;

        // Fetch email content HTML from server
        safeFetch(`/email/api/email/render/${encodeURIComponent(folder)}/${emailId}`)
            .then(response => response.json())
            .then(data => {
                // Update email content with HTML from server
                elements.emailContent.innerHTML = data.html;

                // Setup action buttons
                setupEmailContentHandlers();

                state.loading.content = false;
                state.retries.content = 0; // Reset retry counter on success
            })
            .catch(error => {
                console.error('Error loading email content:', error);

                // Retry logic
                if (state.retries.content < state.maxRetries) {
                    state.retries.content++;
                    console.log(`Retrying content load (${state.retries.content}/${state.maxRetries})...`);
                    setTimeout(() => loadEmailContent(folder, emailId), 1000 * state.retries.content);
                    return;
                }

                state.error.content = error;
                elements.emailContent.innerHTML = `
                    <div class="error-container">
                        <div class="error-icon"><i class="fas fa-exclamation-circle"></i></div>
                        <h3>Failed to load email</h3>
                        <p>There was a problem loading this email. Please try again.</p>
                        <div class="error-actions">
                            <button class="btn btn-primary" onclick="EmailClient.retryLoadContent('${folder}', '${emailId}')">
                                <i class="fas fa-redo"></i> Try Again
                            </button>
                        </div>
                    </div>
                `;

                state.loading.content = false;
                showToast('Failed to load email content. Please try again.', 'error');
            });
    }

    /**
     * Set up event handlers for email content actions
     */
    function setupEmailContentHandlers() {
        // Delete button
        const deleteBtn = elements.emailContent.querySelector('.delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', function() {
                const emailId = this.getAttribute('data-email-id');
                const folder = this.getAttribute('data-folder');
                promptDeleteEmail(folder, emailId);
            });
        }

        // Email action buttons will use their href attributes for navigation
    }

    /**
     * Show delete confirmation modal
     */
    function promptDeleteEmail(folder, emailId) {
        // Store data for deletion
        elements.deleteModal.setAttribute('data-folder', folder);
        elements.deleteModal.setAttribute('data-email-id', emailId);

        // Show modal
        elements.deleteModal.style.display = 'flex';
    }

    /**
     * Close delete confirmation modal
     */
    function closeDeleteModal() {
        elements.deleteModal.style.display = 'none';
    }

    /**
     * Confirm and execute email deletion
     */
    function confirmDeleteEmail() {
        const folder = elements.deleteModal.getAttribute('data-folder');
        const emailId = elements.deleteModal.getAttribute('data-email-id');

        if (!folder || !emailId) {
            console.error('Missing data for email deletion');
            return;
        }

        // Close modal
        closeDeleteModal();

        // Show loading overlay
        const loadingOverlay = document.createElement('div');
        loadingOverlay.className = 'loading-overlay';
        loadingOverlay.innerHTML = `
            <div class="loading-spinner">
                <i class="fas fa-circle-notch fa-spin"></i>
                <span>Deleting...</span>
            </div>
        `;
        elements.emailContent.appendChild(loadingOverlay);

        // Call API to delete email
        safeFetch(`/email/api/delete/${encodeURIComponent(folder)}/${emailId}`, {
            method: 'POST',
        })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // Remove loading overlay
                    if (loadingOverlay.parentNode) {
                        loadingOverlay.parentNode.removeChild(loadingOverlay);
                    }

                    // Refresh emails list
                    loadEmails();

                    // Clear email content
                    showEmailPlaceholder();

                    // Show success message
                    showToast('Email deleted successfully', 'success');
                }
            })
            .catch(error => {
                console.error('Error deleting email:', error);

                // Remove loading overlay
                if (loadingOverlay.parentNode) {
                    loadingOverlay.parentNode.removeChild(loadingOverlay);
                }

                showToast('Failed to delete email. Please try again.', 'error');
            });
    }

    /**
     * Show email placeholder when no email is selected
     */
    function showEmailPlaceholder() {
        elements.emailContent.innerHTML = `
            <div class="email-placeholder">
                <div class="placeholder-icon">
                    <i class="far fa-envelope"></i>
                </div>
                <h3>Select an email to read</h3>
                <p>Choose an email from the list to view its contents here.</p>
            </div>
        `;
    }

    /**
     * Render pagination controls
     */
    function renderPagination(currentPage, totalPages) {
        if (!elements.emailPagination) return;

        if (totalPages <= 1) {
            elements.emailPagination.innerHTML = '';
            return;
        }

        let paginationHtml = '<div class="pagination">';

        // Previous button
        paginationHtml += `
            <button class="pagination-btn prev ${currentPage <= 1 ? 'disabled' : ''}" 
                ${currentPage <= 1 ? 'disabled' : ''} data-page="${currentPage - 1}">
                <i class="fas fa-chevron-left"></i> Prev
            </button>
        `;

        // Page indicators
        paginationHtml += '<div class="pagination-pages">';

        const maxPages = 5;
        const halfMax = Math.floor(maxPages / 2);

        let startPage = Math.max(1, currentPage - halfMax);
        let endPage = Math.min(totalPages, startPage + maxPages - 1);

        // Adjust start if we're near the end
        if (endPage - startPage < maxPages - 1) {
            startPage = Math.max(1, endPage - maxPages + 1);
        }

        // First page indicator if not starting at 1
        if (startPage > 1) {
            paginationHtml += `
                <button class="pagination-btn page" data-page="1">1</button>
                ${startPage > 2 ? '<span class="pagination-ellipsis">...</span>' : ''}
            `;
        }

        // Page numbers
        for (let i = startPage; i <= endPage; i++) {
            paginationHtml += `
                <button class="pagination-btn page ${i === currentPage ? 'active' : ''}" 
                    data-page="${i}">${i}</button>
            `;
        }

        // Last page indicator if not ending at totalPages
        if (endPage < totalPages) {
            paginationHtml += `
                ${endPage < totalPages - 1 ? '<span class="pagination-ellipsis">...</span>' : ''}
                <button class="pagination-btn page" data-page="${totalPages}">${totalPages}</button>
            `;
        }

        paginationHtml += '</div>';

        // Next button
        paginationHtml += `
            <button class="pagination-btn next ${currentPage >= totalPages ? 'disabled' : ''}" 
                ${currentPage >= totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">
                Next <i class="fas fa-chevron-right"></i>
            </button>
        `;

        paginationHtml += '</div>';
        elements.emailPagination.innerHTML = paginationHtml;

        // Add event listeners for pagination buttons
        setupPaginationHandlers();
    }

    /**
     * Set up event handlers for pagination buttons
     */
    function setupPaginationHandlers() {
        const paginationButtons = elements.emailPagination.querySelectorAll('.pagination-btn:not(.disabled)');

        paginationButtons.forEach(btn => {
            btn.addEventListener('click', function() {
                const page = parseInt(this.getAttribute('data-page'), 10);
                loadEmails(config.folder, page, config.search);
            });
        });
    }

    /**
     * Search emails in the current folder
     */
    function searchEmails(query) {
        if (query === config.search) {
            return; // Same search, no need to reload
        }

        // Update config and load emails
        config.search = query;
        config.page = 1;
        loadEmails();

        // Show loading or clear message based on search
        if (query) {
            showToast(`Searching for "${query}"...`, 'info');
        }
    }

    /**
     * Open compose email modal
     */
    function openComposeModal(options = {}) {
        // Load compose form content
        const params = new URLSearchParams();

        if (options.replyTo) params.append('reply_to', options.replyTo);
        if (options.replyAll) params.append('reply_all', options.replyAll);
        if (options.forward) params.append('forward', options.forward);
        if (options.folder) params.append('folder', options.folder);

        // Show modal first so the loading indicator is visible
        elements.composeModal.style.display = 'flex';

        // Fetch compose form
        safeFetch(`/email/compose?${params.toString()}`)
            .then(response => response.text())
            .then(html => {
                // Extract just the form part from the HTML
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                const formContent = doc.querySelector('.compose-form');

                if (formContent) {
                    elements.composeContainer.innerHTML = formContent.outerHTML;
                    setupComposeFormHandlers();
                } else {
                    elements.composeContainer.innerHTML = '<div class="error-message">Failed to load compose form</div>';
                }
            })
            .catch(error => {
                console.error('Error loading compose form:', error);
                elements.composeContainer.innerHTML = `
                    <div class="error-message">
                        <p>Failed to load compose form. Please try again.</p>
                        <button class="btn btn-primary" onclick="EmailClient.closeComposeModal()">Close</button>
                    </div>
                `;
            });
    }

    /**
     * Close compose email modal
     */
    function closeComposeModal() {
        elements.composeModal.style.display = 'none';

        // Reset the container for next time
        elements.composeContainer.innerHTML = `
            <div class="loading-container">
                <i class="fas fa-circle-notch fa-spin loading-spinner"></i>
                <div>Loading compose form...</div>
            </div>
        `;
    }

    /**
     * Set up event handlers for compose form
     */
    function setupComposeFormHandlers() {
        const composeForm = elements.composeContainer.querySelector('form');

        if (composeForm) {
            composeForm.addEventListener('submit', function(e) {
                e.preventDefault();
                sendEmail(this);
            });
        }
    }

    /**
     * Send email via AJAX
     */
    function sendEmail(form) {
        // Get form data
        const formData = new FormData(form);

        // Show sending indicator
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalBtnText = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Sending...';

        // Build form data object
        const emailData = {};
        for (const [key, value] of formData.entries()) {
            emailData[key] = value;
        }

        // Send email using safeFetch
        safeFetch('/email/api/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(emailData)
        })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // Show success message
                    elements.composeContainer.innerHTML = `
                        <div class="success-message">
                            <div class="success-icon"><i class="fas fa-check-circle"></i></div>
                            <h3>Email Sent!</h3>
                            <p>Your email was sent successfully.</p>
                            <div class="success-actions">
                                <button class="btn btn-primary" onclick="EmailClient.closeComposeModal()">Close</button>
                                <button class="btn btn-outline" onclick="EmailClient.openComposeModal()">Compose Another</button>
                            </div>
                        </div>
                    `;

                    showToast('Email sent successfully', 'success');
                }
            })
            .catch(error => {
                console.error('Error sending email:', error);
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnText;
                showToast('Failed to send email. Please try again.', 'error');
            });
    }

    /**
     * Open settings modal
     */
    function openSettingsModal() {
        // Show modal first so the loading indicator is visible
        elements.settingsModal.style.display = 'flex';

        // Fetch settings form
        safeFetch('/email/setup')
            .then(response => response.text())
            .then(html => {
                // Extract just the form part from the HTML
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                const formContent = doc.querySelector('.setup-card');

                if (formContent) {
                    elements.settingsContainer.innerHTML = formContent.outerHTML;
                    setupSettingsFormHandlers();
                } else {
                    elements.settingsContainer.innerHTML = '<div class="error-message">Failed to load settings form</div>';
                }
            })
            .catch(error => {
                console.error('Error loading settings form:', error);
                elements.settingsContainer.innerHTML = `
                    <div class="error-message">
                        <p>Failed to load settings form. Please try again.</p>
                        <button class="btn btn-primary" onclick="EmailClient.closeSettingsModal()">Close</button>
                    </div>
                `;
            });
    }

    /**
     * Close settings modal
     */
    function closeSettingsModal() {
        elements.settingsModal.style.display = 'none';

        // Reset the container for next time
        elements.settingsContainer.innerHTML = `
            <div class="loading-container">
                <i class="fas fa-circle-notch fa-spin loading-spinner"></i>
                <div>Loading settings...</div>
            </div>
        `;
    }

    /**
     * Set up event handlers for settings form
     */
    function setupSettingsFormHandlers() {
        const settingsForm = elements.settingsContainer.querySelector('form');

        if (settingsForm) {
            settingsForm.addEventListener('submit', function(e) {
                // Add CSRF token to form if not already present
                if (!this.querySelector('input[name="csrf_token"]') && config.csrfToken) {
                    const csrfInput = document.createElement('input');
                    csrfInput.type = 'hidden';
                    csrfInput.name = 'csrf_token';
                    csrfInput.value = config.csrfToken;
                    this.appendChild(csrfInput);
                }
                // We'll let this submit normally since it reloads the page with new settings
            });
        }
    }

    /**
     * Update URL to reflect current state without reloading
     */
    function updateUrl() {
        const url = new URL(window.location);
        url.pathname = `/email/folder/${encodeURIComponent(config.folder)}`;

        // Set or remove search parameter
        if (config.search) {
            url.searchParams.set('search', config.search);
        } else {
            url.searchParams.delete('search');
        }

        // Set or remove page parameter
        if (config.page > 1) {
            url.searchParams.set('page', config.page);
        } else {
            url.searchParams.delete('page');
        }

        // Update URL without reloading page
        window.history.pushState({
            folder: config.folder,
            search: config.search,
            page: config.page
        }, '', url);
    }

    /**
     * Retry loading email content
     */
    function retryLoadContent(folder, emailId) {
        state.retries.content = 0; // Reset retry counter
        loadEmailContent(folder, emailId);
    }

    /**
     * Retry loading emails
     */
    function retryLoadEmails() {
        state.retries.emails = 0; // Reset retry counter
        loadEmails();
    }

    /**
     * Retry loading folders
     */
    function retryLoadFolders() {
        state.retries.folders = 0; // Reset retry counter
        loadFolders();
    }

    // Return public API
    return {
        init,
        loadFolders,
        loadEmails,
        loadEmailContent,
        retryLoadContent,
        retryLoadEmails,
        retryLoadFolders,
        navigateToFolder,
        searchEmails,
        openComposeModal,
        closeComposeModal,
        openSettingsModal,
        closeSettingsModal,
        promptDeleteEmail,
        closeDeleteModal,
        confirmDeleteEmail
    };
})();
