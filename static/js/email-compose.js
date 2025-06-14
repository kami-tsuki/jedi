/**
 * Email Client - Compose Email Functionality
 *
 * This module handles email composition functionality:
 * - Rich text editor with formatting controls
 * - File attachments via drag-and-drop or file selection
 * - Email reply and forwarding
 * - Draft saving
 * - Form validation and submission
 */

const EmailCompose = (function() {
    'use strict';

    // Internal state
    const state = {
        isRichText: true,
        attachmentsData: []
    };

    // Cached elements
    let elements = {};

    /**
     * Initialize the compose email functionality
     * @param {Object} options - Configuration options
     */
    function init(options = {}) {
        // Cache DOM elements
        cacheElements();

        // Load folders in the sidebar
        loadFolders();

        // Set up event handlers
        setupEventHandlers();

        // Setup rich text editor toolbar
        setupRichTextEditor();

        // Setup file upload functionality
        setupFileUploads();

        // Initialize email if it's a reply or forward
        if (options.replyTo || options.forward) {
            loadEmailForReplyOrForward(options);
        }

        // Expose attachments data to global scope for form submission
        window.attachmentsData = state.attachmentsData;
    }

    /**
     * Cache frequently accessed DOM elements
     */
    function cacheElements() {
        elements = {
            composeForm: document.getElementById('composeForm'),
            toField: document.getElementById('to'),
            ccField: document.getElementById('cc'),
            bccField: document.getElementById('bcc'),
            ccContainer: document.getElementById('ccField'),
            bccContainer: document.getElementById('bccField'),
            subjectField: document.getElementById('subject'),
            richTextEditor: document.getElementById('richTextEditor'),
            plainTextEditor: document.getElementById('plainTextEditor'),
            bodyContentField: document.getElementById('bodyContent'),
            htmlContentField: document.getElementById('htmlContent'),
            attachmentsInput: document.getElementById('attachments'),
            attachmentsList: document.getElementById('attachmentsList'),
            attachmentDropzone: document.getElementById('attachmentDropzone'),
            sendingOverlay: document.getElementById('sendingOverlay'),
            showCcBtn: document.getElementById('showCcBtn'),
            showBccBtn: document.getElementById('showBccBtn'),
            plainTextToggle: document.getElementById('plainTextToggle'),
            discardBtn: document.getElementById('discardBtn'),
            saveDraftBtn: document.getElementById('saveDraftBtn')
        };
    }

    /**
     * Set up event handlers
     */
    function setupEventHandlers() {
        // Show/hide CC and BCC fields
        if (elements.showCcBtn) {
            elements.showCcBtn.addEventListener('click', () => {
                elements.ccContainer.style.display = 'block';
                elements.showCcBtn.style.display = 'none';
            });
        }

        if (elements.showBccBtn) {
            elements.showBccBtn.addEventListener('click', () => {
                elements.bccContainer.style.display = 'block';
                elements.showBccBtn.style.display = 'none';
            });
        }

        // Toggle between rich text and plain text editor
        if (elements.plainTextToggle) {
            elements.plainTextToggle.addEventListener('click', toggleEditorMode);
        }

        // Handle form submission
        if (elements.composeForm) {
            elements.composeForm.addEventListener('submit', function(e) {
                e.preventDefault();
                sendEmail();
            });
        }

        // Handle discard button
        if (elements.discardBtn) {
            elements.discardBtn.addEventListener('click', function() {
                if (confirm('Are you sure you want to discard this email?')) {
                    window.location.href = '/email/inbox';
                }
            });
        }

        // Handle save draft button
        if (elements.saveDraftBtn) {
            elements.saveDraftBtn.addEventListener('click', function() {
                // TODO: Implement save draft functionality
                alert('Save draft functionality coming soon!');
            });
        }
    }

    /**
     * Toggle between rich text and plain text editor modes
     */
    function toggleEditorMode() {
        if (state.isRichText) {
            // Switch to plain text
            elements.plainTextEditor.value = richTextToPlainText(elements.richTextEditor.innerHTML);
            elements.richTextEditor.style.display = 'none';
            elements.plainTextEditor.style.display = 'block';
            elements.plainTextToggle.innerHTML = '<i class="fas fa-eye"></i>';
            elements.plainTextToggle.title = 'Switch to Rich Text';
        } else {
            // Switch to rich text
            elements.richTextEditor.innerHTML = plainTextToHtml(elements.plainTextEditor.value);
            elements.richTextEditor.style.display = 'block';
            elements.plainTextEditor.style.display = 'none';
            elements.plainTextToggle.innerHTML = '<i class="fas fa-code"></i>';
            elements.plainTextToggle.title = 'Switch to Plain Text';
        }
        state.isRichText = !state.isRichText;
    }

    /**
     * Setup the rich text editor functionality
     */
    function setupRichTextEditor() {
        const formatButtons = document.querySelectorAll('.format-btn');

        // Add click handlers to all formatting buttons
        formatButtons.forEach(button => {
            const format = button.getAttribute('data-format');
            if (!format) return;

            button.addEventListener('click', () => {
                if (format === 'createLink') {
                    openLinkDialog();
                } else {
                    document.execCommand(format, false, null);
                    elements.richTextEditor.focus();
                }
            });
        });

        // Focus rich text editor on load
        elements.richTextEditor.focus();

        // Set up link dialog
        setupLinkDialog();
    }

    /**
     * Set up link dialog functionality
     */
    function setupLinkDialog() {
        const linkDialog = document.getElementById('linkDialog');
        if (!linkDialog) return;

        const linkUrl = document.getElementById('linkUrl');
        const linkText = document.getElementById('linkText');
        const insertLinkBtn = document.getElementById('insertLinkBtn');
        const cancelLinkBtn = document.getElementById('cancelLinkBtn');
        const closeModal = linkDialog.querySelector('.close-modal');

        // Store selection for link insertion
        let storedSelection = null;

        window.openLinkDialog = function() {
            // Store current selection
            storedSelection = saveSelection();

            // Get selected text
            const selectedText = window.getSelection().toString();

            // Prefill link dialog if text is selected
            if (linkUrl) linkUrl.value = '';
            if (linkText) linkText.value = selectedText;

            // Show dialog
            linkDialog.style.display = 'flex';
            if (linkUrl) linkUrl.focus();
        };

        // Insert link button
        if (insertLinkBtn) {
            insertLinkBtn.addEventListener('click', () => {
                if (!linkUrl) return;

                const url = linkUrl.value;
                const text = linkText?.value || '';

                if (url) {
                    // Restore selection
                    restoreSelection(storedSelection);

                    if (text && !window.getSelection().toString()) {
                        // Insert new link with text
                        document.execCommand('insertHTML', false, `<a href="${url}" target="_blank">${text}</a>`);
                    } else {
                        // Create link from selection
                        document.execCommand('createLink', false, url);

                        // Set target="_blank" for the newly created link
                        const selection = window.getSelection();
                        if (selection.rangeCount > 0) {
                            const links = elements.richTextEditor.querySelectorAll('a');
                            links.forEach(link => {
                                if (link.href === url) {
                                    link.target = '_blank';
                                }
                            });
                        }
                    }
                }

                // Close dialog
                linkDialog.style.display = 'none';
            });
        }

        // Cancel button
        if (cancelLinkBtn) {
            cancelLinkBtn.addEventListener('click', () => {
                linkDialog.style.display = 'none';
            });
        }

        // Close button
        if (closeModal) {
            closeModal.addEventListener('click', () => {
                linkDialog.style.display = 'none';
            });
        }

        // Close when clicking outside
        window.addEventListener('click', function(e) {
            if (e.target === linkDialog) {
                linkDialog.style.display = 'none';
            }
        });
    }

    /**
     * Helper function to save selection state
     * @returns {Range|null} The selected range
     */
    function saveSelection() {
        if (window.getSelection) {
            const sel = window.getSelection();
            if (sel.getRangeAt && sel.rangeCount) {
                return sel.getRangeAt(0);
            }
        }
        return null;
    }

    /**
     * Helper function to restore selection state
     * @param {Range} range - The range to select
     */
    function restoreSelection(range) {
        if (range) {
            if (window.getSelection) {
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            }
        }
    }

    /**
     * Setup file upload functionality
     */
    function setupFileUploads() {
        // Handle file input change
        if (elements.attachmentsInput) {
            elements.attachmentsInput.addEventListener('change', handleFileUpload);
        }

        // Handle drag and drop
        if (elements.attachmentDropzone) {
            elements.attachmentDropzone.addEventListener('dragover', function(e) {
                e.preventDefault();
                e.stopPropagation();
                this.classList.add('dragover');
            });

            elements.attachmentDropzone.addEventListener('dragleave', function(e) {
                e.preventDefault();
                e.stopPropagation();
                this.classList.remove('dragover');
            });

            elements.attachmentDropzone.addEventListener('drop', function(e) {
                e.preventDefault();
                e.stopPropagation();
                this.classList.remove('dragover');

                if (e.dataTransfer.files.length) {
                    handleFiles(e.dataTransfer.files);
                }
            });
        }
    }

    /**
     * Handle file upload from input field
     * @param {Event} e - Change event
     */
    function handleFileUpload(e) {
        const files = elements.attachmentsInput.files;
        if (files.length) {
            handleFiles(files);
        }
    }

    /**
     * Process files for attachment
     * @param {FileList} files - List of files to process
     */
    function handleFiles(files) {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];

            // Check file size (limit to 10MB)
            if (file.size > 10 * 1024 * 1024) {
                alert(`File ${file.name} is too large. Maximum file size is 10MB.`);
                continue;
            }

            // Read file
            const reader = new FileReader();
            reader.onload = function(e) {
                const attachment = {
                    filename: file.name,
                    content_type: file.type,
                    size: file.size,
                    content: e.target.result.split(',')[1] // Remove data URL prefix
                };

                // Add to attachments array
                state.attachmentsData.push(attachment);
                window.attachmentsData = state.attachmentsData;

                // Display attachment
                displayAttachment(attachment, state.attachmentsData.length - 1);
            };
            reader.readAsDataURL(file);
        }

        // Reset file input
        if (elements.attachmentsInput) {
            elements.attachmentsInput.value = '';
        }
    }

    /**
     * Display attachment in the UI
     * @param {Object} attachment - Attachment data
     * @param {number} index - Index in attachments array
     */
    function displayAttachment(attachment, index) {
        if (!elements.attachmentsList) return;

        const attachmentItem = document.createElement('div');
        attachmentItem.className = 'attachment-item';
        attachmentItem.dataset.index = index;

        // Determine icon based on file type
        let iconClass = 'fa-file';
        const fileType = attachment.content_type;
        const fileExtension = attachment.filename.split('.').pop().toLowerCase();

        if (fileType.startsWith('image/')) {
            iconClass = 'fa-file-image';
        } else if (fileType === 'application/pdf') {
            iconClass = 'fa-file-pdf';
        } else if (fileType.includes('word') || fileExtension === 'doc' || fileExtension === 'docx') {
            iconClass = 'fa-file-word';
        } else if (fileType.includes('sheet') || fileType.includes('excel') || fileExtension === 'xls' || fileExtension === 'xlsx') {
            iconClass = 'fa-file-excel';
        } else if (fileType.includes('presentation') || fileExtension === 'ppt' || fileExtension === 'pptx') {
            iconClass = 'fa-file-powerpoint';
        } else if (fileType.includes('zip') || fileType.includes('archive') || ['zip', 'rar', '7z', 'tar', 'gz'].includes(fileExtension)) {
            iconClass = 'fa-file-archive';
        } else if (fileType.includes('text/') || fileExtension === 'txt') {
            iconClass = 'fa-file-alt';
        }

        // Format size
        const formattedSize = formatFileSize(attachment.size);

        attachmentItem.innerHTML = `
            <i class="fas ${iconClass}"></i>
            <span class="attachment-name">${escapeHtml(attachment.filename)}</span>
            <button type="button" class="remove-attachment" title="Remove">
                <i class="fas fa-times"></i>
            </button>
        `;

        elements.attachmentsList.appendChild(attachmentItem);

        // Add remove functionality
        const removeBtn = attachmentItem.querySelector('.remove-attachment');
        removeBtn.addEventListener('click', function() {
            state.attachmentsData.splice(index, 1);
            window.attachmentsData = state.attachmentsData;
            attachmentItem.remove();

            // Re-index remaining attachments
            const remainingItems = elements.attachmentsList.querySelectorAll('.attachment-item');
            remainingItems.forEach((item, i) => {
                item.dataset.index = i;
            });
        });
    }

    /**
     * Send email
     */
    function sendEmail() {
        // Show sending overlay
        if (elements.sendingOverlay) {
            elements.sendingOverlay.style.display = 'flex';
        }

        // Gather form data
        const to = elements.toField ? elements.toField.value : '';
        const cc = elements.ccField ? elements.ccField.value : '';
        const bcc = elements.bccField ? elements.bccField.value : '';
        const subject = elements.subjectField ? elements.subjectField.value : '';

        // Get body content based on current editor mode
        let body, htmlBody;
        if (state.isRichText) {
            htmlBody = elements.richTextEditor ? elements.richTextEditor.innerHTML : '';
            body = richTextToPlainText(htmlBody);
        } else {
            body = elements.plainTextEditor ? elements.plainTextEditor.value : '';
            htmlBody = plainTextToHtml(body);
        }

        // Create email data object
        const emailData = {
            to: to,
            subject: subject,
            body: body,
            html_body: htmlBody
        };

        // Add CC and BCC if provided
        if (cc) emailData.cc = cc;
        if (bcc) emailData.bcc = bcc;

        // Add attachments if any
        if (state.attachmentsData.length > 0) {
            emailData.attachments = state.attachmentsData;
        }

        // Send the email
        fetch('/email/api/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(emailData)
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to send email');
            }
            return response.json();
        })
        .then(data => {
            // Show success and redirect
            showNotification('Email sent successfully', 'success');
            window.location.href = '/email/inbox';
        })
        .catch(error => {
            console.error('Error sending email:', error);

            // Hide overlay
            if (elements.sendingOverlay) {
                elements.sendingOverlay.style.display = 'none';
            }

            // Show error
            showNotification('Failed to send email: ' + error.message, 'error');
        });
    }

    /**
     * Load email content for reply or forward
     * @param {Object} options - Email options
     */
    function loadEmailForReplyOrForward(options) {
        const folder = options.folder;
        let emailId;
        let isReply = false;
        let isReplyAll = false;
        let isForward = false;

        if (options.replyTo) {
            emailId = options.replyTo;
            isReply = true;
            isReplyAll = options.replyAll;
        } else if (options.forward) {
            emailId = options.forward;
            isForward = true;
        }

        if (!emailId) return;

        // Show loading in editor
        if (elements.richTextEditor) {
            elements.richTextEditor.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Loading email content...';
        }

        // Fetch email content
        fetch(`/email/api/email/${encodeURIComponent(folder)}/${emailId}`)
            .then(response => {
                if (!response.ok) throw new Error('Failed to load email');
                return response.json();
            })
            .then(data => {
                if (isReply || isReplyAll) {
                    // Set up reply
                    setupReply(data, isReplyAll);
                } else if (isForward) {
                    // Set up forward
                    setupForward(data);
                }
            })
            .catch(error => {
                console.error('Error loading email:', error);
                if (elements.richTextEditor) {
                    elements.richTextEditor.innerHTML = '<p style="color: red;">Error loading email content. Please try again.</p>';
                }
                showNotification('Failed to load email content', 'error');
            });
    }

    /**
     * Set up reply to email
     * @param {Object} email - Email data
     * @param {boolean} replyAll - Whether to reply to all recipients
     */
    function setupReply(email, replyAll) {
        // Extract sender email from the From field
        const fromMatch = email.from.match(/<([^>]+)>/);
        const replyToEmail = fromMatch ? fromMatch[1] : email.from;

        // Set to field to the sender
        if (elements.toField) {
            elements.toField.value = replyToEmail;
        }

        // Set CC field if reply all
        if (replyAll && email.cc && elements.ccField) {
            if (elements.ccContainer) {
                elements.ccContainer.style.display = 'block';
            }
            elements.ccField.value = email.cc;

            if (elements.showCcBtn) {
                elements.showCcBtn.style.display = 'none';
            }
        }

        // Set subject with Re: prefix if not already there
        const subject = email.subject || '';
        if (elements.subjectField) {
            elements.subjectField.value = subject.startsWith('Re:') ? subject : 'Re: ' + subject;
        }

        // Create reply body
        const date = new Date(email.date);
        const formattedDate = date.toLocaleString();
        const quoteHeader = `On ${formattedDate}, ${email.from} wrote:`;

        let replyBody = '';
        if (email.html_body) {
            // Use HTML content
            replyBody = `
                <p>
                    <br><br>
                    <div class="reply-header">${quoteHeader}</div>
                    <blockquote style="border-left: 2px solid #ccc; padding-left: 10px; margin-left: 10px; color: #555;">
                        ${email.html_body}
                    </blockquote>
                </p>
            `;
        } else {
            // Use plain text content
            let quotedText = email.plain_body || '';
            quotedText = quotedText.split('\n').map(line => '> ' + line).join('\n');

            replyBody = `
                <p>
                    <br><br>
                    <div class="reply-header">${quoteHeader}</div>
                    <pre style="font-family: monospace; color: #555;">${quotedText}</pre>
                </p>
            `;
        }

        // Set reply body in editor
        if (elements.richTextEditor) {
            elements.richTextEditor.innerHTML = replyBody;
            // Place cursor at the beginning of the editor
            setCaretToBeginning(elements.richTextEditor);
        }
    }

    /**
     * Set up forward email
     * @param {Object} email - Email data
     */
    function setupForward(email) {
        // Set subject with Fwd: prefix if not already there
        const subject = email.subject || '';
        if (elements.subjectField) {
            elements.subjectField.value = subject.startsWith('Fwd:') ? subject : 'Fwd: ' + subject;
        }

        // Create forward body
        let forwardBody = `
            <p><br><br></p>
            <div class="forward-header" style="border-bottom: 1px solid #ccc; padding-bottom: 5px; margin-bottom: 10px;">
                <div><strong>From:</strong> ${email.from}</div>
                <div><strong>Date:</strong> ${email.date}</div>
                <div><strong>Subject:</strong> ${email.subject}</div>
                <div><strong>To:</strong> ${email.to}</div>
                ${email.cc ? `<div><strong>Cc:</strong> ${email.cc}</div>` : ''}
            </div>
        `;

        // Add email content
        if (email.html_body) {
            forwardBody += email.html_body;
        } else {
            forwardBody += `<pre style="font-family: monospace;">${email.plain_body || ''}</pre>`;
        }

        // Set forward body in editor
        if (elements.richTextEditor) {
            elements.richTextEditor.innerHTML = forwardBody;
            // Place cursor at the beginning of the editor
            setCaretToBeginning(elements.richTextEditor);
        }

        // Add forwarded attachments if any
        if (email.attachments && email.attachments.length > 0) {
            email.attachments.forEach(attachment => {
                state.attachmentsData.push(attachment);
                window.attachmentsData = state.attachmentsData;
                displayAttachment(attachment, state.attachmentsData.length - 1);
            });
        }
    }

    /**
     * Place cursor at the beginning of the editor
     * @param {HTMLElement} element - Editor element
     */
    function setCaretToBeginning(element) {
        const range = document.createRange();
        const selection = window.getSelection();

        // Check if the editor has child nodes
        if (element.childNodes.length > 0) {
            // Set caret at the beginning of the first node
            range.setStart(element, 0);
        } else {
            // If no child nodes, just set focus
            range.setStart(element, 0);
        }

        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        element.focus();
    }

    /**
     * Load folders in the sidebar
     */
    function loadFolders() {
        const folderTree = document.getElementById('folderTree');
        if (!folderTree) return;

        fetch('/email/api/folders/render')
            .then(response => response.json())
            .then(data => {
                folderTree.innerHTML = data.html;
                setupFolderItemHandlers();
            })
            .catch(error => {
                console.error('Error loading folders:', error);
                folderTree.innerHTML = `
                    <div class="error-message">
                        <i class="fas fa-exclamation-circle"></i>
                        Failed to load folders
                    </div>
                `;
            });
    }

    /**
     * Set up event handlers for folder items
     */
    function setupFolderItemHandlers() {
        const folderItems = document.querySelectorAll('.folder-item');

        folderItems.forEach(item => {
            const folderName = item.querySelector('.folder-name');
            const toggleBtn = item.querySelector('.folder-toggle');

            if (folderName) {
                folderName.addEventListener('click', function(e) {
                    e.preventDefault();
                    const folderPath = item.getAttribute('data-folder');
                    if (folderPath) {
                        window.location.href = `/email/folder/${encodeURIComponent(folderPath)}`;
                    }
                });
            }

            if (toggleBtn) {
                toggleBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    const subfolderList = item.querySelector('.subfolder-list');
                    const toggleIcon = toggleBtn.querySelector('i');

                    toggleBtn.classList.toggle('expanded');
                    if (subfolderList) {
                        if (subfolderList.classList.contains('hidden')) {
                            subfolderList.classList.replace('hidden', 'visible');
                            if (toggleIcon) toggleIcon.classList.replace('fa-chevron-right', 'fa-chevron-down');
                        } else {
                            subfolderList.classList.replace('visible', 'hidden');
                            if (toggleIcon) toggleIcon.classList.replace('fa-chevron-down', 'fa-chevron-right');
                        }
                    }
                });
            }
        });
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
        if (bytes === 0) return '0 Bytes';

        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Convert HTML to plain text
     * @param {string} html - HTML content to convert
     * @returns {string} Plain text
     */
    function richTextToPlainText(html) {
        // Create a temporary element to hold the HTML
        const temp = document.createElement('div');
        temp.innerHTML = html;

        // Process blockquotes for email replies
        const blockquotes = temp.querySelectorAll('blockquote');
        blockquotes.forEach(quote => {
            const text = quote.textContent;
            const lines = text.split('\n').map(line => '> ' + line).join('\n');
            const pre = document.createElement('pre');
            pre.textContent = lines;
            quote.parentNode.replaceChild(pre, quote);
        });

        // Process links
        const links = temp.querySelectorAll('a');
        links.forEach(link => {
            const href = link.getAttribute('href');
            const text = link.textContent;
            if (href && text && href !== text) {
                const newText = document.createTextNode(`${text} (${href})`);
                link.parentNode.replaceChild(newText, link);
            }
        });

        // Handle paragraphs, divs, and line breaks
        const blocks = temp.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6');
        blocks.forEach(block => {
            // Add a newline after block elements
            block.innerHTML = block.innerHTML + '\n';
        });

        // Replace <br> with newlines
        temp.innerHTML = temp.innerHTML.replace(/<br\s*\/?>/gi, '\n');

        // Get plain text
        return temp.textContent || temp.innerText || '';
    }

    /**
     * Convert plain text to simple HTML
     * @param {string} text - Plain text to convert
     * @returns {string} HTML content
     */
    function plainTextToHtml(text) {
        if (!text) return '';

        // Escape HTML
        let html = escapeHtml(text);

        // Convert line breaks to <br>
        html = html.replace(/\n/g, '<br>');

        // Convert URLs to links
        html = html.replace(
            /(https?:\/\/[^\s]+)/g,
            '<a href="$1" target="_blank">$1</a>'
        );

        // Convert quoted lines (>) to blockquotes
        let inQuote = false;
        let quoteContent = '';
        const lines = html.split('<br>');
        const processedLines = [];

        for (const line of lines) {
            if (line.startsWith('&gt; ') || line === '&gt;') {
                // This is a quoted line
                if (!inQuote) {
                    inQuote = true;
                    quoteContent = line.substring(5); // Remove '&gt; '
                } else {
                    quoteContent += '<br>' + line.substring(5);
                }
            } else {
                // Not a quoted line
                if (inQuote) {
                    // End previous quote
                    processedLines.push('<blockquote style="border-left: 2px solid #ccc; padding-left: 10px; margin-left: 10px; color: #555;">' + quoteContent + '</blockquote>');
                    inQuote = false;
                    quoteContent = '';
                }
                processedLines.push(line);
            }
        }

        // Handle case where quote is at the end
        if (inQuote) {
            processedLines.push('<blockquote style="border-left: 2px solid #ccc; padding-left: 10px; margin-left: 10px; color: #555;">' + quoteContent + '</blockquote>');
        }

        return processedLines.join('<br>');
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
        init
    };
})();

// Backward compatibility for existing code
function initComposeEmail(options) {
    EmailCompose.init(options);
}
