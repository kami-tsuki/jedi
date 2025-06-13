/**
 * Email Client - Core functionality
 */

// Global variables
let currentFolders = [];

/**
 * Load email folders into the sidebar
 */
function loadFolders() {
    const folderList = document.getElementById('folderList');
    const foldersElement = folderList.querySelector('.folders');
    const refreshIcon = document.getElementById('refreshFolders');

    // Add spinning class to refresh icon
    if (refreshIcon) {
        refreshIcon.classList.add('spinning');
    }

    // Update folder list with loading indicator
    foldersElement.innerHTML = `
        <li class="folder-item loading">
            <i class="fas fa-circle-notch fa-spin"></i> Loading folders...
        </li>
    `;

    // Fetch folders from API
    fetch('/email/api/folders')
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to load folders');
            }
            return response.json();
        })
        .then(data => {
            // Store folders globally
            currentFolders = data.folders;

            // Get current folder from URL if available
            const currentPath = window.location.pathname;
            const folderMatch = currentPath.match(/\/folder\/([^/]+)/);
            const currentFolder = folderMatch ? decodeURIComponent(folderMatch[1]) : 'INBOX';

            // Build folder list HTML
            let folderHtml = '';

            // Add standard folders first
            const standardFolders = ['INBOX', 'Sent', 'Drafts', 'Trash'];
            const standardIcons = {
                'INBOX': 'inbox',
                'Sent': 'paper-plane',
                'Drafts': 'file-alt',
                'Trash': 'trash-alt'
            };

            // Helper to find folder by name regardless of case
            const findFolder = (name) => {
                return data.folders.find(f =>
                    f.toLowerCase() === name.toLowerCase() ||
                    f.toLowerCase().includes(name.toLowerCase())
                );
            };

            // Add system folders first
            standardFolders.forEach(standardFolder => {
                const folder = findFolder(standardFolder);

                if (folder) {
                    const isActive = folder === currentFolder;
                    const icon = standardIcons[standardFolder] || 'folder';

                    folderHtml += `
                        <li class="folder-item ${isActive ? 'active' : ''}" 
                            data-folder="${folder}">
                            <span class="folder-icon"><i class="fas fa-${icon}"></i></span>
                            <span class="folder-name">${folder}</span>
                        </li>
                    `;
                }
            });

            // Add other folders that are not standard folders
            data.folders.forEach(folder => {
                const isStandard = standardFolders.some(sf =>
                    folder.toLowerCase() === sf.toLowerCase() ||
                    folder.toLowerCase().includes(sf.toLowerCase())
                );

                if (!isStandard) {
                    const isActive = folder === currentFolder;

                    folderHtml += `
                        <li class="folder-item ${isActive ? 'active' : ''}" 
                            data-folder="${folder}">
                            <span class="folder-icon"><i class="fas fa-folder"></i></span>
                            <span class="folder-name">${folder}</span>
                        </li>
                    `;
                }
            });

            // Update the folder list
            foldersElement.innerHTML = folderHtml;

            // Add click event listeners to folders
            const folderItems = document.querySelectorAll('.folder-item');
            folderItems.forEach(item => {
                item.addEventListener('click', (e) => {
                    const folder = item.getAttribute('data-folder');
                    if (folder) {
                        window.location.href = `/email/folder/${encodeURIComponent(folder)}`;
                    }
                });
            });
        })
        .catch(error => {
            console.error('Error loading folders:', error);
            foldersElement.innerHTML = `
                <li class="folder-item error">
                    <i class="fas fa-exclamation-circle"></i> Failed to load folders
                </li>
                <li class="folder-item">
                    <button class="retry-btn">Retry</button>
                </li>
            `;

            // Add retry button functionality
            const retryBtn = foldersElement.querySelector('.retry-btn');
            if (retryBtn) {
                retryBtn.addEventListener('click', loadFolders);
            }
        })
        .finally(() => {
            // Remove spinning class from refresh icon
            if (refreshIcon) {
                refreshIcon.classList.remove('spinning');
            }
        });
}

/**
 * Initialize the inbox/folder view
 */
function initializeEmailView() {
    // Load folders
    loadFolders();

    // Email list elements
    const emailListContainer = document.getElementById('emailList');
    const paginationContainer = document.getElementById('pagination');
    const noEmailsContainer = document.getElementById('noEmails');
    const clearSearchBtn = document.getElementById('clearSearch');
    const refreshBtn = document.getElementById('refreshEmails');
    const searchForm = document.getElementById('searchForm');

    // Get folder and page from the container's data attributes
    const currentFolder = emailListContainer.getAttribute('data-folder');
    let currentPage = parseInt(emailListContainer.getAttribute('data-page') || '1');
    let currentSearch = emailListContainer.getAttribute('data-search') || '';

    // Load emails
    loadEmails(currentFolder, currentPage, currentSearch);

    // Event listeners
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            loadEmails(currentFolder, currentPage, currentSearch);
        });
    }

    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
            window.location.href = `/email/folder/${encodeURIComponent(currentFolder)}`;
        });
    }

    if (searchForm) {
        searchForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const searchInput = document.getElementById('searchInput');
            currentSearch = searchInput.value.trim();
            currentPage = 1;

            // Update URL with search parameter
            const url = `/email/folder/${encodeURIComponent(currentFolder)}?search=${encodeURIComponent(currentSearch)}`;
            window.history.pushState({ path: url }, '', url);

            // Load emails with search term
            loadEmails(currentFolder, currentPage, currentSearch);
        });
    }

    // Email actions modal handling
    const modal = document.getElementById('emailActionModal');
    const closeModal = document.querySelector('.close-modal');
    const moveEmailBtn = document.getElementById('moveEmailBtn');
    const deleteEmailBtn = document.getElementById('deleteEmailBtn');
    const folderSelectContainer = document.getElementById('folderSelectContainer');
    const folderSelect = document.getElementById('folderSelect');
    const confirmMoveBtn = document.getElementById('confirmMoveBtn');
    const cancelMoveBtn = document.getElementById('cancelMoveBtn');

    let selectedEmailId = null;

    // Close modal when clicking the X
    if (closeModal) {
        closeModal.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }

    // Close modal when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });

    // Move email button
    if (moveEmailBtn) {
        moveEmailBtn.addEventListener('click', () => {
            // Populate folder select
            populateFolderSelect(currentFolder);

            // Show folder select container
            folderSelectContainer.style.display = 'block';
            moveEmailBtn.style.display = 'none';
            deleteEmailBtn.style.display = 'none';
        });
    }

    // Cancel move action
    if (cancelMoveBtn) {
        cancelMoveBtn.addEventListener('click', () => {
            folderSelectContainer.style.display = 'none';
            moveEmailBtn.style.display = 'block';
            deleteEmailBtn.style.display = 'block';
        });
    }

    // Confirm move action
    if (confirmMoveBtn) {
        confirmMoveBtn.addEventListener('click', () => {
            const destinationFolder = folderSelect.value;
            if (selectedEmailId && destinationFolder) {
                moveEmail(selectedEmailId, currentFolder, destinationFolder);
            }
        });
    }

    // Delete email button
    if (deleteEmailBtn) {
        deleteEmailBtn.addEventListener('click', () => {
            if (selectedEmailId) {
                deleteEmail(selectedEmailId, currentFolder);
            }
        });
    }

    /**
     * Load emails for the current folder
     */
    function loadEmails(folder, page, search = '') {
        const limit = 20;

        emailListContainer.innerHTML = `
            <div class="loading-indicator">
                <i class="fas fa-circle-notch fa-spin"></i>
                <span>Loading emails...</span>
            </div>
        `;

        let apiUrl = `/email/api/emails?folder=${encodeURIComponent(folder)}&page=${page}&limit=${limit}`;

        if (search) {
            apiUrl += `&search=${encodeURIComponent(search)}`;

            // Show clear search button if search is active
            if (clearSearchBtn) {
                clearSearchBtn.style.display = 'block';
            }
        }

        fetch(apiUrl)
            .then(response => {
                if (!response.ok) {
                    throw new Error('Failed to load emails');
                }
                return response.json();
            })
            .then(data => {
                if (data.emails && data.emails.length > 0) {
                    renderEmailList(data.emails);
                    renderPagination(data.page, data.pages);

                    if (noEmailsContainer) {
                        noEmailsContainer.style.display = 'none';
                    }
                } else {
                    emailListContainer.innerHTML = ''; // Clear loading indicator

                    if (noEmailsContainer) {
                        noEmailsContainer.style.display = 'block';
                    }

                    if (paginationContainer) {
                        paginationContainer.innerHTML = '';
                    }
                }
            })
            .catch(error => {
                console.error('Error loading emails:', error);
                emailListContainer.innerHTML = `
                    <div class="error-message">
                        <i class="fas fa-exclamation-circle"></i>
                        <p>Failed to load emails. Please try again.</p>
                        <button class="retry-btn">Retry</button>
                    </div>
                `;

                // Add retry button functionality
                const retryBtn = emailListContainer.querySelector('.retry-btn');
                if (retryBtn) {
                    retryBtn.addEventListener('click', () => {
                        loadEmails(folder, page, search);
                    });
                }
            });
    }

    /**
     * Render email list from data
     */
    function renderEmailList(emails) {
        let emailListHtml = '';

        emails.forEach(email => {
            const date = new Date(email.date.replace(' ', 'T'));
            const formattedDate = formatEmailDate(date);

            emailListHtml += `
                <div class="email-item ${email.read ? 'read' : 'unread'}" data-id="${email.id}">
                    <div class="email-details" onclick="window.location.href='/email/view/${encodeURIComponent(email.folder)}/${email.id}'">
                        <div class="email-item-header">
                            <div class="email-sender">${escapeHtml(email.from.split('<')[0].trim())}</div>
                            <div class="email-time">${formattedDate}</div>
                        </div>
                        <div class="email-item-content">
                            <div class="email-subject">${escapeHtml(email.subject)}</div>
                            <div class="email-preview"> - ${escapeHtml(email.body.substring(0, 100).replace(/\\s+/g, ' '))}</div>
                        </div>
                    </div>
                    <div class="email-item-flags">
                        ${email.has_attachments ? '<span class="email-flag flag-attachment" title="Has attachments"><i class="fas fa-paperclip"></i></span>' : ''}
                        <span class="email-flag flag-actions" onclick="openEmailActions(event, '${email.id}')">
                            <i class="fas fa-ellipsis-v"></i>
                        </span>
                    </div>
                </div>
            `;
        });

        emailListContainer.innerHTML = emailListHtml;

        // Add action menu event listeners
        document.addEventListener('click', function(event) {
            if (event.target.closest('.flag-actions') || event.target.closest('.email-action-menu')) {
                return;
            }

            // Close all open action menus
            const actionMenus = document.querySelectorAll('.email-action-menu');
            actionMenus.forEach(menu => menu.remove());
        });
    }

    /**
     * Render pagination controls
     */
    function renderPagination(currentPage, totalPages) {
        if (!paginationContainer) return;

        let paginationHtml = '';

        // Previous button
        paginationHtml += `
            <button class="pagination-btn ${currentPage === 1 ? 'disabled' : ''}"
                    ${currentPage === 1 ? 'disabled' : `onclick="changePage(${currentPage - 1})"`}>
                <i class="fas fa-chevron-left"></i>
            </button>
        `;

        // Page numbers
        const maxButtons = 5;
        let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
        let endPage = Math.min(totalPages, startPage + maxButtons - 1);

        // Adjust startPage if we're near the end
        if (endPage === totalPages) {
            startPage = Math.max(1, endPage - maxButtons + 1);
        }

        // First page button if needed
        if (startPage > 1) {
            paginationHtml += `
                <button class="pagination-btn" onclick="changePage(1)">1</button>
                ${startPage > 2 ? '<span class="pagination-ellipsis">...</span>' : ''}
            `;
        }

        // Page buttons
        for (let i = startPage; i <= endPage; i++) {
            paginationHtml += `
                <button class="pagination-btn ${i === currentPage ? 'active' : ''}"
                        onclick="changePage(${i})">
                    ${i}
                </button>
            `;
        }

        // Last page button if needed
        if (endPage < totalPages) {
            paginationHtml += `
                ${endPage < totalPages - 1 ? '<span class="pagination-ellipsis">...</span>' : ''}
                <button class="pagination-btn" onclick="changePage(${totalPages})">${totalPages}</button>
            `;
        }

        // Next button
        paginationHtml += `
            <button class="pagination-btn ${currentPage === totalPages ? 'disabled' : ''}"
                    ${currentPage === totalPages ? 'disabled' : `onclick="changePage(${currentPage + 1})"`}>
                <i class="fas fa-chevron-right"></i>
            </button>
        `;

        paginationContainer.innerHTML = paginationHtml;
    }

    /**
     * Change page and reload emails
     */
    window.changePage = function(page) {
        currentPage = page;

        // Update URL with page parameter
        let url = `/email/folder/${encodeURIComponent(currentFolder)}?page=${page}`;
        if (currentSearch) {
            url += `&search=${encodeURIComponent(currentSearch)}`;
        }
        window.history.pushState({ path: url }, '', url);

        // Load emails for the new page
        loadEmails(currentFolder, page, currentSearch);

        // Scroll to top of email list
        emailListContainer.scrollTo(0, 0);
    };

    /**
     * Open email actions menu
     */
    window.openEmailActions = function(event, emailId) {
        event.stopPropagation();

        // Remove any existing action menus
        const actionMenus = document.querySelectorAll('.email-action-menu');
        actionMenus.forEach(menu => menu.remove());

        // Set the selected email ID
        selectedEmailId = emailId;

        // Show the modal
        if (modal) {
            modal.style.display = 'flex';

            // Reset modal state
            folderSelectContainer.style.display = 'none';
            moveEmailBtn.style.display = 'block';
            deleteEmailBtn.style.display = 'block';
        }
    };

    /**
     * Populate folder select dropdown
     */
    function populateFolderSelect(currentFolder) {
        if (!folderSelect) return;

        let options = '';

        // Add all folders except the current one
        currentFolders.forEach(folder => {
            if (folder !== currentFolder) {
                options += `<option value="${folder}">${folder}</option>`;
            }
        });

        folderSelect.innerHTML = options;
    }

    /**
     * Move email to another folder
     */
    function moveEmail(emailId, sourceFolder, destinationFolder) {
        // Show loading state
        confirmMoveBtn.disabled = true;
        confirmMoveBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Moving...';

        fetch('/email/api/move', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email_id: emailId,
                source_folder: sourceFolder,
                destination_folder: destinationFolder
            })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to move email');
            }
            return response.json();
        })
        .then(data => {
            // Close the modal
            modal.style.display = 'none';

            // Remove the email from the list
            const emailElement = document.querySelector(`.email-item[data-id="${emailId}"]`);
            if (emailElement) {
                emailElement.remove();
            }

            // Show success message
            showNotification('Email moved successfully', 'success');

            // Reload emails if none left
            const emailItems = document.querySelectorAll('.email-item');
            if (emailItems.length === 0) {
                loadEmails(sourceFolder, currentPage, currentSearch);
            }
        })
        .catch(error => {
            console.error('Error moving email:', error);
            showNotification('Failed to move email', 'error');
        })
        .finally(() => {
            // Reset button state
            confirmMoveBtn.disabled = false;
            confirmMoveBtn.innerHTML = '<i class="fas fa-check"></i> Move';
        });
    }

    /**
     * Delete an email
     */
    function deleteEmail(emailId, folder) {
        // Show loading state
        deleteEmailBtn.disabled = true;
        deleteEmailBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Deleting...';

        fetch(`/email/api/delete/${encodeURIComponent(folder)}/${emailId}`, {
            method: 'POST'
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to delete email');
            }
            return response.json();
        })
        .then(data => {
            // Close the modal
            modal.style.display = 'none';

            // Remove the email from the list
            const emailElement = document.querySelector(`.email-item[data-id="${emailId}"]`);
            if (emailElement) {
                emailElement.remove();
            }

            // Show success message
            showNotification('Email deleted successfully', 'success');

            // Reload emails if none left
            const emailItems = document.querySelectorAll('.email-item');
            if (emailItems.length === 0) {
                loadEmails(folder, currentPage, currentSearch);
            }
        })
        .catch(error => {
            console.error('Error deleting email:', error);
            showNotification('Failed to delete email', 'error');
        })
        .finally(() => {
            // Reset button state
            deleteEmailBtn.disabled = false;
            deleteEmailBtn.innerHTML = '<i class="fas fa-trash"></i> Delete';
        });
    }
}

/**
 * Format email date in a readable way
 */
function formatEmailDate(date) {
    const now = new Date();
    const diff = now - date;
    const dayDiff = Math.floor(diff / (1000 * 60 * 60 * 24));

    // Today, show time
    if (dayDiff === 0) {
        let hours = date.getHours();
        let minutes = date.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';

        hours = hours % 12;
        hours = hours ? hours : 12;
        minutes = minutes < 10 ? '0' + minutes : minutes;

        return hours + ':' + minutes + ' ' + ampm;
    }

    // Yesterday
    if (dayDiff === 1) {
        return 'Yesterday';
    }

    // Within a week, show day of week
    if (dayDiff < 7) {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return days[date.getDay()];
    }

    // Otherwise show date
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    const day = date.getDate();

    // If this year
    if (date.getFullYear() === now.getFullYear()) {
        return `${month} ${day}`;
    }

    // Different year
    return `${month} ${day}, ${date.getFullYear()}`;
}

/**
 * Show notification message
 */
function showNotification(message, type = 'info') {
    // Check if flash message container exists
    let flashContainer = document.querySelector('.flash-messages');

    // If not, create one
    if (!flashContainer) {
        flashContainer = document.createElement('div');
        flashContainer.className = 'flash-messages';
        flashContainer.setAttribute('x-data', '{ show: true }');
        flashContainer.setAttribute('x-show', 'show');
        flashContainer.setAttribute('x-transition:enter', 'transition ease-out duration-300');
        flashContainer.setAttribute('x-transition:enter-start', 'opacity-0 transform translate-y-2');
        flashContainer.setAttribute('x-transition:enter-end', 'opacity-100 transform translate-y-0');
        flashContainer.setAttribute('x-transition:leave', 'transition ease-in duration-300');
        flashContainer.setAttribute('x-transition:leave-start', 'opacity-100 transform translate-y-0');
        flashContainer.setAttribute('x-transition:leave-end', 'opacity-0 transform translate-y-2');

        // Insert after navbar
        const navbar = document.querySelector('.navbar');
        navbar.parentNode.insertBefore(flashContainer, navbar.nextSibling);
    }

    // Create flash message
    const flashMessage = document.createElement('div');
    flashMessage.className = `flash-message ${type} animate-fade-in`;
    flashMessage.innerHTML = `
        <div class="flash-content">
            <span>${message}</span>
            <button class="close-btn">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;

    // Add to container
    flashContainer.appendChild(flashMessage);

    // Add close button functionality
    const closeBtn = flashMessage.querySelector('.close-btn');
    closeBtn.addEventListener('click', () => {
        flashMessage.remove();
    });

    // Auto dismiss after 5 seconds
    setTimeout(() => {
        flashMessage.classList.add('animate-fade-out');
        setTimeout(() => flashMessage.remove(), 500);
    }, 5000);
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
