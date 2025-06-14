/**
 * Email Client - View Email Functionality
 *
 * This module handles email viewing functionality:
 * - Loading and displaying email content
 * - Handling email actions (reply, delete, etc.)
 * - Displaying email attachments
 * - HTML content sanitization
 * - Toggle between HTML and plain text views
 */

const EmailView = (function() {
    'use strict';

    // Configuration
    let config = {
        emailId: null,
        folder: null,
        csrfToken: null
    };

    // Cached DOM elements
    let elements = {};

    /**
     * Initialize the email view functionality
     * @param {string} folder - Folder containing the email
     * @param {string} emailId - ID of the email to display
     */
    function init(folder, emailId) {
        if (!folder || !emailId) {
            console.error('Email view initialization failed: Missing folder or emailId');
            return;
        }

        // Set config
        config.folder = folder;
        config.emailId = emailId;
        config.csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

        // Cache DOM elements
        cacheElements();

        // Load email content
        loadEmailContent(folder, emailId);
    }

    /**
     * Cache frequently accessed DOM elements
     */
    function cacheElements() {
        elements = {
            emailLoading: document.getElementById('emailLoading'),
            emailContent: document.getElementById('emailContent'),
            emailError: document.getElementById('emailError'),
            emailSubject: document.getElementById('emailSubject'),
            emailFrom: document.getElementById('emailFrom'),
            emailTo: document.getElementById('emailTo'),
            emailCcContainer: document.getElementById('emailCcContainer'),
            emailCc: document.getElementById('emailCc'),
            emailDate: document.getElementById('emailDate'),
            emailBodyHtml: document.getElementById('emailBodyHtml'),
            emailBodyText: document.getElementById('emailBodyText'),
            toggleViewBtn: document.getElementById('toggleViewBtn'),
            emailAttachments: document.getElementById('emailAttachments'),
            errorMessage: document.getElementById('errorMessage'),
            retryButton: document.getElementById('retryButton')
        };
    }

    /**
     * Load email content for viewing
     * @param {string} folder - Folder containing the email
     * @param {string} emailId - ID of the email to display
     */
    function loadEmailContent(folder, emailId) {
        // Show loading state
        if (elements.emailLoading) {
            elements.emailLoading.style.display = 'flex';
        }

        if (elements.emailContent) {
            elements.emailContent.style.display = 'none';
        }

        if (elements.emailError) {
            elements.emailError.style.display = 'none';
        }

        // API request to get email details
        fetch(`/email/api/email/${encodeURIComponent(folder)}/${emailId}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to load email: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                populateEmailView(data);

                // Hide loading, show content
                if (elements.emailLoading) {
                    elements.emailLoading.style.display = 'none';
                }

                if (elements.emailContent) {
                    elements.emailContent.style.display = 'block';
                }

                // Setup action buttons
                setupEmailActions(data);
            })
            .catch(error => {
                console.error('Error loading email:', error);

                // Show error message
                if (elements.emailLoading) {
                    elements.emailLoading.style.display = 'none';
                }

                if (elements.emailError) {
                    elements.emailError.style.display = 'block';
                }

                if (elements.errorMessage) {
                    elements.errorMessage.textContent =
                        `There was a problem loading this email: ${error.message}`;
                }

                // Setup retry button
                if (elements.retryButton) {
                    elements.retryButton.addEventListener('click', () => {
                        loadEmailContent(folder, emailId);
                    });
                }
            });
    }

    /**
     * Populate email view with data
     * @param {Object} email - Email data
     */
    function populateEmailView(email) {
        // Set subject
        if (elements.emailSubject) {
            elements.emailSubject.textContent = email.subject || '(No subject)';
        }

        // Set sender
        if (elements.emailFrom) {
            elements.emailFrom.textContent = email.from || '';
        }

        // Set recipients
        if (elements.emailTo) {
            elements.emailTo.textContent = email.to || '';
        }

        // Set CC if exists
        if (email.cc && elements.emailCcContainer && elements.emailCc) {
            elements.emailCcContainer.style.display = 'block';
            elements.emailCc.textContent = email.cc;
        } else if (elements.emailCcContainer) {
            elements.emailCcContainer.style.display = 'none';
        }

        // Set date
        if (elements.emailDate) {
            elements.emailDate.textContent = email.date || '';
        }

        // Set body content
        if (elements.emailBodyHtml && elements.emailBodyText && elements.toggleViewBtn) {
            // Set content
            if (email.html_body) {
                // Create a sanitized version of the HTML content
                elements.emailBodyHtml.innerHTML = sanitizeHtml(email.html_body);
                elements.emailBodyText.textContent = email.plain_body || '';

                // Default to HTML view
                elements.emailBodyHtml.style.display = 'block';
                elements.emailBodyText.style.display = 'none';
                elements.toggleViewBtn.innerHTML = '<i class="fas fa-code"></i> View Plain Text';

                // Toggle button functionality
                setupViewToggle();
            } else {
                // Only plain text available
                elements.emailBodyHtml.style.display = 'none';
                elements.emailBodyText.style.display = 'block';
                elements.emailBodyText.textContent = email.plain_body || '(No content)';
                elements.toggleViewBtn.style.display = 'none';
            }
        }

        // Handle attachments
        handleAttachments(email);
    }

    /**
     * Set up toggle between HTML and plain text views
     */
    function setupViewToggle() {
        if (!elements.toggleViewBtn) return;

        let showingHtml = true;
        elements.toggleViewBtn.addEventListener('click', () => {
            if (showingHtml) {
                if (elements.emailBodyHtml) elements.emailBodyHtml.style.display = 'none';
                if (elements.emailBodyText) elements.emailBodyText.style.display = 'block';
                elements.toggleViewBtn.innerHTML = '<i class="fas fa-code"></i> View HTML';
            } else {
                if (elements.emailBodyHtml) elements.emailBodyHtml.style.display = 'block';
                if (elements.emailBodyText) elements.emailBodyText.style.display = 'none';
                elements.toggleViewBtn.innerHTML = '<i class="fas fa-code"></i> View Plain Text';
            }
            showingHtml = !showingHtml;
        });
    }

    /**
     * Handle email attachments
     * @param {Object} email - Email data
     */
    function handleAttachments(email) {
        if (!elements.emailAttachments) return;

        const attachmentsList = elements.emailAttachments.querySelector('.attachment-list');
        if (!attachmentsList) return;

        if (email.attachments && email.attachments.length > 0) {
            elements.emailAttachments.style.display = 'block';

            // Create attachment elements
            let attachmentsHtml = '';

            email.attachments.forEach(attachment => {
                const fileExtension = attachment.filename.split('.').pop().toLowerCase();
                let iconClass = getFileIconClass(fileExtension, attachment.content_type);

                // Format file size
                const formattedSize = formatFileSize(attachment.size);

                attachmentsHtml += `
                    <div class="attachment-item">
                        <div class="attachment-icon">
                            <i class="fas ${iconClass}"></i>
                        </div>
                        <div class="attachment-details">
                            <div class="attachment-name">${escapeHtml(attachment.filename)}</div>
                            <div class="attachment-meta">${formattedSize}</div>
                        </div>
                        <div class="attachment-actions">
                            <a href="/email/api/attachment/${encodeURIComponent(email.folder)}/${email.id}/${encodeURIComponent(attachment.filename)}" 
                               download="${escapeHtml(attachment.filename)}" 
                               class="attachment-download" 
                               title="Download">
                                <i class="fas fa-download"></i>
                            </a>
                        </div>
                    </div>
                `;
            });

            attachmentsList.innerHTML = attachmentsHtml;
        } else {
            elements.emailAttachments.style.display = 'none';
        }
    }

    /**
     * Get appropriate icon class for file type
     * @param {string} fileExtension - File extension
     * @param {string} contentType - MIME type
     * @returns {string} Icon CSS class
     */
    function getFileIconClass(fileExtension, contentType) {
        // Default icon
        let iconClass = 'fa-file';

        // Check based on file extension
        if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg'].includes(fileExtension)) {
            iconClass = 'fa-file-image';
        } else if (['pdf'].includes(fileExtension)) {
            iconClass = 'fa-file-pdf';
        } else if (['doc', 'docx'].includes(fileExtension)) {
            iconClass = 'fa-file-word';
        } else if (['xls', 'xlsx'].includes(fileExtension)) {
            iconClass = 'fa-file-excel';
        } else if (['ppt', 'pptx'].includes(fileExtension)) {
            iconClass = 'fa-file-powerpoint';
        } else if (['zip', 'rar', '7z'].includes(fileExtension)) {
            iconClass = 'fa-file-archive';
        } else if (['txt', 'log'].includes(fileExtension)) {
            iconClass = 'fa-file-alt';
        } else if (['mp3', 'wav', 'ogg'].includes(fileExtension)) {
            iconClass = 'fa-file-audio';
        } else if (['mp4', 'avi', 'mov', 'wmv'].includes(fileExtension)) {
            iconClass = 'fa-file-video';
        }

        // Check based on MIME type as fallback
        if (iconClass === 'fa-file' && contentType) {
            const mimePrefix = contentType.split('/')[0];

            if (mimePrefix === 'image') {
                iconClass = 'fa-file-image';
            } else if (mimePrefix === 'audio') {
                iconClass = 'fa-file-audio';
            } else if (mimePrefix === 'video') {
                iconClass = 'fa-file-video';
            }
        }

        return iconClass;
    }

    /**
     * Setup email action buttons
     * @param {Object} email - Email data
     */
    function setupEmailActions(email) {
        const replyBtn = document.getElementById('replyBtn');
        const replyAllBtn = document.getElementById('replyAllBtn');
        const forwardBtn = document.getElementById('forwardBtn');
        const deleteBtn = document.getElementById('deleteBtn');

        // Reply button
        if (replyBtn) {
            replyBtn.addEventListener('click', () => {
                window.location.href = `/email/compose?reply_to=${email.id}&folder=${encodeURIComponent(email.folder)}`;
            });
        }

        // Reply All button
        if (replyAllBtn) {
            replyAllBtn.addEventListener('click', () => {
                window.location.href = `/email/compose?reply_to=${email.id}&reply_all=true&folder=${encodeURIComponent(email.folder)}`;
            });
        }

        // Forward button
        if (forwardBtn) {
            forwardBtn.addEventListener('click', () => {
                window.location.href = `/email/compose?forward=${email.id}&folder=${encodeURIComponent(email.folder)}`;
            });
        }

        // Delete button
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                if (confirm('Are you sure you want to delete this email?')) {
                    deleteEmail(email.id, email.folder);
                }
            });
        }
    }

    /**
     * Delete the current email
     * @param {string} emailId - ID of the email to delete
     * @param {string} folder - Folder containing the email
     */
    function deleteEmail(emailId, folder) {
        // Show loading state on delete button
        const deleteBtn = document.getElementById('deleteBtn');
        if (deleteBtn) {
            const originalBtnHtml = deleteBtn.innerHTML;
            deleteBtn.disabled = true;
            deleteBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Deleting...';

            fetch(`/email/api/delete/${encodeURIComponent(folder)}/${emailId}`, {
                method: 'POST',
                headers: {
                    'X-CSRFToken': config.csrfToken
                }
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to delete email: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                // Show success message
                showNotification('Email deleted successfully', 'success');

                // Redirect back to folder
                window.location.href = `/email/folder/${encodeURIComponent(folder)}`;
            })
            .catch(error => {
                console.error('Error deleting email:', error);
                showNotification('Failed to delete email: ' + error.message, 'error');

                // Reset button
                deleteBtn.disabled = false;
                deleteBtn.innerHTML = originalBtnHtml;
            });
        }
    }

    /**
     * Sanitize HTML to remove potential XSS
     * @param {string} html - HTML to sanitize
     * @returns {string} Sanitized HTML
     */
    function sanitizeHtml(html) {
        if (!html) return '';

        // Create a new DOMParser
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Remove potentially dangerous elements and attributes
        const dangerousElements = ['script', 'iframe', 'object', 'embed', 'base'];
        const dangerousAttributes = [
            'onload', 'onerror', 'onmouseenter', 'onmouseleave',
            'onclick', 'onmouseover', 'onkeydown', 'onkeypress', 'onkeyup'
        ];

        // Remove dangerous elements
        dangerousElements.forEach(tag => {
            const elements = doc.querySelectorAll(tag);
            elements.forEach(element => {
                element.remove();
            });
        });

        // Process all elements
        const allElements = doc.querySelectorAll('*');
        allElements.forEach(element => {
            // Remove dangerous attributes
            dangerousAttributes.forEach(attr => {
                element.removeAttribute(attr);
            });

            // Sanitize all URLs in attributes
            const urlAttributes = ['href', 'src', 'action'];
            urlAttributes.forEach(attr => {
                if (element.hasAttribute(attr)) {
                    const url = element.getAttribute(attr);
                    if (url && (url.toLowerCase().startsWith('javascript:') || url.toLowerCase().startsWith('data:'))) {
                        element.removeAttribute(attr);
                    }
                }
            });

            // Add target="_blank" and rel="noopener noreferrer" to external links
            if (element.tagName === 'A' && element.hasAttribute('href')) {
                const href = element.getAttribute('href');
                if (href && !href.startsWith('#') && !href.startsWith('/')) {
                    element.setAttribute('target', '_blank');
                    element.setAttribute('rel', 'noopener noreferrer');
                }
            }
        });

        // Set max width for images
        const images = doc.querySelectorAll('img');
        images.forEach(img => {
            img.style.maxWidth = '100%';
            img.style.height = 'auto';
        });

        return doc.body.innerHTML;
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

    /**
     * Format file size in human-readable format
     * @param {number} bytes - Size in bytes
     * @returns {string} Formatted size
     */
    function formatFileSize(bytes) {
        if (!bytes || bytes === 0) return '0 Bytes';

        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Escape HTML to prevent XSS
     * @param {string} text - Text to escape
     * @returns {string} Escaped HTML
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

    // Return public API
    return {
        init,
        loadEmailContent
    };
})();

// Backward compatibility for existing code
function loadEmailContent(folder, emailId) {
    EmailView.init(folder, emailId);
}
/*-神-*/