/**
 * Email Client - View Email Functionality
 */

/**
 * Load email content for viewing
 */
function loadEmailContent(folder, emailId) {
    const emailLoading = document.getElementById('emailLoading');
    const emailContent = document.getElementById('emailContent');
    const emailError = document.getElementById('emailError');

    // Show loading state
    emailLoading.style.display = 'flex';
    emailContent.style.display = 'none';
    emailError.style.display = 'none';

    // API request to get email details
    fetch(`/email/api/email/${encodeURIComponent(folder)}/${emailId}`)
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to load email');
            }
            return response.json();
        })
        .then(data => {
            populateEmailView(data);

            // Hide loading, show content
            emailLoading.style.display = 'none';
            emailContent.style.display = 'block';

            // Setup action buttons
            setupEmailActions(data);
        })
        .catch(error => {
            console.error('Error loading email:', error);

            // Show error message
            emailLoading.style.display = 'none';
            emailError.style.display = 'block';
            document.getElementById('errorMessage').textContent =
                `There was a problem loading this email: ${error.message}`;

            // Setup retry button
            document.getElementById('retryButton').addEventListener('click', () => {
                loadEmailContent(folder, emailId);
            });
        });
}

/**
 * Populate email view with data
 */
function populateEmailView(email) {
    // Set subject
    document.getElementById('emailSubject').textContent = email.subject || '(No subject)';

    // Set sender
    document.getElementById('emailFrom').textContent = email.from || '';

    // Set recipients
    document.getElementById('emailTo').textContent = email.to || '';

    // Set CC if exists
    if (email.cc) {
        document.getElementById('emailCcContainer').style.display = 'block';
        document.getElementById('emailCc').textContent = email.cc;
    } else {
        document.getElementById('emailCcContainer').style.display = 'none';
    }

    // Set date
    document.getElementById('emailDate').textContent = email.date || '';

    // Set body content
    const emailBodyHtml = document.getElementById('emailBodyHtml');
    const emailBodyText = document.getElementById('emailBodyText');
    const toggleViewBtn = document.getElementById('toggleViewBtn');

    // Set content
    if (email.html_body) {
        // Create a sanitized version of the HTML content
        emailBodyHtml.innerHTML = sanitizeHtml(email.html_body);
        emailBodyText.textContent = email.plain_body || '';

        // Default to HTML view
        emailBodyHtml.style.display = 'block';
        emailBodyText.style.display = 'none';
        toggleViewBtn.innerHTML = '<i class="fas fa-code"></i> View Plain Text';

        // Toggle button functionality
        let showingHtml = true;
        toggleViewBtn.addEventListener('click', () => {
            if (showingHtml) {
                emailBodyHtml.style.display = 'none';
                emailBodyText.style.display = 'block';
                toggleViewBtn.innerHTML = '<i class="fas fa-code"></i> View HTML';
            } else {
                emailBodyHtml.style.display = 'block';
                emailBodyText.style.display = 'none';
                toggleViewBtn.innerHTML = '<i class="fas fa-code"></i> View Plain Text';
            }
            showingHtml = !showingHtml;
        });
    } else {
        // Only plain text available
        emailBodyHtml.style.display = 'none';
        emailBodyText.style.display = 'block';
        emailBodyText.textContent = email.plain_body || '(No content)';
        toggleViewBtn.style.display = 'none';
    }

    // Handle attachments
    const attachmentsContainer = document.getElementById('emailAttachments');
    const attachmentsList = attachmentsContainer.querySelector('.attachment-list');

    if (email.attachments && email.attachments.length > 0) {
        attachmentsContainer.style.display = 'block';

        // Create attachment elements
        let attachmentsHtml = '';

        email.attachments.forEach(attachment => {
            const fileExtension = attachment.filename.split('.').pop().toLowerCase();
            let iconClass = 'fa-file';

            // Set icon based on file type
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
                           download="${encodeURIComponent(attachment.filename)}" 
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
        attachmentsContainer.style.display = 'none';
    }
}

/**
 * Setup email action buttons
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
 */
function deleteEmail(emailId, folder) {
    // Show loading state on delete button
    const deleteBtn = document.getElementById('deleteBtn');
    const originalBtnHtml = deleteBtn.innerHTML;
    deleteBtn.disabled = true;
    deleteBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Deleting...';

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

/**
 * Sanitize HTML to remove potential XSS
 */
function sanitizeHtml(html) {
    // Create a new DOMParser
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Remove potentially dangerous elements and attributes
    const dangerousElements = ['script', 'iframe', 'object', 'embed', 'base'];
    const dangerousAttributes = ['onload', 'onerror', 'onmouseenter', 'onmouseleave', 'onclick', 'onmouseover', 'onkeydown', 'onkeypress', 'onkeyup'];

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
 * Format file size in human-readable format
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
