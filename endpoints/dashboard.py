from flask import Blueprint, render_template, redirect, url_for, flash, request, session, current_app
from flask_login import login_required, current_user, fresh_login_required
from werkzeug.security import check_password_hash
import functools
import pyqrcode
import io
import base64
import datetime

from database import db
from database.identity.models import User
from forms import UpdateUsernameForm, UpdateEmailForm, UpdatePasswordForm, TOTPVerificationForm, DisableTOTPForm

dashboard_bp = Blueprint(
    'dashboard',
    __name__,
    url_prefix='/dashboard',
    template_folder='../templates'
)

@dashboard_bp.route('/')
@login_required
def dashboard():
    now = datetime.datetime.now()
    return render_template('dashboard/dashboard.html', title='Dashboard', now=now)

@dashboard_bp.route('/monitoring')
@login_required
def monitoring():
    """System monitoring dashboard page"""
    now = datetime.datetime.now()
    return render_template('dashboard/monitoring.html', title='System Monitoring', now=now)

@dashboard_bp.route('/settings', methods=['GET'])
@login_required
def settings():
    """User settings page"""
    username_form = UpdateUsernameForm()
    email_form = UpdateEmailForm()
    password_form = UpdatePasswordForm()
    disable_totp_form = DisableTOTPForm()
    now = datetime.datetime.now()

    return render_template('dashboard/settings.html',
                          title='User Settings',
                          username_form=username_form,
                          email_form=email_form,
                          password_form=password_form,
                          disable_totp_form=disable_totp_form,
                          now=now)

@dashboard_bp.route('/settings/username', methods=['POST'])
@fresh_login_required
def update_username():
    """Update username endpoint"""
    form = UpdateUsernameForm()

    if form.validate_on_submit():
        # Verify current password
        if check_password_hash(current_user.password_hash, form.current_password.data):
            # Check if new username is different
            if current_user.username == form.username.data:
                flash('This is already your current username.', 'info')
                return redirect(url_for('dashboard.settings'))

            # Update username
            current_user.username = form.username.data
            db.session.commit()
            flash('Username updated successfully!', 'success')
        else:
            flash('Current password is incorrect.', 'error')

    else:
        for field, errors in form.errors.items():
            for error in errors:
                flash(f"{field}: {error}", 'error')

    return redirect(url_for('dashboard.settings'))

@dashboard_bp.route('/settings/email', methods=['POST'])
@fresh_login_required
def update_email():
    """Update email endpoint"""
    form = UpdateEmailForm()

    if form.validate_on_submit():
        # Verify current password
        if check_password_hash(current_user.password_hash, form.current_password.data):
            # Check if new email is different
            if current_user.email == form.email.data:
                flash('This is already your current email address.', 'info')
                return redirect(url_for('dashboard.settings'))

            # Update email
            current_user.email = form.email.data
            db.session.commit()
            flash('Email address updated successfully!', 'success')
        else:
            flash('Current password is incorrect.', 'error')

    else:
        for field, errors in form.errors.items():
            for error in errors:
                flash(f"{field}: {error}", 'error')

    return redirect(url_for('dashboard.settings'))

@dashboard_bp.route('/settings/password', methods=['POST'])
@fresh_login_required
def update_password():
    """Update password endpoint"""
    form = UpdatePasswordForm()

    if form.validate_on_submit():
        # Verify current password
        if check_password_hash(current_user.password_hash, form.current_password.data):
            # Update password
            current_user.set_password(form.new_password.data)
            db.session.commit()
            flash('Password updated successfully!', 'success')
        else:
            flash('Current password is incorrect.', 'error')

    else:
        for field, errors in form.errors.items():
            for error in errors:
                flash(f"{field}: {error}", 'error')

    return redirect(url_for('dashboard.settings'))

@dashboard_bp.route('/settings/totp/setup', methods=['GET'])
@fresh_login_required
def setup_totp():
    """Set up two-factor authentication"""
    # Generate new TOTP secret if one doesn't exist
    if not current_user.totp_secret:
        current_user.generate_totp_secret()
        db.session.commit()

    # Get the TOTP URI
    totp_uri = current_user.get_totp_uri()

    # Generate QR code
    qr = pyqrcode.create(totp_uri)
    buffer = io.BytesIO()
    qr.svg(buffer, scale=5)
    buffer.seek(0)
    qr_code_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
    qr_code_uri = f"data:image/svg+xml;base64,{qr_code_base64}"

    # Create form
    form = TOTPVerificationForm()

    return render_template('dashboard/setup_totp.html',
                          title='Set Up Two-Factor Authentication',
                          qr_code=qr_code_uri,
                          totp_secret=current_user.totp_secret,
                          form=form)

@dashboard_bp.route('/settings/totp/verify', methods=['POST'])
@fresh_login_required
def verify_totp():
    """Verify and enable TOTP"""
    form = TOTPVerificationForm()

    if form.validate_on_submit():
        # Verify the token
        if current_user.verify_totp(form.token.data):
            # Enable TOTP for the user
            current_user.enable_totp()
            flash('Two-factor authentication has been enabled for your account!', 'success')
            return redirect(url_for('dashboard.settings'))
        else:
            flash('Invalid verification code. Please try again.', 'error')
            return redirect(url_for('dashboard.setup_totp'))

    # Form validation failed
    for field, errors in form.errors.items():
        for error in errors:
            flash(f"{field}: {error}", 'error')

    return redirect(url_for('dashboard.setup_totp'))

@dashboard_bp.route('/settings/totp/disable', methods=['POST'])
@fresh_login_required
def disable_totp():
    """Disable TOTP"""
    form = DisableTOTPForm()

    if form.validate_on_submit():
        # Verify password
        if check_password_hash(current_user.password_hash, form.password.data):
            # Disable TOTP
            current_user.disable_totp()
            flash('Two-factor authentication has been disabled for your account.', 'success')
        else:
            flash('Current password is incorrect.', 'error')
    else:
        for field, errors in form.errors.items():
            for error in errors:
                flash(f"{field}: {error}", 'error')

    return redirect(url_for('dashboard.settings'))
