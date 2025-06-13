import base64
import datetime
import io
import logging
import os
import platform
import socket
import time
import traceback
from collections import deque

import matplotlib
import matplotlib.pyplot as plt
import numpy as np
import psutil
from flask import Blueprint, jsonify, current_app, request
from flask_login import login_required

matplotlib.use('Agg')  # Use non-interactive backend

# Try to import docker, but don't fail if not available
try:
    import docker
    docker_available = True
except (ImportError, Exception):
    docker_available = False

# Try to import temperature monitoring (platform specific)
try:
    import sensors
    sensors.init()
    sensors_available = True
except (ImportError, Exception):
    sensors_available = False

monitoring_bp = Blueprint(
    'monitoring',
    __name__,
    url_prefix='/api/monitoring'
)

# Store historical data for charts
class HistoricalData:
    def __init__(self, max_points=60):
        self.cpu_history = deque(maxlen=max_points)
        self.memory_history = deque(maxlen=max_points)
        self.network_recv_history = deque(maxlen=max_points)
        self.network_sent_history = deque(maxlen=max_points)
        self.disk_read_history = deque(maxlen=max_points)
        self.disk_write_history = deque(maxlen=max_points)
        self.timestamps = deque(maxlen=max_points)
        self.last_disk_io = None
        self.last_net_io = None
        self.last_time = time.time()

    def update(self):
        try:
            current_time = time.time()
            time_diff = current_time - self.last_time

            # CPU and memory are straightforward
            self.cpu_history.append(psutil.cpu_percent())
            self.memory_history.append(psutil.virtual_memory().percent)

            # Network IO requires calculating the rate
            try:
                net_io = psutil.net_io_counters()
                if self.last_net_io:
                    recv_rate = (net_io.bytes_recv - self.last_net_io.bytes_recv) / time_diff
                    sent_rate = (net_io.bytes_sent - self.last_net_io.bytes_sent) / time_diff
                    self.network_recv_history.append(recv_rate)
                    self.network_sent_history.append(sent_rate)
                self.last_net_io = net_io
            except (AttributeError, OSError) as e:
                current_app.logger.warning(f"Could not get network IO: {str(e)}")
                # Add zeros to maintain data series length if we can't get real data
                self.network_recv_history.append(0)
                self.network_sent_history.append(0)

            # Disk IO also requires calculating the rate
            try:
                disk_io = psutil.disk_io_counters()
                if self.last_disk_io and disk_io:
                    read_rate = (disk_io.read_bytes - self.last_disk_io.read_bytes) / time_diff
                    write_rate = (disk_io.write_bytes - self.last_disk_io.write_bytes) / time_diff
                    self.disk_read_history.append(read_rate)
                    self.disk_write_history.append(write_rate)
                self.last_disk_io = disk_io
            except (AttributeError, OSError) as e:
                current_app.logger.warning(f"Could not get disk IO: {str(e)}")
                # Add zeros to maintain data series length
                self.disk_read_history.append(0)
                self.disk_write_history.append(0)

            self.timestamps.append(current_time)
            self.last_time = current_time
        except Exception as e:
            current_app.logger.error(f"Error updating historical data: {str(e)}")
            # Make sure we have at least one data point to avoid plotting errors
            if not self.cpu_history:
                self.cpu_history.append(0)
            if not self.memory_history:
                self.memory_history.append(0)
            if not self.network_recv_history:
                self.network_recv_history.append(0)
            if not self.network_sent_history:
                self.network_sent_history.append(0)
            if not self.disk_read_history:
                self.disk_read_history.append(0)
            if not self.disk_write_history:
                self.disk_write_history.append(0)
            if not self.timestamps:
                self.timestamps.append(time.time())

    def get_data(self):
        return {
            "cpu": list(self.cpu_history),
            "memory": list(self.memory_history),
            "network_recv": list(self.network_recv_history),
            "network_sent": list(self.network_sent_history),
            "disk_read": list(self.disk_read_history),
            "disk_write": list(self.disk_write_history),
            "timestamps": list(self.timestamps)
        }

# Initialize historical data
historical_data = HistoricalData()

def get_cpu_temperature():
    """Attempt to get CPU temperature from various sources"""
    try:
        if sensors_available:
            try:
                for chip in sensors.iter_detected_chips():
                    for feature in chip:
                        if 'temp' in feature.label.lower() or 'core' in feature.label.lower():
                            return feature.get_value()
                return None
            except Exception as e:
                current_app.logger.debug(f"Error getting CPU temperature from sensors: {str(e)}")

        # Try reading from thermal zones on Linux
        if os.path.isdir('/sys/class/thermal/'):
            thermal_zones = [d for d in os.listdir('/sys/class/thermal/') if d.startswith('thermal_zone')]
            for zone in thermal_zones:
                with open(f'/sys/class/thermal/{zone}/temp', 'r') as f:
                    temp = float(f.read().strip()) / 1000.0  # Convert from millidegrees to degrees
                    return temp
    except Exception as e:
        current_app.logger.debug(f"Error getting CPU temperature: {str(e)}")

    return None

def get_docker_info():
    """Get information about Docker containers if Docker is available"""
    if not docker_available:
        return {"error": "Docker SDK not available"}

    try:
        client = docker.from_env()
        containers = []

        # Get Docker version info
        try:
            version_info = client.version()
            docker_info = client.info()
        except Exception as e:
            current_app.logger.warning(f"Could not get Docker version info: {str(e)}")
            version_info = {}
            docker_info = {}

        for container in client.containers.list(all=True):
            try:
                # Get container details
                container_info = {
                    "id": container.short_id,
                    "name": container.name,
                    "status": container.status,
                    "image": container.image.tags[0] if container.image.tags else str(container.image.id),
                    "created": container.attrs.get('Created', '').replace('Z', '+00:00') if container.attrs.get('Created') else None,
                }

                # Get container ports
                ports = container.attrs.get('NetworkSettings', {}).get('Ports', {})
                mapped_ports = []
                for container_port, host_ports in ports.items() if ports else []:
                    if host_ports:
                        for binding in host_ports:
                            mapped_ports.append(f"{binding.get('HostIp', '')}:{binding.get('HostPort', '')}->{container_port}")
                    else:
                        mapped_ports.append(f"{container_port} (not published)")
                container_info["ports"] = mapped_ports

                # Add stats for running containers
                if container.status == "running":
                    try:
                        stats = container.stats(stream=False)
                        container_info["cpu_percent"] = calculate_cpu_percent(stats)
                        container_info["memory_usage"] = stats["memory_stats"].get("usage", 0)
                        container_info["memory_limit"] = stats["memory_stats"].get("limit", 0)
                        if container_info["memory_limit"] > 0:
                            container_info["memory_percent"] = (container_info["memory_usage"] / container_info["memory_limit"]) * 100
                        else:
                            container_info["memory_percent"] = 0

                        # Add network stats if available
                        if "networks" in stats.get("networks", {}):
                            container_info["network_rx"] = sum(net.get("rx_bytes", 0) for net in stats["networks"].values())
                            container_info["network_tx"] = sum(net.get("tx_bytes", 0) for net in stats["networks"].values())

                        # Add block IO stats if available
                        if "io_service_bytes_recursive" in stats.get("blkio_stats", {}):
                            for io_stat in stats["blkio_stats"]["io_service_bytes_recursive"]:
                                if io_stat.get("op") == "Read":
                                    container_info["blk_read"] = io_stat.get("value", 0)
                                elif io_stat.get("op") == "Write":
                                    container_info["blk_write"] = io_stat.get("value", 0)
                    except Exception as e:
                        # Some containers might not provide stats
                        current_app.logger.warning(f"Could not get stats for container {container.name}: {str(e)}")

                containers.append(container_info)
            except Exception as e:
                current_app.logger.warning(f"Error processing container info: {str(e)}")

        return {
            "containers": containers,
            "total": len(containers),
            "running": len([c for c in containers if c["status"] == "running"]),
            "version": version_info.get("Version", "Unknown"),
            "api_version": version_info.get("ApiVersion", "Unknown"),
            "os": version_info.get("Os", "Unknown"),
            "arch": version_info.get("Arch", "Unknown"),
            "kernel": version_info.get("KernelVersion", "Unknown"),
            "images": docker_info.get("Images", 0)
        }
    except Exception as e:
        current_app.logger.error(f"Error getting Docker info: {str(e)}")
        return {"error": str(e)}

def calculate_cpu_percent(stats):
    """Calculate CPU percentage from Docker stats"""
    try:
        cpu_delta = stats["cpu_stats"]["cpu_usage"]["total_usage"] - stats["precpu_stats"]["cpu_usage"]["total_usage"]
        system_delta = stats["cpu_stats"]["system_cpu_usage"] - stats["precpu_stats"]["system_cpu_usage"]

        if system_delta > 0 and cpu_delta > 0:
            cpu_count = len(stats["cpu_stats"]["cpu_usage"].get("percpu_usage", []))
            if cpu_count == 0:
                cpu_count = 1
            return (cpu_delta / system_delta) * cpu_count * 100.0
    except (KeyError, TypeError, ZeroDivisionError) as e:
        current_app.logger.debug(f"Error calculating CPU percentage: {str(e)}")

    return 0.0

def get_safe_swap_info():
    """Get swap memory information with error handling for Windows"""
    try:
        swap = psutil.swap_memory()
        swap_info = {
            "total": swap.total,
            "used": swap.used,
            "free": swap.free,
            "percent": swap.percent,
        }

        # These properties might not exist on all platforms
        if hasattr(swap, 'sin'):
            swap_info["sin"] = swap.sin
        if hasattr(swap, 'sout'):
            swap_info["sout"] = swap.sout

        return swap_info
    except (RuntimeError, AttributeError, OSError) as e:
        # On Windows with performance counters disabled, this will fail
        current_app.logger.warning(f"Could not get swap info: {str(e)}")
        return {
            "total": 0,
            "used": 0,
            "free": 0,
            "percent": 0,
            "error": str(e)
        }

def get_system_info():
    """Get system information including CPU, memory, disk and network"""
    try:
        # Update historical data
        historical_data.update()

        # Basic system info
        system_info = {
            "platform": platform.platform(),
            "python_version": platform.python_version(),
            "uptime": datetime.datetime.fromtimestamp(psutil.boot_time()).strftime("%Y-%m-%d %H:%M:%S"),
            "uptime_seconds": int(datetime.datetime.now().timestamp() - psutil.boot_time()),
            "boot_time": psutil.boot_time(),
            "hostname": socket.gethostname(),
            "os_info": f"{platform.system()} {platform.release()} {platform.version()}",
            "processor": platform.processor()
        }

        # CPU info
        try:
            cpu_freq = psutil.cpu_freq()
            cpu_info = {
                "physical_cores": psutil.cpu_count(logical=False) or 0,
                "total_cores": psutil.cpu_count(logical=True) or 0,
                "max_frequency": cpu_freq.max if cpu_freq else None,
                "min_frequency": cpu_freq.min if cpu_freq else None,
                "current_frequency": cpu_freq.current if cpu_freq else None,
                "per_core_usage": [percentage for percentage in psutil.cpu_percent(interval=0.1, percpu=True)],
                "total_cpu_usage": psutil.cpu_percent(),
                "model": platform.processor(),
                "temperature": get_cpu_temperature()
            }
        except Exception as e:
            current_app.logger.warning(f"Error getting CPU info: {str(e)}")
            cpu_info = {
                "physical_cores": 0,
                "total_cores": 0,
                "total_cpu_usage": 0,
                "per_core_usage": [],
                "error": str(e)
            }

        # CPU load
        try:
            load_1, load_5, load_15 = os.getloadavg()
            cpu_info["load_avg"] = {
                "1min": load_1,
                "5min": load_5,
                "15min": load_15
            }
        except (AttributeError, OSError) as e:
            # OS does not support getloadavg (e.g. Windows)
            pass

        # Memory info
        try:
            memory = psutil.virtual_memory()
            memory_info = {
                "total": memory.total,
                "available": memory.available,
                "used": memory.used,
                "free": memory.free,
                "percent": memory.percent,
            }

            # These might not exist on all platforms
            if hasattr(memory, 'cached'):
                memory_info["cached"] = memory.cached
            if hasattr(memory, 'buffers'):
                memory_info["buffers"] = memory.buffers
        except Exception as e:
            current_app.logger.warning(f"Error getting memory info: {str(e)}")
            memory_info = {
                "total": 0,
                "available": 0,
                "used": 0,
                "free": 0,
                "percent": 0,
                "error": str(e)
            }

        # Add swap info with error handling
        memory_info["swap"] = get_safe_swap_info()

        # Disk info
        disk_info = []
        for partition in psutil.disk_partitions(all=False):  # Just get standard partitions to avoid errors
            try:
                partition_usage = psutil.disk_usage(partition.mountpoint)
                disk_info.append({
                    "device": partition.device,
                    "mountpoint": partition.mountpoint,
                    "fstype": partition.fstype,
                    "opts": partition.opts,
                    "total_size": partition_usage.total,
                    "used": partition_usage.used,
                    "free": partition_usage.free,
                    "percent": partition_usage.percent,
                })
            except (PermissionError, FileNotFoundError, OSError) as e:
                # Some disk partitions aren't accessible
                current_app.logger.debug(f"Could not access partition {partition.mountpoint}: {str(e)}")
                continue

        # Add disk IO stats
        try:
            disk_io = psutil.disk_io_counters()
            for partition in disk_info:
                try:
                    partition_name = os.path.basename(partition["device"].rstrip(':\\').rstrip('/'))
                    per_disk_io = psutil.disk_io_counters(perdisk=True)
                    if partition_name in per_disk_io:
                        disk_stats = per_disk_io[partition_name]
                        partition["read_write_stats"] = f"R: {disk_stats.read_bytes/(1024*1024):.1f} MB, W: {disk_stats.write_bytes/(1024*1024):.1f} MB"
                        partition["io_stats"] = {
                            "read_count": disk_stats.read_count,
                            "write_count": disk_stats.write_count,
                            "read_bytes": disk_stats.read_bytes,
                            "write_bytes": disk_stats.write_bytes,
                            "read_time": disk_stats.read_time if hasattr(disk_stats, 'read_time') else None,
                            "write_time": disk_stats.write_time if hasattr(disk_stats, 'write_time') else None
                        }
                except (AttributeError, IndexError) as e:
                    current_app.logger.debug(f"Could not get IO stats for {partition['device']}: {str(e)}")
        except (AttributeError, OSError) as e:
            current_app.logger.warning(f"Could not get disk IO stats: {str(e)}")

        # Network info
        network_info = {
            "interfaces": {},
            "total_bytes_sent": 0,
            "total_bytes_received": 0
        }

        try:
            net_io = psutil.net_io_counters(pernic=True)
            for interface, stats in net_io.items():
                # Skip pseudo and virtual interfaces to avoid clutter
                if interface.startswith(('lo', 'veth', 'docker', 'br-')):
                    continue

                interface_stats = {
                    "bytes_sent": stats.bytes_sent,
                    "bytes_received": stats.bytes_recv,
                    "packets_sent": stats.packets_sent,
                    "packets_received": stats.packets_recv,
                    "errors": stats.errin + stats.errout,
                }

                # These might not exist on all platforms
                if hasattr(stats, 'dropin'):
                    interface_stats["dropin"] = stats.dropin
                if hasattr(stats, 'dropout'):
                    interface_stats["dropout"] = stats.dropout

                network_info["interfaces"][interface] = interface_stats

            # Aggregate network stats
            total_bytes_sent = sum(stats["bytes_sent"] for stats in network_info["interfaces"].values())
            total_bytes_received = sum(stats["bytes_received"] for stats in network_info["interfaces"].values())
            network_info["total_bytes_sent"] = total_bytes_sent
            network_info["total_bytes_received"] = total_bytes_received
        except Exception as e:
            current_app.logger.warning(f"Error getting network info: {str(e)}")

        # Add network connection counts
        try:
            connections = psutil.net_connections()
            connection_stats = {
                "ESTABLISHED": 0,
                "TIME_WAIT": 0,
                "LISTEN": 0,
                "CLOSE_WAIT": 0,
                "FIN_WAIT": 0,
                "CLOSING": 0,
                "NONE": 0,
                "total": len(connections)
            }

            for conn in connections:
                status = conn.status if conn.status else "NONE"
                # Group FIN_WAIT1 and FIN_WAIT2 under FIN_WAIT
                if status.startswith("FIN_WAIT"):
                    status = "FIN_WAIT"

                if status in connection_stats:
                    connection_stats[status] += 1
                else:
                    connection_stats["NONE"] += 1

            network_info["connections"] = connection_stats
        except (PermissionError, OSError) as e:
            current_app.logger.warning(f"Could not get network connections: {str(e)}")

        # Get running processes
        processes_info = []
        try:
            # Limit to top 50 processes to avoid excessive data
            processes = sorted(
                psutil.process_iter(['pid', 'name', 'username', 'cmdline', 'create_time', 'memory_info', 'cpu_percent', 'status']),
                key=lambda p: p.info['cpu_percent'] if p.info['cpu_percent'] else 0,
                reverse=True
            )[:50]

            for proc in processes:
                try:
                    # Get process info
                    pinfo = proc.info
                    memory_percent = 0
                    try:
                        memory_percent = proc.memory_percent()
                    except:
                        pass

                    # Calculate running time
                    running_time = time.time() - pinfo.get('create_time', time.time())

                    # Get memory info
                    mem_info = pinfo.get('memory_info')

                    process_data = {
                        "pid": pinfo['pid'],
                        "name": pinfo['name'],
                        "username": pinfo.get('username'),
                        "status": pinfo.get('status'),
                        "cpu_percent": pinfo.get('cpu_percent', 0),
                        "memory_percent": memory_percent,
                        "memory_rss": mem_info.rss if mem_info else 0,
                        "memory_vms": mem_info.vms if mem_info else 0,
                        "running_time": running_time,
                        "cmdline": " ".join(pinfo.get('cmdline', [])) if pinfo.get('cmdline') else ""
                    }
                    processes_info.append(process_data)
                except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                    pass
        except Exception as e:
            current_app.logger.error(f"Error getting process info: {str(e)}")

        return {
            "system": system_info,
            "cpu": cpu_info,
            "memory": memory_info,
            "disk": disk_info,
            "network": network_info,
            "processes": processes_info
        }
    except Exception as e:
        current_app.logger.error(f"Error in get_system_info: {str(e)}\n{traceback.format_exc()}")
        # Return minimal info if something goes wrong
        return {
            "system": {
                "platform": platform.platform(),
                "hostname": socket.gethostname(),
                "error": str(e)
            },
            "cpu": {"total_cpu_usage": psutil.cpu_percent()},
            "memory": {"percent": psutil.virtual_memory().percent},
            "disk": [],
            "network": {},
            "processes": []
        }

def generate_chart(title, data_dict, labels, colors, y_label='', add_legend=True):
    """Generate a chart as base64 image"""
    try:
        plt.figure(figsize=(10, 4))

        # Create a list of empty data sets if none available
        if all(len(data_dict[key]) == 0 for key in labels):
            for key in labels:
                data_dict[key] = [0]

        # Plot each data series
        for i, (key, label) in enumerate(labels.items()):
            plt.plot(data_dict[key], color=colors[i], linewidth=2, label=label)

        plt.title(title)
        plt.xlabel('Time (samples)')
        plt.ylabel(y_label)

        # Set grid
        plt.grid(True, alpha=0.3)

        # Add legend if requested
        if add_legend and len(labels) > 1:
            plt.legend()

        plt.tight_layout()

        # Save to buffer
        buffer = io.BytesIO()
        plt.savefig(buffer, format='png')
        buffer.seek(0)
        image_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
        plt.close()

        return f"data:image/png;base64,{image_base64}"
    except Exception as e:
        current_app.logger.error(f"Error generating chart '{title}': {str(e)}")

        # Generate a simple error message image
        plt.figure(figsize=(10, 4))
        plt.text(0.5, 0.5, f"Error generating chart: {str(e)}",
                horizontalalignment='center', verticalalignment='center')
        plt.axis('off')

        buffer = io.BytesIO()
        plt.savefig(buffer, format='png')
        buffer.seek(0)
        image_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
        plt.close()

        return f"data:image/png;base64,{image_base64}"

def generate_cpu_chart():
    """Generate a CPU usage chart as base64 image"""
    data = historical_data.get_data()
    return generate_chart(
        'CPU Usage Over Time',
        {"cpu": data["cpu"]},
        {"cpu": "CPU Usage"},
        ['#5DA5DA'],
        'Usage (%)'
    )

def generate_memory_chart():
    """Generate a memory usage chart as base64 image"""
    data = historical_data.get_data()
    return generate_chart(
        'Memory Usage Over Time',
        {"memory": data["memory"]},
        {"memory": "Memory Usage"},
        ['#60BD68'],
        'Usage (%)'
    )

def generate_network_chart():
    """Generate a network usage chart as base64 image"""
    data = historical_data.get_data()
    return generate_chart(
        'Network Traffic',
        {
            "network_recv": data["network_recv"],
            "network_sent": data["network_sent"]
        },
        {
            "network_recv": "Received",
            "network_sent": "Sent"
        },
        ['#5DA5DA', '#F17CB0'],
        'Bytes/sec'
    )

def generate_diskio_chart():
    """Generate a disk I/O usage chart as base64 image"""
    data = historical_data.get_data()
    return generate_chart(
        'Disk I/O',
        {
            "disk_read": data["disk_read"],
            "disk_write": data["disk_write"]
        },
        {
            "disk_read": "Read",
            "disk_write": "Write"
        },
        ['#B276B2', '#DECF3F'],
        'Bytes/sec'
    )

def get_system_logs(lines=100):
    """Get system logs from various sources"""
    logs = []

    # Try to get logs from journalctl (Linux)
    try:
        if os.path.exists('/bin/journalctl'):
            import subprocess
            output = subprocess.check_output(['journalctl', '-n', str(lines), '--no-pager'], text=True)
            for line in output.split('\n'):
                if line.strip():
                    parts = line.split(' ', 3)
                    if len(parts) >= 4:
                        timestamp = ' '.join(parts[0:3])
                        message_parts = parts[3].split(':', 2)
                        if len(message_parts) >= 3:
                            source = message_parts[0]
                            level = message_parts[1].strip().lower()
                            if 'error' in level:
                                level = 'error'
                            elif 'warn' in level:
                                level = 'warning'
                            elif 'info' in level:
                                level = 'info'
                            else:
                                level = 'debug'
                            message = message_parts[2]
                            logs.append({
                                'timestamp': timestamp,
                                'source': source,
                                'level': level,
                                'message': message
                            })
    except Exception as e:
        current_app.logger.warning(f"Could not get journalctl logs: {str(e)}")

    # Try to get logs from Windows Event Log
    if os.name == 'nt':
        try:
            import win32evtlog
            server = 'localhost'
            log_type = 'System'
            hand = win32evtlog.OpenEventLog(server, log_type)
            total = win32evtlog.GetNumberOfEventLogRecords(hand)

            flags = win32evtlog.EVENTLOG_BACKWARDS_READ | win32evtlog.EVENTLOG_SEQUENTIAL_READ
            events = win32evtlog.ReadEventLog(hand, flags, 0)

            for event in events[:lines]:
                level = 'info'
                if event.EventType == win32evtlog.EVENTLOG_ERROR_TYPE:
                    level = 'error'
                elif event.EventType == win32evtlog.EVENTLOG_WARNING_TYPE:
                    level = 'warning'

                logs.append({
                    'timestamp': event.TimeGenerated.Format(),
                    'source': event.SourceName,
                    'level': level,
                    'message': str(win32evtlog.SafeFormatMessage(event, log_type))
                })
        except Exception as e:
            current_app.logger.warning(f"Could not get Windows Event logs: {str(e)}")

    # Try to get logs from Flask app
    try:
        flask_log_file = None
        for handler in current_app.logger.handlers:
            if isinstance(handler, logging.FileHandler):
                flask_log_file = handler.baseFilename
                break

        if flask_log_file and os.path.exists(flask_log_file):
            with open(flask_log_file, 'r') as f:
                for line in f.readlines()[-lines:]:
                    line = line.strip()
                    if not line:
                        continue

                    parts = line.split(' - ', 1)
                    if len(parts) >= 2:
                        timestamp = parts[0]
                        rest = parts[1].split(': ', 1)
                        if len(rest) >= 2:
                            level_parts = rest[0].split(' ')
                            level = level_parts[-1].lower()
                            source = ' '.join(level_parts[:-1])
                            message = rest[1]

                            logs.append({
                                'timestamp': timestamp,
                                'source': source,
                                'level': level,
                                'message': message
                            })
    except Exception as e:
        current_app.logger.warning(f"Could not get Flask logs: {str(e)}")

    # If no system logs, get application logs from werkzeug
    if not logs:
        try:
            logger = logging.getLogger('werkzeug')
            if logger.handlers:
                for handler in logger.handlers:
                    if isinstance(handler, logging.FileHandler):
                        logfile = handler.baseFilename
                        if os.path.exists(logfile):
                            with open(logfile, 'r') as f:
                                for line in f.readlines()[-lines:]:
                                    line = line.strip()
                                    if not line:
                                        continue

                                    parts = line.split(' - ', 1)
                                    if len(parts) >= 2:
                                        timestamp = parts[0]
                                        rest = parts[1].split(': ', 1)
                                        if len(rest) >= 2:
                                            level_parts = rest[0].split(' ')
                                            level = level_parts[-1].lower()
                                            source = ' '.join(level_parts[:-1])
                                            message = rest[1]

                                            logs.append({
                                                'timestamp': timestamp,
                                                'source': source,
                                                'level': level,
                                                'message': message
                                            })
        except Exception as e:
            current_app.logger.warning(f"Could not get application logs: {str(e)}")

    # If still no logs, add application event log entries
    if not logs:
        # Add some recent log entries from the current app logger
        logs.append({
            'timestamp': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'source': 'monitoring',
            'level': 'info',
            'message': 'Monitoring system started'
        })

        # Get recent error messages from error log if possible
        errors = []
        for handler in logging.getLogger().handlers + current_app.logger.handlers:
            if isinstance(handler, logging.FileHandler):
                try:
                    with open(handler.baseFilename, 'r') as f:
                        content = f.readlines()
                        for line in content[-50:]:  # Last 50 lines
                            if 'ERROR' in line or 'CRITICAL' in line:
                                errors.append(line.strip())
                except:
                    pass

        # Add any found errors
        for i, error in enumerate(errors[:5]):  # Show up to 5 errors
            logs.append({
                'timestamp': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'source': 'application',
                'level': 'error',
                'message': error
            })

    return {"logs": logs}

@monitoring_bp.route('/system', methods=['GET'])
@login_required
def system_metrics():
    """API endpoint to get system metrics"""
    try:
        return jsonify(get_system_info())
    except Exception as e:
        current_app.logger.error(f"Error in system_metrics endpoint: {str(e)}\n{traceback.format_exc()}")
        return jsonify({
            "error": f"Failed to get system metrics: {str(e)}",
            "system": {"platform": platform.platform()},
            "cpu": {"total_cpu_usage": 0},
            "memory": {"percent": 0},
        }), 200  # Return 200 to prevent frontend errors

@monitoring_bp.route('/docker', methods=['GET'])
@login_required
def docker_metrics():
    """API endpoint to get Docker metrics"""
    try:
        return jsonify(get_docker_info())
    except Exception as e:
        current_app.logger.error(f"Error in docker_metrics endpoint: {str(e)}")
        return jsonify({"error": str(e)}), 200  # Return 200 to prevent frontend errors

@monitoring_bp.route('/docker/<container_id>/<action>', methods=['POST'])
@login_required
def docker_container_action(container_id, action):
    """API endpoint to perform actions on Docker containers"""
    if not docker_available:
        return jsonify({"success": False, "error": "Docker SDK not available"})

    try:
        valid_actions = ['start', 'stop', 'restart']
        if action not in valid_actions:
            return jsonify({"success": False, "error": f"Invalid action: {action}. Valid actions are {', '.join(valid_actions)}."})

        client = docker.from_env()
        container = client.containers.get(container_id)

        if action == 'start':
            container.start()
        elif action == 'stop':
            container.stop()
        elif action == 'restart':
            container.restart()

        return jsonify({"success": True})
    except Exception as e:
        current_app.logger.error(f"Error performing Docker container action: {str(e)}")
        return jsonify({"success": False, "error": str(e)})

@monitoring_bp.route('/charts/cpu', methods=['GET'])
@login_required
def cpu_chart():
    """API endpoint to get CPU chart"""
    try:
        return jsonify({"image": generate_cpu_chart()})
    except Exception as e:
        current_app.logger.error(f"Error generating CPU chart: {str(e)}")
        return jsonify({"image": "data:image/png;base64,", "error": str(e)}), 200

@monitoring_bp.route('/charts/memory', methods=['GET'])
@login_required
def memory_chart():
    """API endpoint to get memory chart"""
    try:
        return jsonify({"image": generate_memory_chart()})
    except Exception as e:
        current_app.logger.error(f"Error generating memory chart: {str(e)}")
        return jsonify({"image": "data:image/png;base64,", "error": str(e)}), 200

@monitoring_bp.route('/charts/network', methods=['GET'])
@login_required
def network_chart():
    """API endpoint to get network chart"""
    try:
        return jsonify({"image": generate_network_chart()})
    except Exception as e:
        current_app.logger.error(f"Error generating network chart: {str(e)}")
        return jsonify({"image": "data:image/png;base64,", "error": str(e)}), 200

@monitoring_bp.route('/charts/diskio', methods=['GET'])
@login_required
def diskio_chart():
    """API endpoint to get disk I/O chart"""
    try:
        return jsonify({"image": generate_diskio_chart()})
    except Exception as e:
        current_app.logger.error(f"Error generating disk I/O chart: {str(e)}")
        return jsonify({"image": "data:image/png;base64,", "error": str(e)}), 200

@monitoring_bp.route('/logs', methods=['GET'])
@login_required
def system_logs():
    """API endpoint to get system logs"""
    try:
        lines = request.args.get('lines', 100, type=int)
        return jsonify(get_system_logs(lines))
    except Exception as e:
        current_app.logger.error(f"Error getting system logs: {str(e)}")
        return jsonify({
            "logs": [{
                'timestamp': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'source': 'monitoring',
                'level': 'error',
                'message': f'Error retrieving logs: {str(e)}'
            }]
        }), 200

@monitoring_bp.route('/all', methods=['GET'])
@login_required
def all_metrics():
    """API endpoint to get all metrics"""
    try:
        data = {
            "system": get_system_info(),
            "docker": get_docker_info(),
            "charts": {
                "cpu": generate_cpu_chart(),
                "memory": generate_memory_chart(),
                "network": generate_network_chart(),
                "diskio": generate_diskio_chart()
            },
            "logs": get_system_logs(20)["logs"],
            "timestamp": datetime.datetime.now().isoformat()
        }
        return jsonify(data)
    except Exception as e:
        current_app.logger.error(f"Error in all_metrics endpoint: {str(e)}")
        return jsonify({
            "error": str(e),
            "timestamp": datetime.datetime.now().isoformat()
        }), 200
