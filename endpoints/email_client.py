import os
from flask import Blueprint, render_template, request, redirect, url_for, flash, jsonify, current_app
from flask_login import login_required, current_user
import email
import imaplib
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication
import html
from datetime import datetime
from werkzeug.utils import secure_filename
import ssl
import asyncio
from functools import wraps
from concurrent.futures import ThreadPoolExecutor
import base64

# Initialize cache and rate limiter
from flask_caching import Cache
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

email_bp = Blueprint('email', __name__, url_prefix='/email')
cache = Cache()
limiter = Limiter(key_func=get_remote_address)

# Email connection pool
_executor = ThreadPoolExecutor(max_workers=4)

def async_action(f):
    @wraps(f)
    def wrapped(*args, **kwargs):
        return _executor.submit(f, *args, **kwargs)
    return wrapped

class EmailClient:
    def __init__(self, imap_server, smtp_server, username, password, imap_port=993, smtp_port=587):
        self.imap_server = imap_server
        self.smtp_server = smtp_server
        self.username = username
        self.password = password
        self.imap_port = imap_port
        self.smtp_port = smtp_port
        self.imap = None
        self.smtp = None

    def connect_imap(self):
        if self.imap and self.imap.state == 'SELECTED':
            return self.imap

        try:
            # Create context with certificate verification
            context = ssl.create_default_context()

            # Try SSL connection first (most secure)
            try:
                self.imap = imaplib.IMAP4_SSL(self.imap_server, self.imap_port, ssl_context=context)
                self.imap.login(self.username, self.password)
                return self.imap
            except ssl.SSLError as ssl_err:
                current_app.logger.warning(f"SSL connection failed: {str(ssl_err)}. Trying with disabled certificate verification...")

                # Create insecure context that doesn't verify certificates
                insecure_context = ssl.create_default_context()
                insecure_context.check_hostname = False
                insecure_context.verify_mode = ssl.CERT_NONE

                # Try SSL again but with certificate verification disabled
                try:
                    self.imap = imaplib.IMAP4_SSL(self.imap_server, self.imap_port, ssl_context=insecure_context)
                    self.imap.login(self.username, self.password)
                    return self.imap
                except Exception as insecure_ssl_err:
                    current_app.logger.warning(f"Insecure SSL connection failed: {str(insecure_ssl_err)}. Trying STARTTLS...")

                    # If SSL fails, try with STARTTLS
                    try:
                        self.imap = imaplib.IMAP4(self.imap_server, 143)  # Standard non-SSL port
                        self.imap.starttls(ssl_context=insecure_context)  # Use the insecure context
                        self.imap.login(self.username, self.password)
                        return self.imap
                    except Exception as starttls_err:
                        current_app.logger.warning(f"STARTTLS failed: {str(starttls_err)}. Trying plain connection...")

                        # Last resort - try plain connection (not recommended for production)
                        try:
                            self.imap = imaplib.IMAP4(self.imap_server, 143)
                            self.imap.login(self.username, self.password)
                            return self.imap
                        except Exception as plain_err:
                            current_app.logger.error(f"Plain connection failed: {str(plain_err)}")
                            raise ConnectionError(f"All connection methods failed. Last error: {str(plain_err)}")

        except Exception as e:
            current_app.logger.error(f"IMAP connection error: {str(e)}")
            raise ConnectionError(f"Failed to connect to IMAP server: {str(e)}")

    def connect_smtp(self):
        if self.smtp:
            return self.smtp

        try:
            # Create context with certificate verification
            context = ssl.create_default_context()

            # Try with STARTTLS first (standard approach)
            try:
                self.smtp = smtplib.SMTP(self.smtp_server, self.smtp_port)
                self.smtp.starttls(context=context)
                self.smtp.login(self.username, self.password)
                return self.smtp
            except ssl.SSLError as ssl_err:
                current_app.logger.warning(f"SMTP STARTTLS failed: {str(ssl_err)}. Trying with disabled certificate verification...")

                # Create insecure context that doesn't verify certificates
                insecure_context = ssl.create_default_context()
                insecure_context.check_hostname = False
                insecure_context.verify_mode = ssl.CERT_NONE

                # Try STARTTLS again but with certificate verification disabled
                try:
                    self.smtp = smtplib.SMTP(self.smtp_server, self.smtp_port)
                    self.smtp.starttls(context=insecure_context)
                    self.smtp.login(self.username, self.password)
                    return self.smtp
                except Exception as insecure_starttls_err:
                    current_app.logger.warning(f"Insecure STARTTLS failed: {str(insecure_starttls_err)}. Trying direct SSL...")

                    # Try direct SSL connection
                    try:
                        self.smtp = smtplib.SMTP_SSL(self.smtp_server, 465, context=insecure_context)  # Standard SSL port
                        self.smtp.login(self.username, self.password)
                        return self.smtp
                    except Exception as ssl_conn_err:
                        current_app.logger.warning(f"Direct SSL connection failed: {str(ssl_conn_err)}. Trying plain connection...")

                        # Last resort - try plain connection (not recommended for production)
                        try:
                            self.smtp = smtplib.SMTP(self.smtp_server, 25)  # Standard non-SSL port
                            self.smtp.login(self.username, self.password)
                            return self.smtp
                        except Exception as plain_err:
                            current_app.logger.error(f"Plain connection failed: {str(plain_err)}")
                            raise ConnectionError(f"All SMTP connection methods failed. Last error: {str(plain_err)}")
        except Exception as e:
            current_app.logger.error(f"SMTP connection error: {str(e)}")
            raise ConnectionError(f"Failed to connect to SMTP server: {str(e)}")

    def disconnect(self):
        if self.imap:
            try:
                self.imap.logout()
            except:
                pass
            self.imap = None

        if self.smtp:
            try:
                self.smtp.quit()
            except:
                pass
            self.smtp = None

    def get_folders(self):
        """Get all available mailbox folders with proper hierarchy structure."""
        imap = self.connect_imap()
        status, folders_raw = imap.list()

        if status != 'OK':
            raise Exception("Failed to get folders")

        # First pass: collect all folder names and identify delimiter
        all_folders = []
        delimiter = '.'  # Default delimiter

        for folder_raw in folders_raw:
            try:
                # Parse folder data
                decoded = folder_raw.decode('utf-8', errors='replace')

                # Identify delimiter - common ones are ".", "/", or sometimes "%"
                if '"."' in decoded:
                    delimiter = '.'
                elif '"/"' in decoded:
                    delimiter = '/'
                elif '"%"' in decoded:
                    delimiter = '%'

                # Extract folder name using regex to be more reliable
                import re
                match = re.search(r'"([^"]+)"$', decoded)
                if match:
                    folder_name = match.group(1)
                    all_folders.append(folder_name)
                    continue

                # Fallback extraction methods if regex didn't work
                if '"' in decoded:
                    parts = decoded.split('"')
                    if len(parts) >= 4:
                        folder_name = parts[3].strip()
                        all_folders.append(folder_name)
                        continue

                # Last resort extraction
                parts = decoded.split()
                if len(parts) > 0:
                    folder_name = parts[-1].strip('"')
                    all_folders.append(folder_name)

            except Exception as e:
                current_app.logger.warning(f"Error parsing folder: {str(e)} - {folder_raw}")
                continue

        # Second pass: organize folders into hierarchy
        folder_structure = []
        folder_map = {}  # To track parent-child relationships

        # Common standard folder names to look for (including variations)
        standard_folders = {
            'inbox': ['inbox', 'eingang', 'reception', 'entrada', 'in'],
            'sent': ['sent', 'sent items', 'sent mail', 'gesendet', 'enviado', 'envoyé'],
            'drafts': ['draft', 'drafts', 'entwurf', 'entwürfe', 'borradores', 'brouillons'],
            'trash': ['trash', 'deleted', 'deleted items', 'papierkorb', 'gelöscht', 'eliminado', 'corbeille'],
            'junk': ['junk', 'spam', 'junk mail', 'spamordner', 'correo no deseado', 'indésirables'],
            'archive': ['archive', 'archiv', 'archivo', 'archivage']
        }

        # Helper to normalize folder names for comparison
        def normalize_folder(name):
            return name.lower()

        # Identify folder type for icons and standard sorting
        def identify_folder_type(folder_name):
            norm_name = normalize_folder(folder_name)
            for folder_type, variations in standard_folders.items():
                if any(variation in norm_name for variation in variations):
                    return folder_type
            return 'folder'  # Default type

        # Process folders to build hierarchy
        for folder_name in sorted(all_folders, key=str.lower):
            folder_info = {
                'name': folder_name,
                'display_name': folder_name.split(delimiter)[-1] if delimiter in folder_name else folder_name,
                'type': identify_folder_type(folder_name),
                'children': [],
                'path': folder_name,
                'has_children': False
            }

            # Check if this is a child folder
            parent_path = delimiter.join(folder_name.split(delimiter)[:-1])
            if parent_path and parent_path in folder_map:
                folder_map[parent_path]['has_children'] = True
                folder_map[parent_path]['children'].append(folder_info)
            else:
                folder_structure.append(folder_info)

            # Add to folder map for building hierarchy
            folder_map[folder_name] = folder_info

        # Sort top-level folders: INBOX first, then standard folders, then others
        def folder_sort_key(folder):
            if normalize_folder(folder['name']) == 'inbox':
                return '0'
            elif folder['type'] != 'folder':
                # Standard folders come after inbox but before custom folders
                return f'1{folder["name"].lower()}'
            else:
                return f'2{folder["name"].lower()}'

        folder_structure.sort(key=folder_sort_key)

        # If no folders were found (unlikely), add INBOX as fallback
        if not folder_structure:
            folder_structure.append({
                'name': 'INBOX',
                'display_name': 'INBOX',
                'type': 'inbox',
                'children': [],
                'path': 'INBOX',
                'has_children': False
            })

        return folder_structure

    def get_emails(self, folder='INBOX', limit=50, offset=0, search_criteria=None):
        imap = self.connect_imap()
        imap.select(folder)

        if search_criteria:
            status, data = imap.search(None, search_criteria)
        else:
            status, data = imap.search(None, 'ALL')

        if status != 'OK':
            raise Exception(f"Failed to search emails: {status}")

        email_ids = data[0].split()
        email_ids.reverse()  # Most recent first

        # Apply pagination
        start = min(offset, len(email_ids))
        end = min(offset + limit, len(email_ids))
        paginated_ids = email_ids[start:end]

        emails = []
        for email_id in paginated_ids:
            status, data = imap.fetch(email_id, '(RFC822)')
            if status != 'OK':
                continue

            raw_email = data[0][1]
            msg = email.message_from_bytes(raw_email)

            # Parse email data
            subject = msg.get('Subject', '')
            if subject.startswith('=?'):
                subject = email.header.decode_header(subject)[0][0]
                if isinstance(subject, bytes):
                    subject = subject.decode('utf-8', errors='replace')

            from_address = msg.get('From', '')
            date_str = msg.get('Date', '')

            try:
                date = datetime.strptime(date_str, '%a, %d %b %Y %H:%M:%S %z')
            except:
                date = datetime.now()

            # Get email body
            body = ''
            if msg.is_multipart():
                for part in msg.walk():
                    content_type = part.get_content_type()
                    content_disposition = str(part.get('Content-Disposition'))

                    if content_type == 'text/plain' and 'attachment' not in content_disposition:
                        body = part.get_payload(decode=True).decode('utf-8', errors='replace')
                        break
                    elif content_type == 'text/html' and 'attachment' not in content_disposition and not body:
                        body = part.get_payload(decode=True).decode('utf-8', errors='replace')
            else:
                body = msg.get_payload(decode=True).decode('utf-8', errors='replace')

            # Check for attachments
            attachments = []
            if msg.is_multipart():
                for part in msg.walk():
                    if part.get_content_maintype() == 'multipart':
                        continue
                    if part.get('Content-Disposition') is None:
                        continue

                    filename = part.get_filename()
                    if filename:
                        attachments.append({
                            'filename': filename,
                            'content_type': part.get_content_type(),
                            'size': len(part.get_payload(decode=True))
                        })

            emails.append({
                'id': email_id.decode('utf-8'),
                'subject': subject,
                'from': from_address,
                'date': date.strftime('%Y-%m-%d %H:%M'),
                'body': body,
                'has_attachments': len(attachments) > 0,
                'attachments': attachments,
                'read': 'Seen' in imap.fetch(email_id, '(FLAGS)')[1][0].decode(),
                'folder': folder
            })

        return emails, len(email_ids)

    def get_email(self, email_id, folder='INBOX'):
        imap = self.connect_imap()
        imap.select(folder)

        status, data = imap.fetch(email_id.encode(), '(RFC822)')
        if status != 'OK':
            raise Exception("Failed to fetch email")

        raw_email = data[0][1]
        msg = email.message_from_bytes(raw_email)

        # Parse email
        subject = msg.get('Subject', '')
        if subject.startswith('=?'):
            subject = email.header.decode_header(subject)[0][0]
            if isinstance(subject, bytes):
                subject = subject.decode('utf-8', errors='replace')

        from_address = msg.get('From', '')
        to_address = msg.get('To', '')
        cc_address = msg.get('Cc', '')
        date_str = msg.get('Date', '')

        try:
            date = datetime.strptime(date_str, '%a, %d %b %Y %H:%M:%S %z')
            date_formatted = date.strftime('%Y-%m-%d %H:%M')
        except:
            date_formatted = date_str

        # Get email body
        plain_body = ''
        html_body = ''

        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                content_disposition = str(part.get('Content-Disposition'))

                if content_type == 'text/plain' and 'attachment' not in content_disposition:
                    plain_body = part.get_payload(decode=True).decode('utf-8', errors='replace')
                elif content_type == 'text/html' and 'attachment' not in content_disposition:
                    html_body = part.get_payload(decode=True).decode('utf-8', errors='replace')
        else:
            if msg.get_content_type() == 'text/plain':
                plain_body = msg.get_payload(decode=True).decode('utf-8', errors='replace')
            elif msg.get_content_type() == 'text/html':
                html_body = msg.get_payload(decode=True).decode('utf-8', errors='replace')

        # Get attachments
        attachments = []
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_maintype() == 'multipart':
                    continue
                if part.get('Content-Disposition') is None:
                    continue

                filename = part.get_filename()
                if filename:
                    payload = part.get_payload(decode=True)
                    attachments.append({
                        'filename': filename,
                        'content_type': part.get_content_type(),
                        'size': len(payload),
                        'content': base64.b64encode(payload).decode('utf-8')
                    })

        # Mark as read
        imap.store(email_id.encode(), '+FLAGS', '\\Seen')

        return {
            'id': email_id,
            'subject': subject,
            'from': from_address,
            'to': to_address,
            'cc': cc_address,
            'date': date_formatted,
            'plain_body': plain_body,
            'html_body': html_body,
            'attachments': attachments,
            'folder': folder
        }

    def send_email(self, to_emails, subject, body, cc_emails=None, bcc_emails=None, attachments=None, html_body=None):
        smtp = self.connect_smtp()

        msg = MIMEMultipart('alternative')
        msg['From'] = self.username
        msg['To'] = ', '.join(to_emails) if isinstance(to_emails, list) else to_emails
        msg['Subject'] = subject

        if cc_emails:
            msg['Cc'] = ', '.join(cc_emails) if isinstance(cc_emails, list) else cc_emails

        # Add plain text and HTML parts
        msg.attach(MIMEText(body, 'plain'))
        if html_body:
            msg.attach(MIMEText(html_body, 'html'))

        # Add attachments
        if attachments:
            for attachment in attachments:
                part = MIMEApplication(attachment['content'])
                part.add_header('Content-Disposition', f'attachment; filename="{attachment["filename"]}"')
                msg.attach(part)

        # Build recipient list
        recipients = to_emails if isinstance(to_emails, list) else [to_emails]

        if cc_emails:
            recipients += cc_emails if isinstance(cc_emails, list) else [cc_emails]

        if bcc_emails:
            recipients += bcc_emails if isinstance(bcc_emails, list) else [bcc_emails]

        # Send email
        smtp.send_message(msg)
        return True

    def delete_email(self, email_id, folder='INBOX'):
        imap = self.connect_imap()
        imap.select(folder)

        # Move to Trash or delete permanently
        if folder.lower() == 'trash':
            imap.store(email_id.encode(), '+FLAGS', '\\Deleted')
            imap.expunge()
        else:
            trash_folder = 'Trash'
            # Try to find the trash folder
            folders = self.get_folders()
            for f in folders:
                if 'trash' in f.lower():
                    trash_folder = f
                    break

            result = imap.copy(email_id.encode(), trash_folder)
            if result[0] == 'OK':
                imap.store(email_id.encode(), '+FLAGS', '\\Deleted')
                imap.expunge()

        return True

    def move_email(self, email_id, source_folder, destination_folder):
        imap = self.connect_imap()
        imap.select(source_folder)

        result = imap.copy(email_id.encode(), destination_folder)
        if result[0] == 'OK':
            imap.store(email_id.encode(), '+FLAGS', '\\Deleted')
            imap.expunge()
            return True
        else:
            return False

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
    return render_template('emailclient/index.html')

@email_bp.route('/setup', methods=['GET', 'POST'])
@login_required
def setup():
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
            client = EmailClient(imap_server, smtp_server, username, password, imap_port, smtp_port)
            client.connect_imap()
            client.connect_smtp()
            client.disconnect()

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
            flash(f'Connection failed: {str(e)}', 'error')

    return render_template('emailclient/setup.html', settings=existing_settings)

@email_bp.route('/inbox')
@email_bp.route('/folder/<folder>')
@login_required
def inbox(folder='INBOX'):
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
def api_emails():
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
        client = EmailClient(
            settings.imap_server,
            settings.smtp_server,
            settings.username,
            settings.password,
            settings.imap_port,
            settings.smtp_port
        )

        search_criteria = None
        if search:
            search_criteria = f'(OR SUBJECT "{search}" FROM "{search}")'

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
def api_folders():
    from database.identity.models import EmailSettings

    settings = EmailSettings.query.filter_by(user_id=current_user.id).first()
    if not settings:
        return jsonify({'error': 'Email not configured'}), 400

    try:
        client = EmailClient(
            settings.imap_server,
            settings.smtp_server,
            settings.username,
            settings.password,
            settings.imap_port,
            settings.smtp_port
        )

        folders = client.get_folders()
        client.disconnect()

        return jsonify({'folders': folders})
    except Exception as e:
        current_app.logger.error(f"Error fetching folders: {str(e)}")
        return jsonify({'error': str(e)}), 500

@email_bp.route('/view/<folder>/<email_id>')
@login_required
def view_email(folder, email_id):
    return render_template('emailclient/view.html', folder=folder, email_id=email_id)

@email_bp.route('/api/email/<folder>/<email_id>')
@login_required
def api_email(folder, email_id):
    from database.identity.models import EmailSettings

    settings = EmailSettings.query.filter_by(user_id=current_user.id).first()
    if not settings:
        return jsonify({'error': 'Email not configured'}), 400

    try:
        client = EmailClient(
            settings.imap_server,
            settings.smtp_server,
            settings.username,
            settings.password,
            settings.imap_port,
            settings.smtp_port
        )

        email_data = client.get_email(email_id, folder)
        client.disconnect()

        return jsonify(email_data)
    except Exception as e:
        current_app.logger.error(f"Error fetching email: {str(e)}")
        return jsonify({'error': str(e)}), 500

@email_bp.route('/compose')
@login_required
def compose():
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
    from database.identity.models import EmailSettings

    settings = EmailSettings.query.filter_by(user_id=current_user.id).first()
    if not settings:
        return jsonify({'error': 'Email not configured'}), 400

    data = request.json
    to_emails = data.get('to', '').split(',')
    cc_emails = data.get('cc', '').split(',') if data.get('cc') else None
    bcc_emails = data.get('bcc', '').split(',') if data.get('bcc') else None
    subject = data.get('subject', '')
    body = data.get('body', '')
    html_body = data.get('html_body', None)
    attachments = data.get('attachments', [])

    # Validate
    if not to_emails or not subject.strip():
        return jsonify({'error': 'To field and subject are required'}), 400

    try:
        client = EmailClient(
            settings.imap_server,
            settings.smtp_server,
            settings.username,
            settings.password,
            settings.imap_port,
            settings.smtp_port
        )

        client.send_email(
            to_emails=[email.strip() for email in to_emails if email.strip()],
            subject=subject,
            body=body,
            cc_emails=[email.strip() for email in cc_emails if email.strip()] if cc_emails else None,
            bcc_emails=[email.strip() for email in bcc_emails if email.strip()] if bcc_emails else None,
            html_body=html_body,
            attachments=attachments
        )
        client.disconnect()

        return jsonify({'success': True})
    except Exception as e:
        current_app.logger.error(f"Error sending email: {str(e)}")
        return jsonify({'error': str(e)}), 500

@email_bp.route('/api/delete/<folder>/<email_id>', methods=['POST'])
@login_required
def api_delete_email(folder, email_id):
    from database.identity.models import EmailSettings

    settings = EmailSettings.query.filter_by(user_id=current_user.id).first()
    if not settings:
        return jsonify({'error': 'Email not configured'}), 400

    try:
        client = EmailClient(
            settings.imap_server,
            settings.smtp_server,
            settings.username,
            settings.password,
            settings.imap_port,
            settings.smtp_port
        )

        client.delete_email(email_id, folder)
        client.disconnect()

        return jsonify({'success': True})
    except Exception as e:
        current_app.logger.error(f"Error deleting email: {str(e)}")
        return jsonify({'error': str(e)}), 500

@email_bp.route('/api/move', methods=['POST'])
@login_required
def api_move_email():
    from database.identity.models import EmailSettings

    settings = EmailSettings.query.filter_by(user_id=current_user.id).first()
    if not settings:
        return jsonify({'error': 'Email not configured'}), 400

    data = request.json
    email_id = data.get('email_id')
    source_folder = data.get('source_folder')
    destination_folder = data.get('destination_folder')

    if not all([email_id, source_folder, destination_folder]):
        return jsonify({'error': 'Missing required parameters'}), 400

    try:
        client = EmailClient(
            settings.imap_server,
            settings.smtp_server,
            settings.username,
            settings.password,
            settings.imap_port,
            settings.smtp_port
        )

        success = client.move_email(email_id, source_folder, destination_folder)
        client.disconnect()

        if success:
            return jsonify({'success': True})
        else:
            return jsonify({'error': 'Failed to move email'}), 500
    except Exception as e:
        current_app.logger.error(f"Error moving email: {str(e)}")
        return jsonify({'error': str(e)}), 500

@email_bp.route('/api/attachment/<folder>/<email_id>/<filename>')
@login_required
def api_attachment(folder, email_id, filename):
    from database.identity.models import EmailSettings
    from flask import send_file, make_response
    import io

    settings = EmailSettings.query.filter_by(user_id=current_user.id).first()
    if not settings:
        return jsonify({'error': 'Email not configured'}), 400

    try:
        client = EmailClient(
            settings.imap_server,
            settings.smtp_server,
            settings.username,
            settings.password,
            settings.imap_port,
            settings.smtp_port
        )

        email_data = client.get_email(email_id, folder)
        client.disconnect()

        for attachment in email_data['attachments']:
            if attachment['filename'] == filename:
                file_data = base64.b64decode(attachment['content'])
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
def api_folders_render():
    """Render the folder tree HTML partial for AJAX requests"""
    from database.identity.models import EmailSettings
    from flask import render_template

    settings = EmailSettings.query.filter_by(user_id=current_user.id).first()
    if not settings:
        return jsonify({'error': 'Email not configured'}), 400

    try:
        client = EmailClient(
            settings.imap_server,
            settings.smtp_server,
            settings.username,
            settings.password,
            settings.imap_port,
            settings.smtp_port
        )

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
def api_emails_render():
    """Render the email list HTML partial for AJAX requests"""
    from database.identity.models import EmailSettings
    from flask import render_template

    settings = EmailSettings.query.filter_by(user_id=current_user.id).first()
    if not settings:
        return jsonify({'error': 'Email not configured'}), 400

    folder = request.args.get('folder', 'INBOX')
    page = request.args.get('page', 1, type=int)
    limit = request.args.get('limit', 20, type=int)
    search = request.args.get('search', '')

    offset = (page - 1) * limit

    try:
        client = EmailClient(
            settings.imap_server,
            settings.smtp_server,
            settings.username,
            settings.password,
            settings.imap_port,
            settings.smtp_port
        )

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
    from database.identity.models import EmailSettings
    from flask import render_template

    settings = EmailSettings.query.filter_by(user_id=current_user.id).first()
    if not settings:
        return jsonify({'error': 'Email not configured'}), 400

    try:
        client = EmailClient(
            settings.imap_server,
            settings.smtp_server,
            settings.username,
            settings.password,
            settings.imap_port,
            settings.smtp_port
        )

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
def api_unread_count():
    """Get the count of unread emails for the navigation bar badge"""
    from database.identity.models import EmailSettings

    settings = EmailSettings.query.filter_by(user_id=current_user.id).first()
    if not settings:
        return jsonify({'unread_count': 0})

    try:
        client = EmailClient(
            settings.imap_server,
            settings.smtp_server,
            settings.username,
            settings.password,
            settings.imap_port,
            settings.smtp_port
        )

        # Connect and select inbox
        imap = client.connect_imap()
        imap.select('INBOX')

        # Search for unread messages
        status, data = imap.search(None, 'UNSEEN')

        unread_count = 0
        if status == 'OK':
            # Count unread messages
            unread_count = len(data[0].split())

        client.disconnect()

        return jsonify({'unread_count': unread_count})
    except Exception as e:
        current_app.logger.error(f"Error checking unread emails: {str(e)}")
        return jsonify({'unread_count': 0, 'error': str(e)}), 500
#-神-#