from datetime import datetime, timedelta
from flask import Blueprint, render_template, redirect, url_for, flash, request, session, abort, current_app
from flask_login import login_user, logout_user, login_required, current_user
from urllib.parse import urlparse
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import secrets
import logging
import os
import qrcode
import io
import base64

from database import db
from database.identity.models import User
from forms import LoginForm, RegistrationForm, TOTPVerificationForm, TOTPSetupForm, TOTPDisableForm

# Setup blueprint
auth_bp = Blueprint(
    'auth',
    __name__,
    url_prefix='/auth',
    template_folder='../templates/auth'
)

# Configure logging
logger = logging.getLogger(__name__)

# Initialize limiter with config that will be set in app.py
limiter = Limiter(
    key_func=get_remote_address,
    storage_uri="memory://",
    default_limits=["200 per day", "50 per hour"]
)

# Check if registration is enabled
def is_registration_enabled():
    return os.getenv('REGISTRATION_ENABLED', 'false').lower() == 'true'

@auth_bp.route('/login', methods=['GET', 'POST'])
@limiter.limit("10 per minute")
def login():
    if current_user.is_authenticated:
        return redirect(url_for('main.index'))

    # Check if we're in the middle of 2FA verification
    if 'awaiting_2fa_verification' in session:
        user_id = session.get('awaiting_2fa_user_id')
        remember_me = session.get('awaiting_2fa_remember')

        if not user_id:
            # Invalid state, start over
            session.pop('awaiting_2fa_verification', None)
            session.pop('awaiting_2fa_user_id', None)
            session.pop('awaiting_2fa_remember', None)
            flash('Authentication session expired. Please try again.', 'warning')
            return redirect(url_for('auth.login'))

        form = TOTPVerificationForm()
        if form.validate_on_submit():
            user = User.query.get(user_id)
            if not user:
                session.pop('awaiting_2fa_verification', None)
                session.pop('awaiting_2fa_user_id', None)
                session.pop('awaiting_2fa_remember', None)
                flash('Invalid authentication session. Please try again.', 'danger')
                return redirect(url_for('auth.login'))

            if user.verify_totp(form.token.data):
                # Complete the login process
                user.last_login = datetime.utcnow()
                user.reset_login_attempts()
                db.session.commit()

                # Clean up session
                session.pop('awaiting_2fa_verification', None)
                session.pop('awaiting_2fa_user_id', None)
                session.pop('awaiting_2fa_remember', None)

                # Log the user in
                login_user(user, remember=remember_me)
                logger.info(f"User logged in with 2FA: {user.username}")

                # Regenerate session
                session['csrf_token'] = secrets.token_hex(16)

                # Redirect to appropriate page
                next_page = request.args.get('next')
                if not next_page or urlparse(next_page).netloc != '':
                    next_page = url_for('dashboard.dashboard')

                return redirect(next_page)
            else:
                flash('Invalid authentication code. Please try again.', 'danger')
                logger.warning(f"Failed 2FA attempt for user ID: {user_id}")

        return render_template('auth/verify_totp.html', form=form, title='Two-Factor Authentication')

    # Normal login flow
    form = LoginForm()
    if form.validate_on_submit():
        # Check if input is username or email
        user = User.query.filter(
            (User.username == form.username.data) |
            (User.email == form.username.data)
        ).first()

        if user is None:
            flash('Invalid username or password', 'danger')
            logger.warning(f"Failed login attempt for non-existent user: {form.username.data}")
            return redirect(url_for('auth.login'))

        # Check for account lockout
        max_attempts = current_app.config.get('MAX_LOGIN_ATTEMPTS', 5)
        lockout_time = current_app.config.get('LOCKOUT_TIME', 15)

        if user.login_attempts >= max_attempts:
            if user.last_login_attempt:
                lockout_until = user.last_login_attempt + timedelta(minutes=lockout_time)
                if datetime.utcnow() < lockout_until:
                    remaining = int((lockout_until - datetime.utcnow()).total_seconds() / 60)
                    flash(f'Account temporarily locked. Try again in {remaining} minutes.', 'danger')
                    return redirect(url_for('auth.login'))
                else:
                    # Reset counter if lockout period has passed
                    user.reset_login_attempts()

        # Verify password
        if not user.check_password(form.password.data):
            user.increment_login_attempts()
            attempts_left = max_attempts - user.login_attempts
            flash(f'Invalid password. {attempts_left} attempts remaining before lockout.', 'danger')
            logger.warning(f"Failed login attempt for: {user.username}")
            return redirect(url_for('auth.login'))

        # If user has 2FA enabled, redirect to verification page
        if user.totp_enabled:
            # Store necessary information in session for the 2FA step
            session['awaiting_2fa_verification'] = True
            session['awaiting_2fa_user_id'] = user.id
            session['awaiting_2fa_remember'] = form.remember_me.data
            logger.info(f"2FA verification required for user: {user.username}")
            return redirect(url_for('auth.login'))

        # Complete login (for users without 2FA)
        user.last_login = datetime.utcnow()
        user.reset_login_attempts()
        db.session.commit()

        login_user(user, remember=form.remember_me.data)
        logger.info(f"User logged in: {user.username}")

        # Security: regenerate session to prevent session fixation
        session['csrf_token'] = secrets.token_hex(16)

        # Redirect to next page or home
        next_page = request.args.get('next')
        if not next_page or urlparse(next_page).netloc != '':
            next_page = url_for('dashboard.dashboard')

        return redirect(next_page)

    return render_template('auth/login.html', title='Sign In', form=form)

@auth_bp.route('/logout')
def logout():
    logout_user()
    # Clean up any 2FA session data
    session.pop('awaiting_2fa_verification', None)
    session.pop('awaiting_2fa_user_id', None)
    session.pop('awaiting_2fa_remember', None)
    # Security: regenerate session after logout
    session['csrf_token'] = secrets.token_hex(16)
    flash('You have been logged out.', 'info')
    return redirect(url_for('main.index'))

@auth_bp.route('/register', methods=['GET', 'POST'])
@limiter.limit("5 per hour")
def register():
    if current_user.is_authenticated:
        return redirect(url_for('main.index'))

    if not is_registration_enabled():
        abort(403)

    form = RegistrationForm()
    if form.validate_on_submit():
        user = User(
            username=form.username.data,
            email=form.email.data.lower()
        )
        user.set_password(form.password.data)
        db.session.add(user)
        db.session.commit()
        flash('Congratulations, you are now registered!', 'success')
        logger.info(f"New user registered: {user.username}")
        return redirect(url_for('auth.login'))

    return render_template('auth/register.html', title='Register', form=form)

@auth_bp.route('/setup-2fa', methods=['GET', 'POST'])
@login_required
def setup_2fa():
    """Setup 2FA for a user"""
    # Check if 2FA is already enabled
    if current_user.totp_enabled:
        flash('Two-factor authentication is already enabled.', 'info')
        return redirect(url_for('dashboard.dashboard'))

    # Generate a secret key if not already present
    if not current_user.totp_secret:
        current_user.generate_totp_secret()
        db.session.commit()

    # Generate QR code
    totp_uri = current_user.get_totp_uri()
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_L,
        box_size=10,
        border=4,
    )
    qr.add_data(totp_uri)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")

    # Convert to base64 for embedding in HTML
    buffered = io.BytesIO()
    img.save(buffered, format="PNG")
    qr_code = base64.b64encode(buffered.getvalue()).decode("utf-8")

    # Process form submission
    form = TOTPSetupForm()
    if form.validate_on_submit():
        if current_user.verify_totp(form.token.data):
            current_user.enable_totp()
            flash('Two-factor authentication has been enabled successfully!', 'success')
            logger.info(f"2FA enabled for user: {current_user.username}")
            return redirect(url_for('dashboard.dashboard'))
        else:
            flash('Invalid verification code. Please try again.', 'danger')

    return render_template('auth/setup_totp.html',
                           form=form,
                           qr_code=qr_code,
                           secret=current_user.totp_secret,
                           title='Setup 2FA')

@auth_bp.route('/disable-2fa', methods=['GET', 'POST'])
@login_required
def disable_2fa():
    """Disable 2FA for a user"""
    # Check if 2FA is enabled
    if not current_user.totp_enabled:
        flash('Two-factor authentication is not enabled.', 'info')
        return redirect(url_for('dashboard.dashboard'))

    form = TOTPDisableForm()
    if form.validate_on_submit():
        if current_user.verify_totp(form.token.data):
            current_user.disable_totp()
            flash('Two-factor authentication has been disabled.', 'success')
            logger.info(f"2FA disabled for user: {current_user.username}")
            return redirect(url_for('dashboard.dashboard'))
        else:
            flash('Invalid verification code. Please try again.', 'danger')

    return render_template('auth/disable_totp.html',
                           form=form,
                           title='Disable 2FA')

#-神-#