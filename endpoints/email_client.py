import os
from flask import Blueprint, render_template, request, redirect, url_for, flash, jsonify, current_app, make_response
from flask_login import login_required, current_user
from functools import wraps
from concurrent.futures import ThreadPoolExecutor
import io
import base64
import logging

# Import the new email client service
from services.email_client import EmailClient
from services.email_connection import EmailConnection

# Initialize cache and rate limiter
from flask_caching import Cache
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

email_bp = Blueprint('email', __name__, url_prefix='/email')
cache = Cache()
limiter = Limiter(key_func=get_remote_address)

# Email connection pool for async operations
_executor = ThreadPoolExecutor(max_workers=4)
_connection_manager = EmailConnection()  # Shared connection manager for testing

logger = logging.getLogger(__name__)

def async_action(f):
    """Decorator for handling async email operations"""
    @wraps(f)
    def wrapped(*args, **kwargs):
        return _executor.submit(f, *args, **kwargs)
    return wrapped

def get_client_for_user(user):
    """Get email client for a user with their saved settings"""
    if not user.email_settings:
        return None

    settings = user.email_settings
    return EmailClient(
        settings.imap_server,
        settings.smtp_server,
        settings.username,
        settings.password,
        settings.imap_port,
        settings.smtp_port
    )

@email_bp.route('/')
@login_required
def index():
    """Main email client page"""
    # Check if user has email settings before rendering
    if not current_user.email_settings:
        flash('Please configure your email settings first', 'warning')
        return redirect(url_for('email.setup'))

    return render_template('emailclient/index.html')

@email_bp.route('/setup', methods=['GET', 'POST'])
@login_required
def setup():
    """Email settings configuration page"""
    from database import db
    from database.identity.models import EmailSettings

    # Check if user already has email settings
    existing_settings = EmailSettings.query.filter_by(user_id=current_user.id).first()

    if request.method == 'POST':
        # Process form submission
        imap_server = request.form.get('imap_server')
        imap_port = int(request.form.get('imap_port', 993))
        smtp_server = request.form.get('smtp_server')
        smtp_port = int(request.form.get('smtp_port', 587))
        username = request.form.get('username')
        password = request.form.get('password')

        # Test connection before saving
        try:
            # Use the connection manager to test connections with all possible fallbacks
            test_results = _connection_manager.test_connection(
                imap_server, smtp_server, username, password, imap_port, smtp_port
            )

            if not test_results['imap_success']:
                flash('IMAP connection test failed. Please check your IMAP settings.', 'error')
                return render_template('emailclient/setup.html', settings=existing_settings)

            if not test_results['smtp_success']:
                flash('SMTP connection test failed. Please check your SMTP settings.', 'error')
                return render_template('emailclient/setup.html', settings=existing_settings)

            # Save settings
            if existing_settings:
                existing_settings.imap_server = imap_server
                existing_settings.imap_port = imap_port
                existing_settings.smtp_server = smtp_server
                existing_settings.smtp_port = smtp_port
                existing_settings.username = username
                existing_settings.password = password
            else:
                settings = EmailSettings(
                    user_id=current_user.id,
                    imap_server=imap_server,
                    imap_port=imap_port,
                    smtp_server=smtp_server,
                    smtp_port=smtp_port,
                    username=username,
                    password=password
                )
                db.session.add(settings)

            db.session.commit()
            flash('Email settings saved successfully', 'success')
            return redirect(url_for('email.index'))
        except Exception as e:
            logger.error(f"Error during email setup: {str(e)}")
            flash(f'Connection failed: {str(e)}', 'error')

    return render_template('emailclient/setup.html', settings=existing_settings)

@email_bp.route('/inbox')
@email_bp.route('/folder/<folder>')
@login_required
def inbox(folder='INBOX'):
    """Display inbox or specified folder view"""
    from database.identity.models import EmailSettings

    settings = EmailSettings.query.filter_by(user_id=current_user.id).first()
    if not settings:
        flash('Please set up your email account first', 'warning')
        return redirect(url_for('email.setup'))

    page = request.args.get('page', 1, type=int)
    search = request.args.get('search', '')

    return render_template('emailclient/inbox.html',
                          folder=folder,
                          page=page,
                          search=search)

@email_bp.route('/api/emails')
@login_required
@limiter.limit("30 per minute")
@cache.cached(timeout=60, query_string=True)
def api_emails():
    """API endpoint to fetch emails with pagination and search"""
    from database.identity.models import EmailSettings

    settings = EmailSettings.query.filter_by(user_id=current_user.id).first()
    if not settings:
        return jsonify({'error': 'Email not configured'}), 400

    folder = request.args.get('folder', 'INBOX')
    page = request.args.get('page', 1, type=int)
    limit = request.args.get('limit', 20, type=int)
    search = request.args.get('search', '')

    offset = (page - 1) * limit

    try:
        client = get_client_for_user(current_user)
        search_criteria = f'(OR SUBJECT "{search}" FROM "{search}")' if search else None
        emails, total = client.get_emails(folder=folder, limit=limit, offset=offset, search_criteria=search_criteria)
        client.disconnect()

        return jsonify({
            'emails': emails,
            'total': total,
            'page': page,
            'pages': (total // limit) + (1 if total % limit else 0)
        })
    except Exception as e:
        current_app.logger.error(f"Error fetching emails: {str(e)}")
        return jsonify({'error': str(e)}), 500

@email_bp.route('/api/folders')
@login_required
@limiter.limit("10 per minute")
@cache.cached(timeout=300)  # Cache folder structure for 5 minutes
def api_folders():
    """API endpoint to fetch folder structure"""
    try:
        client = get_client_for_user(current_user)
        if not client:
            return jsonify({'error': 'Email not configured'}), 400

        folders = client.get_folders()
        client.disconnect()

        return jsonify({'folders': folders})
    except Exception as e:
        current_app.logger.error(f"Error fetching folders: {str(e)}")
        return jsonify({'error': str(e)}), 500

@email_bp.route('/view/<folder>/<email_id>')
@login_required
def view_email(folder, email_id):
    """Display email view page"""
    return render_template('emailclient/view.html', folder=folder, email_id=email_id)

@email_bp.route('/api/email/<folder>/<email_id>')
@login_required
def api_email(folder, email_id):
    """API endpoint to fetch a specific email"""
    try:
        client = get_client_for_user(current_user)
        if not client:
            return jsonify({'error': 'Email not configured'}), 400

        email_data = client.get_email(email_id, folder)
        client.disconnect()

        return jsonify(email_data)
    except Exception as e:
        current_app.logger.error(f"Error fetching email: {str(e)}")
        return jsonify({'error': str(e)}), 500

@email_bp.route('/compose')
@login_required
def compose():
    """Display email composition page with optional reply/forward parameters"""
    reply_to = request.args.get('reply_to', '')
    reply_all = request.args.get('reply_all', 'false') == 'true'
    forward = request.args.get('forward', '')
    folder = request.args.get('folder', 'INBOX')

    return render_template('emailclient/compose.html',
                          reply_to=reply_to,
                          reply_all=reply_all,
                          forward=forward,
                          folder=folder)

@email_bp.route('/api/send', methods=['POST'])
@login_required
@limiter.limit("20 per hour")
def api_send_email():
    """API endpoint to send an email"""
    data = request.json

    # Input validation
    to_emails = data.get('to', '').split(',')
    to_emails = [email.strip() for email in to_emails if email.strip()]
    if not to_emails:
        return jsonify({'error': 'To field is required'}), 400

    subject = data.get('subject', '').strip()
    if not subject:
        return jsonify({'error': 'Subject is required'}), 400

    cc_emails = data.get('cc', '')
    cc_emails = [email.strip() for email in cc_emails.split(',')] if cc_emails else None

    bcc_emails = data.get('bcc', '')
    bcc_emails = [email.strip() for email in bcc_emails.split(',')] if bcc_emails else None

    body = data.get('body', '')
    html_body = data.get('html_body')
    attachments = data.get('attachments', [])

    try:
        client = get_client_for_user(current_user)
        if not client:
            return jsonify({'error': 'Email not configured'}), 400

        client.send_email(
            to_emails=to_emails,
            subject=subject,
            body=body,
            cc_emails=cc_emails,
            bcc_emails=bcc_emails,
            html_body=html_body,
            attachments=attachments
        )
        client.disconnect()

        return jsonify({'success': True, 'message': 'Email sent successfully'})
    except Exception as e:
        current_app.logger.error(f"Error sending email: {str(e)}")
        return jsonify({'error': str(e)}), 500

@email_bp.route('/api/delete/<folder>/<email_id>', methods=['POST'])
@login_required
def api_delete_email(folder, email_id):
    """API endpoint to delete an email"""
    try:
        client = get_client_for_user(current_user)
        if not client:
            return jsonify({'error': 'Email not configured'}), 400

        client.delete_email(email_id, folder)
        client.disconnect()

        return jsonify({'success': True, 'message': 'Email deleted successfully'})
    except Exception as e:
        current_app.logger.error(f"Error deleting email: {str(e)}")
        return jsonify({'error': str(e)}), 500

@email_bp.route('/api/move', methods=['POST'])
@login_required
def api_move_email():
    """API endpoint to move an email between folders"""
    data = request.json
    email_id = data.get('email_id')
    source_folder = data.get('source_folder')
    destination_folder = data.get('destination_folder')

    if not all([email_id, source_folder, destination_folder]):
        return jsonify({'error': 'Missing required parameters'}), 400

    try:
        client = get_client_for_user(current_user)
        if not client:
            return jsonify({'error': 'Email not configured'}), 400

        success = client.move_email(email_id, source_folder, destination_folder)
        client.disconnect()

        if success:
            return jsonify({'success': True, 'message': 'Email moved successfully'})
        else:
            return jsonify({'error': 'Failed to move email'}), 500
    except Exception as e:
        current_app.logger.error(f"Error moving email: {str(e)}")
        return jsonify({'error': str(e)}), 500

@email_bp.route('/api/attachment/<folder>/<email_id>/<filename>')
@login_required
def api_attachment(folder, email_id, filename):
    """API endpoint to download an email attachment"""
    try:
        client = get_client_for_user(current_user)
        if not client:
            return jsonify({'error': 'Email not configured'}), 400

        email_data = client.get_email(email_id, folder)
        client.disconnect()

        # Find the attachment
        for attachment in email_data['attachments']:
            if attachment['filename'] == filename:
                file_data = base64.b64decode(attachment['content'])

                # Create Flask response with appropriate headers
                response = make_response(file_data)
                response.headers['Content-Type'] = attachment['content_type']
                response.headers['Content-Disposition'] = f'attachment; filename="{filename}"'
                return response

        return jsonify({'error': 'Attachment not found'}), 404
    except Exception as e:
        current_app.logger.error(f"Error fetching attachment: {str(e)}")
        return jsonify({'error': str(e)}), 500

@email_bp.route('/api/folders/render')
@login_required
@cache.cached(timeout=300, query_string=True)
def api_folders_render():
    """Render the folder tree HTML partial for AJAX requests"""
    from flask import render_template

    try:
        client = get_client_for_user(current_user)
        if not client:
            return jsonify({'error': 'Email not configured'}), 400

        folders = client.get_folders()
        client.disconnect()

        # Helper function to check if a folder is an ancestor of the active folder
        def is_ancestor(folder, active_folder_path):
            for child in folder.get('children', []):
                if child['path'] == active_folder_path or is_ancestor(child, active_folder_path):
                    return True
            return False

        # Helper function to get folder icon
        def folder_icon(folder_type):
            icon_map = {
                'inbox': 'fa-inbox',
                'sent': 'fa-paper-plane',
                'drafts': 'fa-file-alt',
                'trash': 'fa-trash-alt',
                'junk': 'fa-ban',
                'archive': 'fa-archive',
                'folder': 'fa-folder'
            }
            return icon_map.get(folder_type, 'fa-folder')

        # Get current folder from the request
        active_folder = request.args.get('active_folder', 'INBOX')

        # Render the folder list template with the folder data
        html = render_template(
            'emailclient/partials/folder_list.html',
            folders=folders,
            active_folder=active_folder,
            level=0,
            is_ancestor=is_ancestor,
            folder_icon=folder_icon
        )

        return jsonify({'html': html})
    except Exception as e:
        current_app.logger.error(f"Error fetching folders for render: {str(e)}")
        return jsonify({'error': str(e)}), 500

@email_bp.route('/api/emails/render')
@login_required
@cache.cached(timeout=60, query_string=True)
def api_emails_render():
    """Render the email list HTML partial for AJAX requests"""
    from flask import render_template

    folder = request.args.get('folder', 'INBOX')
    page = request.args.get('page', 1, type=int)
    limit = request.args.get('limit', 20, type=int)
    search = request.args.get('search', '')

    offset = (page - 1) * limit

    try:
        client = get_client_for_user(current_user)
        if not client:
            return jsonify({'error': 'Email not configured'}), 400

        search_criteria = None
        if search:
            search_criteria = f'(OR SUBJECT "{search}" FROM "{search}")'

        emails, total = client.get_emails(folder=folder, limit=limit, offset=offset, search_criteria=search_criteria)
        client.disconnect()

        # Render the email list template with the email data
        html = render_template(
            'emailclient/partials/email_list.html',
            emails=emails,
            folder=folder,
            search=search
        )

        # Calculate total pages for pagination
        total_pages = (total // limit) + (1 if total % limit else 0)

        return jsonify({
            'html': html,
            'total': total,
            'page': page,
            'pages': total_pages
        })
    except Exception as e:
        current_app.logger.error(f"Error fetching emails for render: {str(e)}")
        return jsonify({'error': str(e)}), 500

@email_bp.route('/api/email/render/<folder>/<email_id>')
@login_required
def api_email_render(folder, email_id):
    """Render the email content HTML partial for AJAX requests"""
    from flask import render_template

    try:
        client = get_client_for_user(current_user)
        if not client:
            return jsonify({'error': 'Email not configured'}), 400

        email_data = client.get_email(email_id, folder)
        client.disconnect()

        # Render the email content template with the email data
        html = render_template(
            'emailclient/partials/email_content.html',
            email=email_data
        )

        return jsonify({
            'html': html,
            'email': email_data  # Include raw data for JS processing
        })
    except Exception as e:
        current_app.logger.error(f"Error fetching email for render: {str(e)}")
        return jsonify({'error': str(e)}), 500

@email_bp.route('/api/unread-count')
@login_required
@cache.cached(timeout=60)
def api_unread_count():
    """Get the count of unread emails for the navigation bar badge"""
    try:
        client = get_client_for_user(current_user)
        if not client:
            return jsonify({'unread_count': 0})

        unread_count = client.get_unread_count('INBOX')
        client.disconnect()

        return jsonify({'unread_count': unread_count})
    except Exception as e:
        current_app.logger.error(f"Error checking unread emails: {str(e)}")
        return jsonify({'unread_count': 0, 'error': str(e)}), 500
#-神-#