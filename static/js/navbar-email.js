/**
 * Navbar Email Notification Module
 *
 * This script handles checking for unread emails and updating the notification badge
 * in the navigation bar. It periodically checks the email inbox for unread messages
 * and updates the UI accordingly.
 */

const NavbarEmailNotification = (function() {
    'use strict';

    // Configuration
    const config = {
        checkInterval: 60000, // Check for new emails every minute
        endpoints: {
            unreadCount: '/email/api/unread-count'
        }
    };

    // State
    const state = {
        unreadCount: 0,
        isChecking: false,
        lastUpdate: null,
        checkIntervalId: null,
        badgeElement: null
    };

    /**
     * Initialize the email notification system
     */
    function init() {
        // Get the badge element
        state.badgeElement = document.getElementById('unread-email-count');

        // Only initialize if the badge element exists
        // (it should only exist on pages where user is logged in with email configured)
        if (!state.badgeElement) return;

        // Initial check
        checkUnreadEmails();

        // Set up periodic checking
        state.checkIntervalId = setInterval(checkUnreadEmails, config.checkInterval);

        // Clean up on page unload
        window.addEventListener('beforeunload', destroy);

        console.log('Navbar email notification system initialized');
    }

    /**
     * Check for unread emails via API
     */
    function checkUnreadEmails() {
        // Don't start another check if one is in progress
        if (state.isChecking) return;

        state.isChecking = true;

        fetch(config.endpoints.unreadCount, {
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
            state.isChecking = false;
            state.lastUpdate = new Date();

            // Update the unread count if available
            if (data && typeof data.unread_count === 'number') {
                updateUnreadCount(data.unread_count);
            }
        })
        .catch(error => {
            state.isChecking = false;
            console.error('Error fetching unread email count:', error);

            // Don't show user-facing errors for background checks
            // as this would be distracting
        });
    }

    /**
     * Update the unread count badge in the UI
     * @param {number} count - Number of unread emails
     */
    function updateUnreadCount(count) {
        if (!state.badgeElement) return;

        state.unreadCount = count;

        if (count > 0) {
            // Display the count, with 99+ for large numbers
            state.badgeElement.textContent = count > 99 ? '99+' : count;
            state.badgeElement.classList.add('active');

            // Update page title if on email page
            if (window.location.pathname.includes('/email/')) {
                document.title = `(${count}) Email - J.E.D.I.`;
            }
        } else {
            // Hide the badge when no unread emails
            state.badgeElement.textContent = '';
            state.badgeElement.classList.remove('active');

            // Reset page title if on email page
            if (window.location.pathname.includes('/email/')) {
                document.title = 'Email - J.E.D.I.';
            }
        }
    }

    /**
     * Force an immediate check for new emails
     */
    function forceCheck() {
        checkUnreadEmails();
    }

    /**
     * Clean up resources when page is unloaded
     */
    function destroy() {
        if (state.checkIntervalId) {
            clearInterval(state.checkIntervalId);
            state.checkIntervalId = null;
        }
    }

    // Public API
    return {
        init,
        forceCheck,
        destroy
    };
})();

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    NavbarEmailNotification.init();
});
/*-神-*/