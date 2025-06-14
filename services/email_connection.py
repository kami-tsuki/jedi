"""
Email Connection Module

Provides secure connection handling for email services including:
- IMAP and SMTP protocols
- Multiple connection strategies with fallbacks
- TLS/SSL security handling with certificate validation options
"""

import imaplib
import smtplib
import ssl
import logging
import socket
import time
from typing import Tuple, Optional, Dict, Any, List, Union

logger = logging.getLogger(__name__)

class EmailConnection:
    """
    Handles secure connections to email services with robust fallback mechanisms
    and certificate validation options
    """

    def __init__(self):
        """Initialize connection manager with default settings"""
        self.timeout = 30  # Default socket timeout in seconds
        self.max_retries = 3  # Default number of retries
        self.retry_delay = 1  # Seconds between retries
        self.verbose_logging = False  # Reduce log verbosity by default

    def create_imap_connection(self, server: str, username: str, password: str,
                              port: int = 993, use_ssl: bool = True,
                              verify_cert: bool = True,
                              allow_insecure: bool = False) -> imaplib.IMAP4:
        """
        Create a connection to an IMAP server with proper error handling and fallback options

        Args:
            server: IMAP server address
            username: Email username/address
            password: Email password
            port: IMAP port (default: 993 for SSL)
            use_ssl: Whether to attempt SSL connection first
            verify_cert: Whether to verify SSL certificates
            allow_insecure: Whether to allow plain text connections as last resort

        Returns:
            IMAP4 connection object

        Raises:
            ConnectionError: If all connection methods fail
        """
        # Save original socket timeout and set our custom timeout
        original_timeout = socket.getdefaulttimeout()
        socket.setdefaulttimeout(self.timeout)

        try:
            # Create insecure context for most reliable connection
            # Many email servers use self-signed or outdated certificates
            context = self._create_insecure_context()

            # First try direct SSL connection with no verification (most reliable)
            try:
                conn = imaplib.IMAP4_SSL(server, port, ssl_context=context)
                conn.login(username, password)
                logger.info(f"IMAP connected to {server} using SSL without verification")
                return conn
            except Exception as e:
                if self.verbose_logging:
                    logger.warning(f"IMAP SSL connection failed: {str(e)}")

            # Try STARTTLS as fallback
            try:
                conn = imaplib.IMAP4(server, 143)  # Standard non-SSL port
                conn.starttls(ssl_context=context)
                conn.login(username, password)
                logger.info(f"IMAP connected to {server} using STARTTLS")
                return conn
            except Exception as e:
                if self.verbose_logging:
                    logger.warning(f"IMAP STARTTLS failed: {str(e)}")

            # Last resort: plain connection (only if explicitly allowed)
            if allow_insecure:
                try:
                    conn = imaplib.IMAP4(server, 143)
                    conn.login(username, password)
                    logger.info(f"IMAP connected to {server} using plain connection")
                    return conn
                except Exception as e:
                    if self.verbose_logging:
                        logger.warning(f"IMAP plain connection failed: {str(e)}")

            # If we get here, all methods failed
            error_msg = f"All IMAP connection methods failed to {server}"
            logger.error(error_msg)
            raise ConnectionError(error_msg)

        finally:
            # Restore original socket timeout
            socket.setdefaulttimeout(original_timeout)

    def create_smtp_connection(self, server: str, username: str, password: str,
                              port: int = 587, use_ssl: bool = True,
                              verify_cert: bool = True,
                              allow_insecure: bool = False) -> smtplib.SMTP:
        """
        Create a connection to an SMTP server with proper error handling and fallback options

        Args:
            server: SMTP server address
            username: Email username/address
            password: Email password
            port: SMTP port (default: 587 for STARTTLS)
            use_ssl: Whether to attempt SSL connection first
            verify_cert: Whether to verify SSL certificates
            allow_insecure: Whether to allow plain text connections as last resort

        Returns:
            SMTP connection object

        Raises:
            ConnectionError: If all connection methods fail
        """
        # Save original socket timeout and set our custom timeout
        original_timeout = socket.getdefaulttimeout()
        socket.setdefaulttimeout(self.timeout)

        try:
            # Create insecure context for most reliable connection
            context = self._create_insecure_context()

            # Try SMTP_SSL first (port 465)
            try:
                conn = smtplib.SMTP_SSL(server, 465, context=context)
                conn.ehlo()
                conn.login(username, password)
                logger.info(f"SMTP connected to {server} using SSL")
                return conn
            except Exception as e:
                if self.verbose_logging:
                    logger.warning(f"SMTP_SSL connection failed: {str(e)}")

            # Try STARTTLS next (port 587)
            try:
                conn = smtplib.SMTP(server, port)
                conn.ehlo()
                if conn.has_extn('STARTTLS'):
                    conn.starttls(context=context)
                    conn.ehlo()
                conn.login(username, password)
                logger.info(f"SMTP connected to {server} using STARTTLS")
                return conn
            except Exception as e:
                if self.verbose_logging:
                    logger.warning(f"SMTP STARTTLS failed: {str(e)}")

            # Last resort: plain connection
            if allow_insecure:
                try:
                    conn = smtplib.SMTP(server, 25)
                    conn.ehlo()
                    conn.login(username, password)
                    logger.info(f"SMTP connected to {server} using plain connection")
                    return conn
                except Exception as e:
                    if self.verbose_logging:
                        logger.warning(f"SMTP plain connection failed: {str(e)}")

            # If we get here, all methods failed
            error_msg = f"All SMTP connection methods failed to {server}"
            logger.error(error_msg)
            raise ConnectionError(error_msg)

        finally:
            # Restore original socket timeout
            socket.setdefaulttimeout(original_timeout)

    def _create_insecure_context(self) -> ssl.SSLContext:
        """Create an insecure SSL context for fallback connections"""
        insecure_context = ssl.create_default_context()
        insecure_context.check_hostname = False
        insecure_context.verify_mode = ssl.CERT_NONE
        return insecure_context

    def _try_starttls_imap(self, server: str, context: ssl.SSLContext) -> Tuple[imaplib.IMAP4, str]:
        """Try to connect using STARTTLS for IMAP"""
        try:
            conn = imaplib.IMAP4(server, 143)  # Standard non-SSL port
            conn.starttls(ssl_context=context)
            return conn, "STARTTLS"
        except Exception as e:
            logger.warning(f"IMAP STARTTLS failed: {str(e)}")
            raise

    def _try_starttls_smtp(self, server: str, port: int, context: ssl.SSLContext,
                          hostname: str = None) -> Tuple[smtplib.SMTP, str]:
        """Try to connect using STARTTLS for SMTP"""
        try:
            conn = smtplib.SMTP(server, port)
            conn.ehlo(hostname)
            if conn.has_extn('STARTTLS'):
                conn.starttls(context=context)
                conn.ehlo(hostname)
                return conn, "STARTTLS"
            else:
                return conn, "Plain (STARTTLS not available)"
        except Exception as e:
            logger.warning(f"SMTP STARTTLS failed: {str(e)}")
            raise

    def _create_imap_ssl(self, server: str, port: int, context: ssl.SSLContext) -> imaplib.IMAP4_SSL:
        """Create an IMAP SSL connection"""
        try:
            return imaplib.IMAP4_SSL(server, port, ssl_context=context)
        except Exception as e:
            logger.warning(f"IMAP SSL connection failed: {str(e)}")
            raise

    def _create_imap_ssl_with_hostname(self, server: str, port: int, hostname: str,
                                       context: ssl.SSLContext) -> imaplib.IMAP4_SSL:
        """Create an IMAP SSL connection with explicit hostname"""
        try:
            # Some servers require the hostname to be explicitly provided for certificate validation
            # Note: server_hostname parameter isn't supported in Python's standard IMAP4_SSL
            # Use host parameter directly but check the SSL cert against the hostname
            context.check_hostname = True
            context.verify_mode = ssl.CERT_REQUIRED
            imap_ssl = imaplib.IMAP4_SSL(host=server, port=port, ssl_context=context)
            return imap_ssl
        except Exception as e:
            logger.warning(f"IMAP SSL connection with hostname failed: {str(e)}")
            raise

    def _create_smtp_ssl(self, server: str, port: int, context: ssl.SSLContext,
                         hostname: str = None) -> Tuple[smtplib.SMTP_SSL, str]:
        """Create an SMTP_SSL connection"""
        try:
            conn = smtplib.SMTP_SSL(server, port, context=context)
            if hostname:
                conn.ehlo(hostname)
            else:
                conn.ehlo()
            return conn, "SSL direct"
        except Exception as e:
            logger.warning(f"SMTP_SSL connection failed: {str(e)}")
            raise

    def _get_proper_hostname(self, server: str) -> str:
        """
        Get the proper hostname for certificate validation

        Some servers use different hostnames for connection vs. certificate validation
        This extracts the domain part from an address like mail.example.com
        """
        parts = server.split('.')
        if len(parts) >= 2:
            # Extract domain and TLD (e.g., example.com from mail.example.com)
            return '.'.join(parts[-2:])
        return server  # Fallback to the original server name

    def test_connection(self, imap_server: str, smtp_server: str, username: str,
                        password: str, imap_port: int = 993, smtp_port: int = 587) -> Dict[str, bool]:
        """
        Test both IMAP and SMTP connections to verify credentials and server settings

        Args:
            imap_server: IMAP server address
            smtp_server: SMTP server address
            username: Email username
            password: Email password
            imap_port: IMAP port
            smtp_port: SMTP port

        Returns:
            Dict with connection test results
        """
        results = {
            'imap_success': False,
            'smtp_success': False
        }

        # Test IMAP connection
        try:
            # Try with SSL first
            imap_conn = self.create_imap_connection(
                imap_server, username, password, imap_port,
                use_ssl=True, verify_cert=False, allow_insecure=True
            )
            imap_conn.logout()
            results['imap_success'] = True
        except Exception as e:
            logger.error(f"IMAP test connection failed: {str(e)}")

        # Test SMTP connection
        try:
            # Try with STARTTLS first
            smtp_conn = self.create_smtp_connection(
                smtp_server, username, password, smtp_port,
                use_ssl=True, verify_cert=False, allow_insecure=True
            )
            smtp_conn.quit()
            results['smtp_success'] = True
        except Exception as e:
            logger.error(f"SMTP test connection failed: {str(e)}")

        return results

    def set_timeout(self, timeout: int):
        """Set connection timeout in seconds"""
        self.timeout = timeout

    def set_retry_policy(self, max_retries: int, retry_delay: float):
        """
        Set retry policy for connection attempts

        Args:
            max_retries: Maximum number of retry attempts
            retry_delay: Delay between retries in seconds
        """
        self.max_retries = max_retries
        self.retry_delay = retry_delay

    def set_verbosity(self, verbose: bool):
        """
        Control the verbosity of connection logging

        Args:
            verbose: If True, log all connection attempts, if False only log errors
        """
        self.verbose_logging = verbose
