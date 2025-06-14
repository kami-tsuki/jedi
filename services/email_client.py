"""
Email Client Module

Provides full-featured email client functionality including:
- Email fetching, sending, and management
- Folder operations and email organization
- Per-user email client instances
"""

import imaplib
import smtplib
import email
import base64
import logging
import re
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication
from email.header import decode_header
from datetime import datetime
from typing import Dict, List, Tuple, Optional, Any, Union

from services.email_connection import EmailConnection

logger = logging.getLogger(__name__)


def _extract_attachments(msg: email.message.Message) -> List[Dict[str, Any]]:
    """Extract attachments with their content"""
    attachments = []

    if not msg.is_multipart():
        return attachments

    for part in msg.walk():
        if part.get_content_maintype() == 'multipart':
            continue
        if part.get('Content-Disposition') is None:
            continue

        filename = part.get_filename()
        if filename:
            try:
                payload = part.get_payload(decode=True)
                if payload:
                    attachments.append({
                        'filename': filename,
                        'content_type': part.get_content_type(),
                        'size': len(payload),
                        'content': base64.b64encode(payload).decode('utf-8')
                    })
            except Exception as e:
                logger.warning(f"Failed to process attachment {filename}: {e}")

    return attachments


def _extract_email_body(msg: email.message.Message) -> Tuple[str, str]:
    """Extract both plain text and HTML body from email message"""
    plain_body = ''
    html_body = ''

    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            content_disposition = str(part.get('Content-Disposition'))

            if 'attachment' in content_disposition:
                continue

            payload = part.get_payload(decode=True)
            if not payload:
                continue

            try:
                decoded_content = payload.decode('utf-8', errors='replace')

                if content_type == 'text/plain' and not plain_body:
                    plain_body = decoded_content
                elif content_type == 'text/html' and not html_body:
                    html_body = decoded_content
            except Exception as e:
                logger.warning(f"Failed to decode email part: {e}")
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            try:
                content = payload.decode('utf-8', errors='replace')
                if msg.get_content_type() == 'text/plain':
                    plain_body = content
                elif msg.get_content_type() == 'text/html':
                    html_body = content
            except Exception as e:
                logger.warning(f"Failed to decode email body: {e}")

    return plain_body, html_body


def _decode_email_header(header: Optional[str]) -> str:
    """Decode email headers that may contain non-ASCII characters or encoded words"""
    if not header:
        return ''

    decoded_parts = []
    for parts in decode_header(header):
        text, charset = parts
        if isinstance(text, bytes):
            try:
                if charset:
                    text = text.decode(charset, errors='replace')
                else:
                    text = text.decode('utf-8', errors='replace')
            except Exception:
                text = text.decode('ascii', errors='replace')
        decoded_parts.append(str(text))
    return ' '.join(decoded_parts)


class EmailClient:
    """
    Full-featured email client with IMAP and SMTP functionality

    Handles:
    - Connection management
    - Email retrieval and sending
    - Folder operations
    - Email management (moving, deleting)
    """

    def __init__(self, imap_server: str, smtp_server: str,
                 username: str, password: str,
                 imap_port: int = 993, smtp_port: int = 587,
                 enable_verbose_logs: bool = False):
        """
        Initialize a new email client instance

        Args:
            imap_server: IMAP server address
            smtp_server: SMTP server address
            username: Email username/address
            password: Email password
            imap_port: IMAP port, usually 993 for SSL
            smtp_port: SMTP port, usually 587 for STARTTLS
            enable_verbose_logs: Set to True to enable detailed connection logs
        """
        # Store connection details
        self.imap_server = imap_server
        self.smtp_server = smtp_server
        self.username = username
        self.password = password
        self.imap_port = imap_port
        self.smtp_port = smtp_port

        # Initialize connection objects
        self.imap = None
        self.smtp = None

        # Create a connection manager instance for this client
        self._connection_manager = EmailConnection()

        # Configure extended timeout for larger mailboxes
        self._connection_manager.set_timeout(60)

        # More aggressive retry policy
        self._connection_manager.set_retry_policy(max_retries=2, retry_delay=1)

        # Reduce log verbosity by default
        self._connection_manager.set_verbosity(enable_verbose_logs)

    def connect_imap(self) -> imaplib.IMAP4:
        """
        Connect to the IMAP server, reusing existing connection if available

        Returns:
            IMAP4 connection object

        Raises:
            ConnectionError: If connection fails
        """
        # Reuse existing connection if available and valid
        if self.imap and self.imap.state != 'LOGOUT':
            try:
                # Test if connection is still alive with a simple command
                self.imap.noop()
                return self.imap
            except Exception as e:
                logger.warning(f"Stale IMAP connection detected: {str(e)}")
                # Connection is stale, create a new one
                self.imap = None

        # Create new connection with all security options as fallbacks
        self.imap = self._connection_manager.create_imap_connection(
            self.imap_server,
            self.username,
            self.password,
            self.imap_port,
            use_ssl=True,
            verify_cert=False,  # Disable verification for problem emails
            allow_insecure=True  # Allow insecure as last resort
        )
        return self.imap

    def connect_smtp(self) -> smtplib.SMTP:
        """
        Connect to the SMTP server, reusing existing connection if available

        Returns:
            SMTP connection object

        Raises:
            ConnectionError: If connection fails
        """
        # SMTP connections typically shouldn't be reused for long periods
        # Create a fresh connection each time
        if self.smtp:
            try:
                self.smtp.quit()
            except:
                pass
            self.smtp = None

        self.smtp = self._connection_manager.create_smtp_connection(
            self.smtp_server,
            self.username,
            self.password,
            self.smtp_port,
            use_ssl=True,
            verify_cert=False,  # Disable verification for problem emails
            allow_insecure=True  # Allow insecure as last resort
        )
        return self.smtp

    def disconnect(self):
        """Close all connections gracefully"""
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

    def get_folders(self) -> List[Dict[str, Any]]:
        """
        Get all available mailbox folders with proper hierarchy structure

        Returns:
            List of folder dictionaries with hierarchy information

        Raises:
            Exception: If folder retrieval fails
        """
        imap = self.connect_imap()
        status, folders_raw = imap.list()

        if status != 'OK':
            raise Exception("Failed to get folders")

        # Create structured folder hierarchy
        return self._parse_folder_structure(folders_raw)

    def _parse_folder_structure(self, folders_raw: List[bytes]) -> List[Dict[str, Any]]:
        """
        Parse raw IMAP folder data into a structured hierarchy

        Args:
            folders_raw: Raw folder data from IMAP

        Returns:
            Structured folder hierarchy
        """
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
                folder_match = re.search(r'"([^"]+)"$', decoded)
                if folder_match:
                    folder_name = folder_match.group(1)
                    all_folders.append({
                        'name': folder_name,
                        'attributes': decoded.split('"')[1].strip(),
                        'path': folder_name
                    })
            except Exception as e:
                logger.warning(f"Failed to parse folder data: {str(e)}")

        # Add additional properties and structure to folders
        for folder in all_folders:
            # Check if this is an INBOX or special folder
            if folder['name'].upper() == 'INBOX':
                folder['type'] = 'inbox'
            elif '\\Sent' in folder['attributes'] or 'Sent' in folder['name']:
                folder['type'] = 'sent'
            elif '\\Drafts' in folder['attributes'] or 'Draft' in folder['name']:
                folder['type'] = 'drafts'
            elif '\\Trash' in folder['attributes'] or 'Trash' in folder['name']:
                folder['type'] = 'trash'
            elif '\\Junk' in folder['attributes'] or 'Spam' in folder['name'] or 'Junk' in folder['name']:
                folder['type'] = 'spam'
            else:
                folder['type'] = 'folder'

            # Get unread count for each folder
            try:
                imap = self.connect_imap()
                status, data = imap.select(f'"{folder["name"]}"', readonly=True)
                if status == 'OK':
                    status, data = imap.search(None, 'UNSEEN')
                    if status == 'OK':
                        folder['unread'] = len(data[0].split())
                    else:
                        folder['unread'] = 0
            except Exception as e:
                logger.warning(f"Failed to get unread count for {folder['name']}: {str(e)}")
                folder['unread'] = 0

        return all_folders

    def get_emails(self, folder: str, limit: int = 50, offset: int = 0,
                   search_criteria: str = None) -> Tuple[List[Dict[str, Any]], int]:
        """
        Get emails from a specified folder

        Args:
            folder: Folder name to fetch emails from
            limit: Maximum number of emails to fetch
            offset: Starting offset for pagination
            search_criteria: Optional IMAP search criteria

        Returns:
            Tuple of (email_list, total_count)

        Raises:
            Exception: If email retrieval fails
        """
        imap = self.connect_imap()
        status, _ = imap.select(f'"{folder}"', readonly=True)

        if status != 'OK':
            raise Exception(f"Failed to select folder: {folder}")

        # Default to getting all emails if no search criteria provided
        if not search_criteria:
            search_command = 'ALL'
        else:
            # Convert human-readable search to IMAP format
            search_command = self._convert_search_to_imap(search_criteria)

        status, data = imap.search(None, search_command)
        if status != 'OK':
            raise Exception(f"Search failed: {search_command}")

        email_ids = data[0].split()
        total_count = len(email_ids)  # Total count for pagination

        # Calculate slice for pagination
        start = offset
        end = min(offset + limit, len(email_ids))

        # Reverse to get newest emails first
        email_ids_to_fetch = email_ids[start:end][::-1]

        emails = []
        for email_id in email_ids_to_fetch:
            try:
                status, msg_data = imap.fetch(email_id, '(RFC822 FLAGS)')
                if status != 'OK':
                    logger.warning(f"Failed to fetch email ID {email_id}")
                    continue

                raw_email = msg_data[0][1]
                flags = imaplib.ParseFlags(msg_data[1])

                msg = email.message_from_bytes(raw_email)

                # Process email data
                email_data = self._parse_email(msg, email_id.decode('utf-8'), flags)
                emails.append(email_data)

            except Exception as e:
                logger.warning(f"Failed to process email ID {email_id}: {str(e)}")
                continue

        return emails, total_count

    def _parse_email(self, msg: email.message.Message, email_id: str, flags: List[bytes]) -> Dict[str, Any]:
        """Parse email message into structured dictionary"""
        # Extract basic headers
        from_header = _decode_email_header(msg['From'])
        subject = _decode_email_header(msg['Subject'])
        date_str = msg['Date']

        try:
            parsed_date = email.utils.parsedate_to_datetime(date_str)
        except:
            parsed_date = datetime.now()

        # Extract email bodies
        plain_body, html_body = _extract_email_body(msg)

        # Extract attachments
        attachments = _extract_attachments(msg)

        # Parse flags
        is_read = rb'\\Seen' in flags
        is_flagged = rb'\\Flagged' in flags

        # Extract email addresses
        from_email = None
        from_name = None

        from_matches = re.search(r'([^<]*)<([^>]+)>', from_header)
        if from_matches:
            from_name = from_matches.group(1).strip()
            from_email = from_matches.group(2).strip()
        else:
            from_email = from_header.strip()

        # Compile email object
        email_data = {
            'id': email_id,
            'subject': subject or '(No Subject)',
            'from': {
                'name': from_name or '',
                'email': from_email or ''
            },
            'date': parsed_date.isoformat(),
            'timestamp': int(parsed_date.timestamp()),
            'read': is_read,
            'flagged': is_flagged,
            'has_attachments': len(attachments) > 0,
            'attachments': attachments,
            'body': {
                'plain': plain_body,
                'html': html_body
            }
        }

        return email_data

    def mark_as_read(self, folder: str, email_id: str) -> bool:
        """Mark an email as read"""
        return self._set_flag(folder, email_id, '\\Seen')

    def mark_as_unread(self, folder: str, email_id: str) -> bool:
        """Mark an email as unread"""
        return self._remove_flag(folder, email_id, '\\Seen')

    def flag_email(self, folder: str, email_id: str) -> bool:
        """Flag an email as important"""
        return self._set_flag(folder, email_id, '\\Flagged')

    def unflag_email(self, folder: str, email_id: str) -> bool:
        """Remove important flag from an email"""
        return self._remove_flag(folder, email_id, '\\Flagged')

    def _set_flag(self, folder: str, email_id: str, flag: str) -> bool:
        """Set a flag on an email"""
        try:
            imap = self.connect_imap()
            imap.select(f'"{folder}"')
            imap.store(email_id, '+FLAGS', flag)
            return True
        except Exception as e:
            logger.warning(f"Failed to set flag {flag} on email {email_id}: {str(e)}")
            return False

    def _remove_flag(self, folder: str, email_id: str, flag: str) -> bool:
        """Remove a flag from an email"""
        try:
            imap = self.connect_imap()
            imap.select(f'"{folder}"')
            imap.store(email_id, '-FLAGS', flag)
            return True
        except Exception as e:
            logger.warning(f"Failed to remove flag {flag} from email {email_id}: {str(e)}")
            return False

    def delete_email(self, folder: str, email_id: str) -> bool:
        """
        Delete an email (move to trash or mark as deleted)

        Args:
            folder: Current folder name
            email_id: Email ID to delete

        Returns:
            Success status
        """
        try:
            imap = self.connect_imap()

            # First try to find Trash folder
            status, folders_raw = imap.list()
            trash_folder = None

            for folder_raw in folders_raw:
                decoded = folder_raw.decode('utf-8', errors='replace')
                if '\\Trash' in decoded or 'Trash' in decoded:
                    # Extract folder name
                    match = re.search(r'"([^"]+)"$', decoded)
                    if match:
                        trash_folder = match.group(1)
                        break

            # Select source folder
            imap.select(f'"{folder}"')

            if trash_folder and folder != trash_folder:
                # Move to trash if trash folder exists and we're not already in trash
                imap.copy(email_id, f'"{trash_folder}"')
                # Mark as deleted in current folder
                imap.store(email_id, '+FLAGS', '\\Deleted')
                imap.expunge()
            else:
                # Just mark as deleted if no trash folder or already in trash
                imap.store(email_id, '+FLAGS', '\\Deleted')
                imap.expunge()

            return True
        except Exception as e:
            logger.warning(f"Failed to delete email {email_id}: {str(e)}")
            return False

    def send_email(self, to: Union[str, List[str]], subject: str,
                  body_text: str, body_html: str = None,
                  cc: Union[str, List[str]] = None,
                  bcc: Union[str, List[str]] = None,
                  attachments: List[Dict[str, Any]] = None) -> bool:
        """
        Send an email

        Args:
            to: Recipient email address(es)
            subject: Email subject
            body_text: Plain text body
            body_html: Optional HTML body
            cc: Optional CC recipients
            bcc: Optional BCC recipients
            attachments: Optional list of attachments

        Returns:
            Success status
        """
        try:
            # Create message container
            msg = MIMEMultipart('alternative')
            msg['From'] = self.username

            # Handle recipients
            if isinstance(to, list):
                msg['To'] = ', '.join(to)
            else:
                msg['To'] = to

            if cc:
                if isinstance(cc, list):
                    msg['Cc'] = ', '.join(cc)
                else:
                    msg['Cc'] = cc

            # BCC doesn't show in headers
            if isinstance(bcc, str):
                bcc = [bcc] if bcc else []

            # Subject and date
            msg['Subject'] = subject
            msg['Date'] = email.utils.formatdate(localtime=True)

            # Plain text body
            part1 = MIMEText(body_text, 'plain')
            msg.attach(part1)

            # HTML body if provided
            if body_html:
                part2 = MIMEText(body_html, 'html')
                msg.attach(part2)

            # Attachments
            if attachments:
                for attachment in attachments:
                    filename = attachment.get('filename')
                    content_type = attachment.get('content_type', 'application/octet-stream')
                    content = attachment.get('content')

                    if not all([filename, content]):
                        continue

                    # Decode base64 content if it's encoded
                    if isinstance(content, str):
                        try:
                            content = base64.b64decode(content)
                        except:
                            # If not valid base64, treat as raw bytes
                            content = content.encode('utf-8')

                    part = MIMEApplication(content)
                    part.add_header('Content-Disposition', 'attachment', filename=filename)
                    part.add_header('Content-Type', content_type, name=filename)
                    msg.attach(part)

            # Connect to SMTP server and send
            smtp = self.connect_smtp()

            # Combine all recipients
            all_recipients = []
            if isinstance(to, list):
                all_recipients.extend(to)
            else:
                all_recipients.append(to)

            if cc:
                if isinstance(cc, list):
                    all_recipients.extend(cc)
                else:
                    all_recipients.append(cc)

            if bcc:
                all_recipients.extend(bcc)

            # Send the message
            smtp.send_message(msg, from_addr=self.username, to_addrs=all_recipients)

            # Try to save to Sent folder
            try:
                # First try to find Sent folder
                imap = self.connect_imap()
                status, folders_raw = imap.list()
                sent_folder = None

                for folder_raw in folders_raw:
                    decoded = folder_raw.decode('utf-8', errors='replace')
                    if '\\Sent' in decoded or 'Sent' in decoded:
                        # Extract folder name
                        match = re.search(r'"([^"]+)"$', decoded)
                        if match:
                            sent_folder = match.group(1)
                            break

                if sent_folder:
                    # Convert to IMAP format
                    imap_format = msg.as_string().encode('utf-8')
                    imap.append(f'"{sent_folder}"', '\\Seen', None, imap_format)
            except Exception as e:
                logger.warning(f"Failed to save email to sent folder: {str(e)}")
                # This is not a critical error, so we still consider the send successful

            return True
        except Exception as e:
            logger.error(f"Failed to send email: {str(e)}")
            return False

    def get_folder_stats(self, folder: str) -> Dict[str, Any]:
        """
        Get folder statistics

        Args:
            folder: Folder name

        Returns:
            Dictionary with folder statistics
        """
        try:
            imap = self.connect_imap()
            status, data = imap.select(f'"{folder}"', readonly=True)

            if status != 'OK':
                raise Exception(f"Failed to select folder: {folder}")

            # Get total messages
            total_messages = int(data[0])

            # Get unread count
            status, data = imap.search(None, 'UNSEEN')
            if status == 'OK':
                unread_count = len(data[0].split())
            else:
                unread_count = 0

            # Get flagged count
            status, data = imap.search(None, 'FLAGGED')
            if status == 'OK':
                flagged_count = len(data[0].split())
            else:
                flagged_count = 0

            return {
                'name': folder,
                'total': total_messages,
                'unread': unread_count,
                'flagged': flagged_count
            }
        except Exception as e:
            logger.error(f"Failed to get folder stats: {str(e)}")
            return {
                'name': folder,
                'total': 0,
                'unread': 0,
                'flagged': 0,
                'error': str(e)
            }

    def _convert_search_to_imap(self, search: str) -> str:
        """Convert a human-readable search to IMAP search criteria"""
        if not search:
            return 'ALL'

        # Simple keyword search - search in subject, from, to, and body
        return f'OR OR OR SUBJECT "{search}" FROM "{search}" TO "{search}" BODY "{search}"'

    def get_unread_count(self, folder_name=None) -> Union[int, Dict[str, int]]:
        """
        Get unread count for a specific folder or all folders

        Args:
            folder_name: Optional folder name. If provided, returns count just for that folder
                        If not provided, returns counts for all folders as a dictionary

        Returns:
            Either a single unread count (int) or a dictionary of folder names to unread counts
        """
        try:
            imap = self.connect_imap()

            # If a specific folder is requested
            if folder_name:
                try:
                    status, _ = imap.select(f'"{folder_name}"', readonly=True)
                    if status != 'OK':
                        return 0

                    status, data = imap.search(None, 'UNSEEN')
                    if status == 'OK':
                        return len(data[0].split())
                    return 0
                except Exception as e:
                    logger.warning(f"Failed to get unread count for folder {folder_name}: {str(e)}")
                    return 0

            # Otherwise get counts for all folders
            status, folders_raw = imap.list()

            if status != 'OK':
                raise Exception("Failed to get folders")

            unread_counts = {}

            for folder_raw in folders_raw:
                try:
                    # Extract folder name
                    decoded = folder_raw.decode('utf-8', errors='replace')
                    folder_match = re.search(r'"([^"]+)"$', decoded)

                    if not folder_match:
                        continue

                    folder_name = folder_match.group(1)

                    # Select folder
                    status, _ = imap.select(f'"{folder_name}"', readonly=True)
                    if status != 'OK':
                        continue

                    # Get unread count
                    status, data = imap.search(None, 'UNSEEN')
                    if status == 'OK':
                        unread_counts[folder_name] = len(data[0].split())
                except Exception as e:
                    logger.warning(f"Failed to get unread count for folder: {str(e)}")
                    continue

            return unread_counts
        except Exception as e:
            logger.error(f"Failed to get unread counts: {str(e)}")
            return 0 if folder_name else {}

    def create_folder(self, folder_name: str) -> bool:
        """
        Create a new folder

        Args:
            folder_name: Name of the folder to create

        Returns:
            Success status
        """
        try:
            imap = self.connect_imap()
            imap.create(f'"{folder_name}"')
            return True
        except Exception as e:
            logger.error(f"Failed to create folder {folder_name}: {str(e)}")
            return False

    def delete_folder(self, folder_name: str) -> bool:
        """
        Delete a folder

        Args:
            folder_name: Name of the folder to delete

        Returns:
            Success status
        """
        try:
            imap = self.connect_imap()
            imap.delete(f'"{folder_name}"')
            return True
        except Exception as e:
            logger.error(f"Failed to delete folder {folder_name}: {str(e)}")
            return False

    def move_email(self, source_folder: str, target_folder: str, email_id: str) -> bool:
        """
        Move an email from one folder to another

        Args:
            source_folder: Source folder name
            target_folder: Target folder name
            email_id: Email ID to move

        Returns:
            Success status
        """
        try:
            imap = self.connect_imap()

            # Select source folder
            imap.select(f'"{source_folder}"')

            # Copy to target folder
            status, _ = imap.copy(email_id, f'"{target_folder}"')
            if status != 'OK':
                raise Exception(f"Failed to copy email to {target_folder}")

            # Delete from source folder
            imap.store(email_id, '+FLAGS', '\\Deleted')
            imap.expunge()

            return True
        except Exception as e:
            logger.error(f"Failed to move email: {str(e)}")
            return False

    def rename_folder(self, old_name: str, new_name: str) -> bool:
        """
        Rename a folder

        Args:
            old_name: Current folder name
            new_name: New folder name

        Returns:
            Success status
        """
        try:
            imap = self.connect_imap()
            imap.rename(f'"{old_name}"', f'"{new_name}"')
            return True
        except Exception as e:
            logger.error(f"Failed to rename folder: {str(e)}")
            return False

    def test_connection(self) -> Dict[str, bool]:
        """
        Test both IMAP and SMTP connections

        Returns:
            Dictionary with test results
        """
        return self._connection_manager.test_connection(
            self.imap_server,
            self.smtp_server,
            self.username,
            self.password,
            self.imap_port,
            self.smtp_port
        )

    def get_email(self, email_id: str, folder: str = 'INBOX') -> Dict[str, Any]:
        """
        Get a single email by ID from a specific folder

        Args:
            email_id: Email ID to fetch
            folder: Folder name where the email is located

        Returns:
            Email data dictionary

        Raises:
            Exception: If email retrieval fails
        """
        try:
            imap = self.connect_imap()
            status, _ = imap.select(f'"{folder}"', readonly=True)

            if status != 'OK':
                raise Exception(f"Failed to select folder: {folder}")

            # Fetch the specific email
            status, msg_data = imap.fetch(email_id, '(RFC822 FLAGS)')
            if status != 'OK':
                raise Exception(f"Failed to fetch email ID {email_id}")

            raw_email = msg_data[0][1]
            flags = imaplib.ParseFlags(msg_data[1])

            msg = email.message_from_bytes(raw_email)

            # Process email data
            email_data = self._parse_email(msg, email_id, flags)

            # Mark as read if not already
            if not email_data['read']:
                self.mark_as_read(folder, email_id)
                email_data['read'] = True

            return email_data

        except Exception as e:
            logger.error(f"Failed to get email {email_id}: {str(e)}")
            raise

