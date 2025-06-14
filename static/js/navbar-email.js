/**
 * Navbar Email Notification Script
 *
 * This script handles checking for unread emails and updating the notification badge
 * in the navigation bar. It periodically checks the email inbox for unread messages
 * and updates the UI accordingly.
 */

document.addEventListener('DOMContentLoaded', function() {
    // Initialize unread email counter
    const UnreadEmailCounter = {
        // Configuration
        config: {
            checkInterval: 60000, // Check for new emails every minute
            badgeElement: document.getElementById('unread-email-count'),
            endpoints: {
                unreadCount: '/email/api/unread-count'
            }
        },

        // State
        state: {
            unreadCount: 0,
            isChecking: false,
            lastUpdate: null,
            checkIntervalId: null
        },

        // Initialize the counter
        init: function() {
            // Check if we have the badge element (only on pages where user is logged in with email configured)
            if (!this.config.badgeElement) return;

            // Initial check
            this.checkUnreadEmails();

            // Set up periodic checking
            this.state.checkIntervalId = setInterval(() => {
                this.checkUnreadEmails();
            }, this.config.checkInterval);
        },

        // Check for unread emails via API
        checkUnreadEmails: function() {
            if (this.state.isChecking) return;
            this.state.isChecking = true;

            fetch(this.config.endpoints.unreadCount, {
                method: 'GET',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest'
                },
                credentials: 'same-origin'
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                return response.json();
            })
            .then(data => {
                this.state.isChecking = false;
                this.state.lastUpdate = new Date();

                // Update the unread count
                if (data && typeof data.unread_count === 'number') {
                    this.updateUnreadCount(data.unread_count);
                }
            })
            .catch(error => {
                this.state.isChecking = false;
                console.error('Error fetching unread email count:', error);
            });
        },

        // Update the unread count badge in the UI
        updateUnreadCount: function(count) {
            if (!this.config.badgeElement) return;

            this.state.unreadCount = count;

            if (count > 0) {
                // Display the count
                this.config.badgeElement.textContent = count > 99 ? '99+' : count;
                this.config.badgeElement.classList.add('active');

                // Update page title if on email page
                if (window.location.pathname.includes('/email/')) {
                    document.title = `(${count}) Email - J.E.D.I.`;
                }
            } else {
                // Hide the badge when no unread emails
                this.config.badgeElement.textContent = '';
                this.config.badgeElement.classList.remove('active');

                // Reset page title if on email page
                if (window.location.pathname.includes('/email/')) {
                    document.title = 'Email - J.E.D.I.';
                }
            }
        },

        // Clean up when page is unloaded
        destroy: function() {
            if (this.state.checkIntervalId) {
                clearInterval(this.state.checkIntervalId);
            }
        }
    };

    // Initialize the unread email counter
    UnreadEmailCounter.init();

    // Clean up on page unload
    window.addEventListener('beforeunload', function() {
        UnreadEmailCounter.destroy();
    });
});
