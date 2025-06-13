/**
 * Email Client - Compose Email Functionality
 */

/**
 * Initialize the compose email page functionality
 */
function initComposeEmail(options) {
    // Load folders in the sidebar
    loadFolders();

    // Get form elements
    const composeForm = document.getElementById('composeForm');
    const toField = document.getElementById('to');
    const ccField = document.getElementById('cc');
    const bccField = document.getElementById('bcc');
    const ccContainer = document.getElementById('ccField');
    const bccContainer = document.getElementById('bccField');
    const subjectField = document.getElementById('subject');
    const richTextEditor = document.getElementById('richTextEditor');
    const plainTextEditor = document.getElementById('plainTextEditor');
    const bodyContentField = document.getElementById('bodyContent');
    const htmlContentField = document.getElementById('htmlContent');
    const attachmentsInput = document.getElementById('attachments');
    const attachmentsList = document.getElementById('attachmentsList');
    const attachmentDropzone = document.getElementById('attachmentDropzone');
    const sendingOverlay = document.getElementById('sendingOverlay');

    // Show/hide CC and BCC fields
    document.getElementById('showCcBtn').addEventListener('click', () => {
        ccContainer.style.display = 'block';
        document.getElementById('showCcBtn').style.display = 'none';
    });

    document.getElementById('showBccBtn').addEventListener('click', () => {
        bccContainer.style.display = 'block';
        document.getElementById('showBccBtn').style.display = 'none';
    });

    // Setup rich text editor toolbar
    setupRichTextEditor();

    // Toggle between rich text and plain text editor
    let isRichText = true;
    const plainTextToggle = document.getElementById('plainTextToggle');
    plainTextToggle.addEventListener('click', () => {
        if (isRichText) {
            // Switch to plain text
            plainTextEditor.value = richTextToPlainText(richTextEditor.innerHTML);
            richTextEditor.style.display = 'none';
            plainTextEditor.style.display = 'block';
            plainTextToggle.innerHTML = '<i class="fas fa-eye"></i>';
            plainTextToggle.title = 'Switch to Rich Text';
        } else {
            // Switch to rich text
            richTextEditor.innerHTML = plainTextToHtml(plainTextEditor.value);
            richTextEditor.style.display = 'block';
            plainTextEditor.style.display = 'none';
            plainTextToggle.innerHTML = '<i class="fas fa-code"></i>';
            plainTextToggle.title = 'Switch to Plain Text';
        }
        isRichText = !isRichText;
    });

    // Setup file upload functionality
    setupFileUploads();

    // Handle form submission
    composeForm.addEventListener('submit', function(e) {
        e.preventDefault();
        sendEmail();
    });

    // Handle discard button
    document.getElementById('discardBtn').addEventListener('click', function() {
        if (confirm('Are you sure you want to discard this email?')) {
            window.location.href = '/email/inbox';
        }
    });

    // Handle save draft button
    document.getElementById('saveDraftBtn').addEventListener('click', function() {
        // TODO: Implement save draft functionality
        alert('Save draft functionality coming soon!');
    });

    // Initialize email if it's a reply or forward
    if (options.replyTo || options.forward) {
        loadEmailForReplyOrForward(options);
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
                    richTextEditor.focus();
                }
            });
        });

        // Focus rich text editor on load
        richTextEditor.focus();

        // Set up link dialog
        const linkDialog = document.getElementById('linkDialog');
        const linkUrl = document.getElementById('linkUrl');
        const linkText = document.getElementById('linkText');
        const insertLinkBtn = document.getElementById('insertLinkBtn');
        const cancelLinkBtn = document.getElementById('cancelLinkBtn');
        const closeModal = linkDialog.querySelector('.close-modal');

        // Store selection for link insertion
        let storedSelection = null;

        function openLinkDialog() {
            // Store current selection
            storedSelection = saveSelection();

            // Get selected text
            const selectedText = window.getSelection().toString();

            // Prefill link dialog if text is selected
            linkUrl.value = '';
            linkText.value = selectedText;

            // Show dialog
            linkDialog.style.display = 'flex';
            linkUrl.focus();
        }

        // Insert link button
        insertLinkBtn.addEventListener('click', () => {
            const url = linkUrl.value;
            const text = linkText.value;

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
                        const range = selection.getRangeAt(0);
                        const links = richTextEditor.querySelectorAll('a');
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

        // Cancel button
        cancelLinkBtn.addEventListener('click', () => {
            linkDialog.style.display = 'none';
        });

        // Close button
        closeModal.addEventListener('click', () => {
            linkDialog.style.display = 'none';
        });

        // Close when clicking outside
        window.addEventListener('click', function(e) {
            if (e.target === linkDialog) {
                linkDialog.style.display = 'none';
            }
        });

        // Helper functions for selection management
        function saveSelection() {
            if (window.getSelection) {
                const sel = window.getSelection();
                if (sel.getRangeAt && sel.rangeCount) {
                    return sel.getRangeAt(0);
                }
            }
            return null;
        }

        function restoreSelection(range) {
            if (range) {
                if (window.getSelection) {
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            }
        }
    }

    /**
     * Setup file upload functionality
     */
    function setupFileUploads() {
        // Ensure the attachmentsData array is initialized globally
        window.attachmentsData = window.attachmentsData || [];

        // Handle file input change
        attachmentsInput.addEventListener('change', handleFileUpload);

        // Handle drag and drop
        attachmentDropzone.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.stopPropagation();
            this.classList.add('dragover');
        });

        attachmentDropzone.addEventListener('dragleave', function(e) {
            e.preventDefault();
            e.stopPropagation();
            this.classList.remove('dragover');
        });

        attachmentDropzone.addEventListener('drop', function(e) {
            e.preventDefault();
            e.stopPropagation();
            this.classList.remove('dragover');

            if (e.dataTransfer.files.length) {
                handleFiles(e.dataTransfer.files);
            }
        });

        // Process files
        function handleFileUpload(e) {
            const files = attachmentsInput.files;
            if (files.length) {
                handleFiles(files);
            }
        }

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
                    attachmentsData.push(attachment);

                    // Display attachment
                    displayAttachment(attachment, attachmentsData.length - 1);
                };
                reader.readAsDataURL(file);
            }

            // Reset file input
            attachmentsInput.value = '';
        }

        // Display attachment in the UI
        function displayAttachment(attachment, index) {
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

            attachmentsList.appendChild(attachmentItem);

            // Add remove functionality
            const removeBtn = attachmentItem.querySelector('.remove-attachment');
            removeBtn.addEventListener('click', function() {
                attachmentsData.splice(index, 1);
                attachmentItem.remove();

                // Re-index remaining attachments
                const remainingItems = attachmentsList.querySelectorAll('.attachment-item');
                remainingItems.forEach((item, i) => {
                    item.dataset.index = i;
                });
            });
        }
    }

    /**
     * Send email
     */
    function sendEmail() {
        // Show sending overlay
        sendingOverlay.style.display = 'flex';

        // Gather form data
        const to = toField.value;
        const cc = ccField.value;
        const bcc = bccField.value;
        const subject = subjectField.value;

        // Get body content based on current editor mode
        let body, htmlBody;
        if (isRichText) {
            htmlBody = richTextEditor.innerHTML;
            body = richTextToPlainText(htmlBody);
        } else {
            body = plainTextEditor.value;
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
        const attachments = [];
        document.querySelectorAll('.attachment-item').forEach(item => {
            const index = parseInt(item.dataset.index);
            attachments.push(window.attachmentsData[index]);
        });

        if (attachments.length > 0) {
            emailData.attachments = attachments;
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
            sendingOverlay.style.display = 'none';

            // Show error
            showNotification('Failed to send email: ' + error.message, 'error');
        });
    }

    /**
     * Load email content for reply or forward
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
        richTextEditor.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Loading email content...';

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
                richTextEditor.innerHTML = '<p style="color: red;">Error loading email content. Please try again.</p>';
                showNotification('Failed to load email content', 'error');
            });
    }

    /**
     * Set up reply to email
     */
    function setupReply(email, replyAll) {
        // Extract sender email from the From field
        const fromMatch = email.from.match(/<([^>]+)>/);
        const replyToEmail = fromMatch ? fromMatch[1] : email.from;

        // Set to field to the sender
        toField.value = replyToEmail;

        // Set CC field if reply all
        if (replyAll && email.cc) {
            ccContainer.style.display = 'block';
            ccField.value = email.cc;
            document.getElementById('showCcBtn').style.display = 'none';
        }

        // Set subject with Re: prefix if not already there
        const subject = email.subject || '';
        subjectField.value = subject.startsWith('Re:') ? subject : 'Re: ' + subject;

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
        richTextEditor.innerHTML = replyBody;

        // Place cursor at the beginning of the editor
        setCaretToBeginning(richTextEditor);
    }

    /**
     * Set up forward email
     */
    function setupForward(email) {
        // Set subject with Fwd: prefix if not already there
        const subject = email.subject || '';
        subjectField.value = subject.startsWith('Fwd:') ? subject : 'Fwd: ' + subject;

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
        richTextEditor.innerHTML = forwardBody;

        // Add forwarded attachments if any
        if (email.attachments && email.attachments.length > 0) {
            window.attachmentsData = window.attachmentsData || [];

            email.attachments.forEach((attachment, index) => {
                window.attachmentsData.push(attachment);
                displayAttachment(attachment, window.attachmentsData.length - 1);
            });
        }

        // Place cursor at the beginning of the editor
        setCaretToBeginning(richTextEditor);
    }

    /**
     * Place cursor at the beginning of the editor
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
}

/**
 * Convert HTML to plain text
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
 * Format file size in human-readable format
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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

// Initialize attachments data globally
window.attachmentsData = [];
