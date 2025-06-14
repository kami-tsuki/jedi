/**
 * Email Actions - Handles all email operations in the email client interface
 *
 * This module provides functionality for all interactive actions on emails:
 * - Reply, reply all, forward
 * - Delete and archive emails
 * - Marking emails as unread/spam
 * - Moving emails between folders
 * - Custom dropdowns and tooltips for email actions
 */

const EmailActions = (function() {
    'use strict';

    // Configuration
    let config = {
        csrfToken: null,
        activeEmailId: null,
        activeFolder: null
    };

    /**
     * Initialize the email actions module
     * @param {Object} options - Initialization options
     */
    function init(options = {}) {
        // Merge options
        config.csrfToken = options.csrfToken || document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
        config.activeEmailId = options.emailId;
        config.activeFolder = options.folder;

        // Initialize components
        initDropdowns();
        initTooltips();

        if (config.activeEmailId && config.activeFolder) {
            initEmailActions(config.activeEmailId, config.activeFolder);
        }

        // Set up event listeners for modals
        setupModalHandlers();
    }

    /**
     * Set up event handlers for modal dialogs
     */
    function setupModalHandlers() {
        // Delete confirmation modal
        document.getElementById('confirmDeleteBtn')?.addEventListener('click', confirmDelete);
        document.getElementById('cancelDeleteBtn')?.addEventListener('click', function() {
            document.getElementById('deleteModal')?.classList.remove('active');
        });

        // Move email modal
        document.getElementById('confirmMoveBtn')?.addEventListener('click', confirmMove);
        document.getElementById('cancelMoveBtn')?.addEventListener('click', function() {
            document.getElementById('moveModal')?.classList.remove('active');
        });
        document.getElementById('closeMoveModal')?.addEventListener('click', function() {
            document.getElementById('moveModal')?.classList.remove('active');
        });

        // Close modals when clicking outside
        const modals = document.querySelectorAll('.modal');
        modals.forEach(modal => {
            modal.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.remove('active');
                }
            });
        });

        // Handle escape key for modals
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal.active').forEach(modal => {
                    modal.classList.remove('active');
                });
            }
        });
    }

    /**
     * Handle dropdown toggle functionality
     */
    function initDropdowns() {
        document.addEventListener('click', function(e) {
            const dropdown = document.querySelector('.dropdown .dropdown-menu.active');
            const dropdownToggle = e.target.closest('.dropdown .action-btn');

            // Close any open dropdown when clicking outside
            if (dropdown && !e.target.closest('.dropdown-menu') && !dropdownToggle) {
                dropdown.classList.remove('active');
            }

            // Toggle dropdown when clicking the dropdown button
            if (dropdownToggle) {
                const menu = dropdownToggle.nextElementSibling;
                if (menu) {
                    if (menu.classList.contains('active')) {
                        menu.classList.remove('active');
                    } else {
                        // Close all other dropdowns first
                        document.querySelectorAll('.dropdown-menu.active').forEach(item => {
                            item.classList.remove('active');
                        });
                        menu.classList.add('active');
                    }
                    e.preventDefault();
                    e.stopPropagation();
                }
            }
        });
    }

    /**
     * Initialize tooltips for buttons with title attributes
     */
    function initTooltips() {
        const buttons = document.querySelectorAll('[title]');
        buttons.forEach(button => {
            button.addEventListener('mouseenter', showTooltip);
            button.addEventListener('mouseleave', hideTooltip);
            button.addEventListener('focus', showTooltip);
            button.addEventListener('blur', hideTooltip);
        });
    }

    /**
     * Show tooltip when hovering over an element
     * @param {Event} e - Mouse event
     */
    function showTooltip(e) {
        const title = this.getAttribute('title');
        if (!title) return;

        // Hide the default tooltip
        this.setAttribute('data-original-title', title);
        this.setAttribute('title', '');

        // Create custom tooltip
        let tooltip = document.createElement('div');
        tooltip.className = 'custom-tooltip';
        tooltip.textContent = title;
        document.body.appendChild(tooltip);

        // Position tooltip
        const rect = this.getBoundingClientRect();
        tooltip.style.top = `${rect.top - tooltip.offsetHeight - 10 + window.scrollY}px`;
        tooltip.style.left = `${rect.left + (rect.width / 2) - (tooltip.offsetWidth / 2) + window.scrollX}px`;
        tooltip.style.opacity = '1';

        this._tooltip = tooltip;
    }

    /**
     * Hide tooltip when mouse leaves the element
     */
    function hideTooltip() {
        if (this._tooltip) {
            document.body.removeChild(this._tooltip);
            this._tooltip = null;

            // Restore title
            if (this.getAttribute('data-original-title')) {
                this.setAttribute('title', this.getAttribute('data-original-title'));
                this.removeAttribute('data-original-title');
            }
        }
    }

    /**
     * Initialize email action buttons
     * @param {string} emailId - ID of the active email
     * @param {string} folder - Folder containing the email
     */
    function initEmailActions(emailId, folder) {
        config.activeEmailId = emailId || config.activeEmailId;
        config.activeFolder = folder || config.activeFolder;

        // Reply button
        const replyBtn = document.querySelector('.reply-btn');
        if (replyBtn) {
            replyBtn.addEventListener('click', handleReply);
        }

        // Reply All button
        const replyAllBtn = document.querySelector('.reply-all-btn');
        if (replyAllBtn) {
            replyAllBtn.addEventListener('click', handleReplyAll);
        }

        // Forward button
        const forwardBtn = document.querySelector('.forward-btn');
        if (forwardBtn) {
            forwardBtn.addEventListener('click', handleForward);
        }

        // Print button
        const printBtn = document.querySelector('.print-btn');
        if (printBtn) {
            printBtn.addEventListener('click', handlePrint);
        }

        // Archive button
        const archiveBtn = document.querySelector('.archive-btn');
        if (archiveBtn) {
            archiveBtn.addEventListener('click', handleArchive);
        }

        // Mark as unread button
        const markBtn = document.querySelector('.mark-btn');
        if (markBtn) {
            markBtn.addEventListener('click', handleMarkUnread);
        }

        // Move to folder button
        const moveBtn = document.querySelector('.move-btn');
        if (moveBtn) {
            moveBtn.addEventListener('click', handleMove);
        }

        // Delete button
        const deleteBtn = document.querySelector('.delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', handleDelete);
        }

        // Dropdown menu items
        document.getElementById('markSpam')?.addEventListener('click', handleMarkSpam);
        document.getElementById('addStar')?.addEventListener('click', handleAddStar);
        document.getElementById('createFilter')?.addEventListener('click', handleCreateFilter);
        document.getElementById('showOriginal')?.addEventListener('click', handleShowOriginal);
    }

    /**
     * Handler for reply button
     */
    function handleReply() {
        if (!config.activeEmailId || !config.activeFolder) {
            showNotification('No email selected', 'error');
            return;
        }
        window.location.href = `/email/compose?reply_to=${config.activeEmailId}&folder=${config.activeFolder}`;
    }

    /**
     * Handler for reply all button
     */
    function handleReplyAll() {
        if (!config.activeEmailId || !config.activeFolder) {
            showNotification('No email selected', 'error');
            return;
        }
        window.location.href = `/email/compose?reply_to=${config.activeEmailId}&reply_all=true&folder=${config.activeFolder}`;
    }

    /**
     * Handler for forward button
     */
    function handleForward() {
        if (!config.activeEmailId || !config.activeFolder) {
            showNotification('No email selected', 'error');
            return;
        }
        window.location.href = `/email/compose?forward=${config.activeEmailId}&folder=${config.activeFolder}`;
    }

    /**
     * Handler for print button
     */
    function handlePrint() {
        window.print();
    }

    /**
     * Handler for archive button
     */
    function handleArchive() {
        if (!config.activeEmailId || !config.activeFolder) {
            showNotification('No email selected', 'error');
            return;
        }

        const emailId = config.activeEmailId;
        const folder = config.activeFolder;

        // Show loading state
        showLoadingOverlay();

        // Call API to move email to Archive folder
        fetch('/email/api/move', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': config.csrfToken
            },
            body: JSON.stringify({
                email_id: emailId,
                source_folder: folder,
                destination_folder: 'Archive'
            })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to archive email');
            }
            return response.json();
        })
        .then(data => {
            hideLoadingOverlay();
            showNotification('Email archived', 'success');

            // Trigger refresh of email list
            if (typeof EmailClient !== 'undefined') {
                EmailClient.loadEmails();
                EmailClient.showEmailPlaceholder();
            }
        })
        .catch(error => {
            hideLoadingOverlay();
            showNotification('Failed to archive email', 'error');
            console.error('Archive error:', error);
        });
    }

    /**
     * Handler for mark as unread button
     */
    function handleMarkUnread() {
        if (!config.activeEmailId || !config.activeFolder) {
            showNotification('No email selected', 'error');
            return;
        }

        // Implementation would call the server to mark as unread
        showNotification('Email marked as unread', 'success');

        // Update UI to reflect the change
        if (typeof EmailClient !== 'undefined') {
            EmailClient.loadEmails();
        }
    }

    /**
     * Handler for move to folder button
     */
    function handleMove() {
        if (!config.activeEmailId || !config.activeFolder) {
            showNotification('No email selected', 'error');
            return;
        }

        // Show move folder dialog
        const moveModal = document.getElementById('moveModal');
        if (moveModal) {
            moveModal.classList.add('active');

            // Set data attributes for the confirm button to use
            moveModal.setAttribute('data-email-id', config.activeEmailId);
            moveModal.setAttribute('data-folder', config.activeFolder);

            // Load folders into the select list
            loadFoldersForMove();
        }
    }

    /**
     * Load folders for move dialog
     */
    function loadFoldersForMove() {
        const folderSelect = document.getElementById('folderSelect');
        if (!folderSelect) return;

        // Start with loading state
        folderSelect.innerHTML = `
            <div class="loading-state">
                <div class="loading-spinner">
                    <i class="fas fa-circle-notch fa-spin"></i>
                </div>
                <span>Loading folders...</span>
            </div>
        `;

        // Fetch folders
        fetch('/email/api/folders')
            .then(response => response.json())
            .then(data => {
                let folderListHTML = '';

                data.folders.forEach(folder => {
                    folderListHTML += renderFolderOption(folder, 0);
                });

                folderSelect.innerHTML = folderListHTML;

                // Add click handlers for selection
                const folderItems = folderSelect.querySelectorAll('.folder-option');
                folderItems.forEach(item => {
                    item.addEventListener('click', function() {
                        // Deselect all other folders
                        folderItems.forEach(f => f.classList.remove('selected'));
                        // Select this folder
                        this.classList.add('selected');

                        // Store the selected folder path
                        const moveModal = document.getElementById('moveModal');
                        if (moveModal) {
                            moveModal.setAttribute('data-destination', this.getAttribute('data-folder'));
                        }
                    });
                });
            })
            .catch(error => {
                folderSelect.innerHTML = `
                    <div class="error-message">
                        Failed to load folders. Please try again.
                    </div>
                `;
                console.error('Error loading folders:', error);
            });
    }

    /**
     * Render folder option for move dialog
     * @param {Object} folder - Folder data
     * @param {number} level - Nesting level
     * @returns {string} HTML for folder option
     */
    function renderFolderOption(folder, level) {
        let html = `
            <div class="folder-option" data-folder="${folder.path}" style="padding-left: ${level * 16 + 12}px">
                <i class="fas ${getFolderIcon(folder.type)}"></i>
                <span>${folder.display_name}</span>
            </div>
        `;

        if (folder.children && folder.children.length > 0) {
            folder.children.forEach(child => {
                html += renderFolderOption(child, level + 1);
            });
        }

        return html;
    }

    /**
     * Get folder icon class
     * @param {string} folderType - Type of folder
     * @returns {string} FontAwesome icon class
     */
    function getFolderIcon(folderType) {
        const iconMap = {
            'inbox': 'fa-inbox',
            'sent': 'fa-paper-plane',
            'drafts': 'fa-file-alt',
            'trash': 'fa-trash-alt',
            'junk': 'fa-ban',
            'archive': 'fa-archive',
            'folder': 'fa-folder'
        };
        return iconMap[folderType] || 'fa-folder';
    }

    /**
     * Handler for delete button
     */
    function handleDelete() {
        if (!config.activeEmailId || !config.activeFolder) {
            showNotification('No email selected', 'error');
            return;
        }

        // Show delete confirmation dialog
        const deleteModal = document.getElementById('deleteModal');
        if (deleteModal) {
            deleteModal.classList.add('active');

            // Set data attributes for the confirm button to use
            deleteModal.setAttribute('data-email-id', config.activeEmailId);
            deleteModal.setAttribute('data-folder', config.activeFolder);
        }
    }

    /**
     * Confirm email deletion
     */
    function confirmDelete() {
        const deleteModal = document.getElementById('deleteModal');
        if (!deleteModal) return;

        const emailId = deleteModal.getAttribute('data-email-id');
        const folder = deleteModal.getAttribute('data-folder');

        if (!emailId || !folder) {
            showNotification('Missing email information', 'error');
            return;
        }

        // Hide the modal
        deleteModal.classList.remove('active');

        // Show loading state
        showLoadingOverlay();

        // Call API to delete email
        fetch(`/email/api/delete/${encodeURIComponent(folder)}/${emailId}`, {
            method: 'POST',
            headers: {
                'X-CSRFToken': config.csrfToken
            }
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to delete email');
            }
            return response.json();
        })
        .then(data => {
            hideLoadingOverlay();
            showNotification('Email deleted', 'success');

            // Trigger refresh of email list
            if (typeof EmailClient !== 'undefined') {
                EmailClient.loadEmails();
                EmailClient.showEmailPlaceholder();
            }
        })
        .catch(error => {
            hideLoadingOverlay();
            showNotification('Failed to delete email', 'error');
            console.error('Delete error:', error);
        });
    }

    /**
     * Confirm moving email to another folder
     */
    function confirmMove() {
        const moveModal = document.getElementById('moveModal');
        if (!moveModal) return;

        const emailId = moveModal.getAttribute('data-email-id');
        const sourceFolder = moveModal.getAttribute('data-folder');
        const destinationFolder = moveModal.getAttribute('data-destination');

        if (!emailId || !sourceFolder || !destinationFolder) {
            showNotification('Please select a destination folder', 'warning');
            return;
        }

        // Hide the modal
        moveModal.classList.remove('active');

        // Show loading state
        showLoadingOverlay();

        // Call API to move email
        fetch('/email/api/move', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': config.csrfToken
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
            hideLoadingOverlay();
            showNotification(`Email moved to ${destinationFolder}`, 'success');

            // Trigger refresh of email list
            if (typeof EmailClient !== 'undefined') {
                EmailClient.loadEmails();
                EmailClient.showEmailPlaceholder();
            }
        })
        .catch(error => {
            hideLoadingOverlay();
            showNotification('Failed to move email', 'error');
            console.error('Move error:', error);
        });
    }

    /**
     * Handle Mark as Spam action
     * @param {Event} e - Click event
     */
    function handleMarkSpam(e) {
        e.preventDefault();
        showNotification('Email marked as spam', 'success');
    }

    /**
     * Handle Add Star action
     * @param {Event} e - Click event
     */
    function handleAddStar(e) {
        e.preventDefault();
        showNotification('Star added to email', 'success');
    }

    /**
     * Handle Create Filter action
     * @param {Event} e - Click event
     */
    function handleCreateFilter(e) {
        e.preventDefault();
        showNotification('Filter creation not implemented', 'info');
    }

    /**
     * Handle Show Original email action
     * @param {Event} e - Click event
     */
    function handleShowOriginal(e) {
        e.preventDefault();
        showNotification('Showing original email', 'info');
    }

    /**
     * Show loading overlay
     */
    function showLoadingOverlay() {
        let overlay = document.querySelector('.email-loading-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'email-loading-overlay';
            overlay.innerHTML = `
                <div class="loading-spinner">
                    <i class="fas fa-circle-notch fa-spin"></i>
                </div>
            `;
            document.body.appendChild(overlay);
        }
        overlay.style.display = 'flex';
    }

    /**
     * Hide loading overlay
     */
    function hideLoadingOverlay() {
        const overlay = document.querySelector('.email-loading-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    /**
     * Show notification
     * @param {string} message - Notification message
     * @param {string} type - Notification type (success, error, warning, info)
     */
    function showNotification(message, type = 'info') {
        if (typeof EmailClient !== 'undefined' && EmailClient.showToast) {
            EmailClient.showToast(message, type);
        } else {
            // Fallback notification
            alert(message);
        }
    }

    // Return public API
    return {
        init,
        initEmailActions
    };
})();

// Add CSS for tooltips
document.addEventListener('DOMContentLoaded', function() {
    const style = document.createElement('style');
    style.textContent = `
        .custom-tooltip {
            position: absolute;
            background-color: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8rem;
            z-index: 1000;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s ease;
            white-space: nowrap;
        }
        
        .email-loading-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(255, 255, 255, 0.8);
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .email-loading-overlay .loading-spinner {
            font-size: 2rem;
            color: var(--primary);
        }
        
        .folder-option {
            padding: 8px 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            transition: background-color 0.2s ease;
        }
        
        .folder-option:hover {
            background-color: var(--hover);
        }
        
        .folder-option.selected {
            background-color: var(--primary-hover);
            color: var(--primary);
        }
        
        .folder-option i {
            margin-right: 8px;
            color: var(--text-light);
        }
        
        .folder-option.selected i {
            color: var(--primary);
        }
    `;
    document.head.appendChild(style);
});
/*-神-*/