/**
 * Settings Page JavaScript
 * Enhances the settings page with interactive features and animations
 */

document.addEventListener('DOMContentLoaded', function() {
    // --- Tab Navigation Management --- //
    initializeTabNavigation();

    // --- Form Validation & Enhancement --- //
    initializeFormValidation();
    initializePasswordStrengthMeter();

    // --- UI Enhancement --- //
    initializeAnimations();
    initializeTooltips();
    initializeThemeToggle();

    // --- Save State Management --- //
    initializeFormChangeTracking();
});

/**
 * Initialize tab navigation behavior
 */
function initializeTabNavigation() {
    // Handle URL hash changes to switch tabs
    function handleHashChange() {
        const hash = window.location.hash.substring(1);
        if (hash && document.querySelector(`[data-tab="${hash}"]`)) {
            switchToTab(hash);
        }
    }

    // Check for hash on initial page load
    if (window.location.hash) {
        handleHashChange();
    }

    // Listen for future hash changes
    window.addEventListener('hashchange', handleHashChange);

    // Store the last active tab in localStorage
    const storedTab = localStorage.getItem('jedi-settings-active-tab');
    if (storedTab && !window.location.hash) {
        switchToTab(storedTab);
    }

    function switchToTab(tabId) {
        if (window.Alpine) {
            const settingsContainer = document.querySelector('.settings-container');
            if (settingsContainer && settingsContainer.__x) {
                settingsContainer.__x.$data.activeTab = tabId;
                localStorage.setItem('jedi-settings-active-tab', tabId);
            }
        }
    }

    // Manual tab clicks backup (in case Alpine isn't loaded)
    document.querySelectorAll('.settings-nav-link').forEach(navLink => {
        navLink.addEventListener('click', function(e) {
            const tabId = this.getAttribute('href').substring(1);
            if (!window.Alpine) {
                e.preventDefault();
                activateTab(tabId);
            }
        });
    });

    // Manual tab activation function (backup for non-Alpine)
    function activateTab(tabId) {
        document.querySelectorAll('.settings-nav-link').forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === `#${tabId}`);
            link.closest('.settings-nav-item').classList.toggle('active', link.getAttribute('href') === `#${tabId}`);
        });

        document.querySelectorAll('.settings-section').forEach(section => {
            section.classList.toggle('active', section.id === tabId);
        });

        localStorage.setItem('jedi-settings-active-tab', tabId);
        history.replaceState(null, null, `#${tabId}`);
    }
}

/**
 * Initialize form validation enhancements
 */
function initializeFormValidation() {
    // Add real-time validation for forms
    const forms = document.querySelectorAll('.settings-form');

    forms.forEach(form => {
        const inputs = form.querySelectorAll('input, textarea, select');

        inputs.forEach(input => {
            // Skip submit buttons and hidden fields
            if (input.type === 'submit' || input.type === 'hidden') return;

            input.addEventListener('blur', function() {
                validateInput(input);
            });

            input.addEventListener('input', function() {
                // Remove any error messages when user starts typing again
                const errorContainer = input.nextElementSibling;
                if (errorContainer && errorContainer.classList.contains('errors')) {
                    errorContainer.style.opacity = '0';
                }
            });
        });

        form.addEventListener('submit', function(e) {
            let isValid = true;

            inputs.forEach(input => {
                if (input.type !== 'submit' && input.type !== 'hidden') {
                    if (!validateInput(input)) {
                        isValid = false;
                    }
                }
            });

            if (!isValid) {
                e.preventDefault();

                // Scroll to the first error
                const firstError = form.querySelector('.invalid');
                if (firstError) {
                    firstError.focus();
                    firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            } else {
                // Show loading state
                const submitButton = form.querySelector('[type="submit"]');
                if (submitButton) {
                    submitButton.disabled = true;
                    const originalText = submitButton.innerHTML;
                    submitButton.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Saving...';

                    // Restore button after 10s in case the form submission gets stuck
                    setTimeout(() => {
                        submitButton.disabled = false;
                        submitButton.innerHTML = originalText;
                    }, 10000);
                }
            }
        });
    });

    function validateInput(input) {
        let isValid = true;

        // Basic validation rules
        if (input.hasAttribute('required') && !input.value.trim()) {
            showError(input, 'This field is required');
            isValid = false;
        } else if (input.type === 'email' && input.value.trim()) {
            // Email validation
            const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailPattern.test(input.value)) {
                showError(input, 'Please enter a valid email address');
                isValid = false;
            }
        } else if (input.id === 'new_password' || input.id === 'confirm_password') {
            // Password validation - only if they've started typing
            if (input.value) {
                if (input.value.length < 8) {
                    showError(input, 'Password must be at least 8 characters long');
                    isValid = false;
                }
            }

            // Check if passwords match
            const newPasswordInput = document.getElementById('new_password');
            const confirmPasswordInput = document.getElementById('confirm_password');

            if (newPasswordInput && confirmPasswordInput &&
                newPasswordInput.value && confirmPasswordInput.value &&
                newPasswordInput.value !== confirmPasswordInput.value) {
                showError(confirmPasswordInput, 'Passwords do not match');
                isValid = false;
            }
        }

        // Add/remove invalid class
        input.classList.toggle('invalid', !isValid);

        return isValid;
    }

    function showError(input, message) {
        // Find or create error container
        let errorContainer = input.nextElementSibling;

        if (!errorContainer || !errorContainer.classList.contains('errors')) {
            errorContainer = document.createElement('div');
            errorContainer.className = 'errors';
            input.parentNode.insertBefore(errorContainer, input.nextSibling);
        }

        // Set error message
        errorContainer.innerHTML = `<span>${message}</span>`;
        errorContainer.style.opacity = '1';
    }
}

/**
 * Initialize password strength meter
 */
function initializePasswordStrengthMeter() {
    const newPasswordInputs = document.querySelectorAll('input[type="password"][id$="new_password"]');

    newPasswordInputs.forEach(input => {
        // Create strength meter elements
        const meterContainer = document.createElement('div');
        meterContainer.className = 'password-strength-meter';
        meterContainer.innerHTML = `
            <div class="strength-bars">
                <div class="strength-segment"></div>
                <div class="strength-segment"></div>
                <div class="strength-segment"></div>
                <div class="strength-segment"></div>
            </div>
            <div class="strength-text">Password strength: <span>none</span></div>
        `;

        // Insert after the input
        input.parentNode.insertBefore(meterContainer, input.nextSibling);

        // Update strength on input
        input.addEventListener('input', function() {
            updatePasswordStrength(input.value, meterContainer);
        });
    });

    function updatePasswordStrength(password, meterContainer) {
        // Score from 0 to 4
        let score = 0;
        const strengthText = meterContainer.querySelector('.strength-text span');
        const segments = meterContainer.querySelectorAll('.strength-segment');

        if (!password) {
            strengthText.textContent = 'none';
            segments.forEach(segment => segment.className = 'strength-segment');
            return;
        }

        // Length check
        if (password.length >= 8) score++;
        if (password.length >= 12) score++;

        // Complexity checks
        if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
        if (/[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;

        // Update UI
        const strengthLabels = ['weak', 'fair', 'good', 'strong', 'excellent'];
        const strengthColors = ['#ef4444', '#f59e0b', '#eab308', '#10b981', '#10b981'];

        strengthText.textContent = strengthLabels[score];

        segments.forEach((segment, index) => {
            if (index < score + 1) {
                segment.className = 'strength-segment active';
                segment.style.backgroundColor = strengthColors[score];
            } else {
                segment.className = 'strength-segment';
                segment.style.backgroundColor = '';
            }
        });
    }
}

/**
 * Initialize animations for settings sections
 */
function initializeAnimations() {
    const sections = document.querySelectorAll('.settings-section');

    // Stagger animations for each form group/card
    sections.forEach(section => {
        const animatableElements = section.querySelectorAll('.settings-form, .dashboard-card, .totp-section');

        animatableElements.forEach((element, index) => {
            element.style.opacity = '0';
            element.style.transform = 'translateY(20px)';

            // Only set up observer for elements in initially active section
            if (section.classList.contains('active')) {
                setupObserver(element, index);
            }
        });

        // When tab becomes active, animate its elements
        const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                if (mutation.attributeName === 'class' &&
                    section.classList.contains('active')) {
                    animatableElements.forEach((element, index) => {
                        setupObserver(element, index);
                    });
                }
            });
        });

        observer.observe(section, { attributes: true });
    });

    function setupObserver(element, index) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    setTimeout(() => {
                        element.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
                        element.style.opacity = '1';
                        element.style.transform = 'translateY(0)';
                    }, 100 * (index + 1));

                    observer.unobserve(element);
                }
            });
        });

        observer.observe(element);
    }
}

/**
 * Initialize tooltips for info icons
 */
function initializeTooltips() {
    document.querySelectorAll('[data-tooltip]').forEach(element => {
        element.addEventListener('mouseenter', function(e) {
            const tooltip = document.createElement('div');
            tooltip.className = 'tooltip';
            tooltip.textContent = this.getAttribute('data-tooltip');
            document.body.appendChild(tooltip);

            const rect = element.getBoundingClientRect();
            tooltip.style.left = `${rect.left + (rect.width / 2) - (tooltip.offsetWidth / 2)}px`;
            tooltip.style.top = `${rect.top - tooltip.offsetHeight - 10}px`;

            setTimeout(() => tooltip.classList.add('visible'), 10);

            element.addEventListener('mouseleave', function() {
                tooltip.classList.remove('visible');
                setTimeout(() => tooltip.remove(), 300);
            }, { once: true });
        });
    });
}

/**
 * Initialize theme toggle functionality
 */
function initializeThemeToggle() {
    const themeSelect = document.getElementById('theme-preference');
    if (!themeSelect) return;

    // Set initial value from localStorage
    const currentTheme = localStorage.getItem('jedi-theme-preference') || 'light';
    themeSelect.value = currentTheme;
    applyTheme(currentTheme);

    themeSelect.addEventListener('change', function() {
        const theme = this.value;
        localStorage.setItem('jedi-theme-preference', theme);
        applyTheme(theme);
    });

    function applyTheme(theme) {
        const body = document.body;

        // Remove any existing theme classes
        body.classList.remove('theme-light', 'theme-dark');

        // Apply the selected theme
        if (theme === 'system') {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            body.classList.add(prefersDark ? 'theme-dark' : 'theme-light');
        } else {
            body.classList.add(`theme-${theme}`);
        }
    }

    // Also watch for system theme changes if set to 'system'
    const systemThemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
    systemThemeMedia.addEventListener('change', function() {
        if (themeSelect.value === 'system') {
            applyTheme('system');
        }
    });
}

/**
 * Initialize form change tracking
 */
function initializeFormChangeTracking() {
    const forms = document.querySelectorAll('.settings-form');

    forms.forEach(form => {
        let initialState = {};
        const inputs = form.querySelectorAll('input, textarea, select');

        // Record initial state
        inputs.forEach(input => {
            if (input.type === 'checkbox' || input.type === 'radio') {
                initialState[input.name] = input.checked;
            } else {
                initialState[input.name] = input.value;
            }
        });

        // Track changes
        let hasUnsavedChanges = false;

        inputs.forEach(input => {
            input.addEventListener('change', function() {
                checkForChanges();
            });

            input.addEventListener('input', function() {
                checkForChanges();
            });
        });

        function checkForChanges() {
            let currentHasChanges = false;

            inputs.forEach(input => {
                if (input.type === 'checkbox' || input.type === 'radio') {
                    if (initialState[input.name] !== input.checked) {
                        currentHasChanges = true;
                    }
                } else if (initialState[input.name] !== input.value) {
                    currentHasChanges = true;
                }
            });

            if (currentHasChanges !== hasUnsavedChanges) {
                hasUnsavedChanges = currentHasChanges;
                updateFormStatus(form, hasUnsavedChanges);
            }
        }

        // Update visual indicator of unsaved changes
        function updateFormStatus(form, hasChanges) {
            const submitBtn = form.querySelector('button[type="submit"]');

            if (submitBtn) {
                if (hasChanges) {
                    submitBtn.classList.add('btn-pulse');

                    // Only add the asterisk once
                    const header = form.querySelector('.card-header h4');
                    if (header && !header.querySelector('.unsaved-indicator')) {
                        const indicator = document.createElement('span');
                        indicator.className = 'unsaved-indicator';
                        indicator.textContent = '*';
                        header.appendChild(indicator);
                    }
                } else {
                    submitBtn.classList.remove('btn-pulse');
                    const indicator = form.querySelector('.unsaved-indicator');
                    if (indicator) indicator.remove();
                }
            }
        }

        // Warn before leaving with unsaved changes
        window.addEventListener('beforeunload', function(e) {
            if (hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
                return e.returnValue;
            }
        });

        // Reset change tracking after form submission
        form.addEventListener('submit', function() {
            setTimeout(() => {
                inputs.forEach(input => {
                    if (input.type === 'checkbox' || input.type === 'radio') {
                        initialState[input.name] = input.checked;
                    } else {
                        initialState[input.name] = input.value;
                    }
                });

                hasUnsavedChanges = false;
                updateFormStatus(form, false);
            }, 100);
        });
    });
}
