from datetime import datetime
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy import event, Index
from database import db
import pyotp
import base64
import os
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import json

# Generate a strong encryption key based on a secret
def generate_key(app_secret, salt=b'jedi_email_encryption'):
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(app_secret.encode('utf-8')))
    return key

# Encryption helper
class Encryptor:
    _instance = None
    _key = None

    @classmethod
    def get_instance(cls, app_secret=None):
        if cls._instance is None:
            if app_secret is None:
                from flask import current_app
                app_secret = current_app.config['SECRET_KEY']
            cls._key = generate_key(app_secret)
            cls._instance = cls()
        return cls._instance

    def encrypt(self, data):
        if not data:
            return None
        fernet = Fernet(self._key)
        return fernet.encrypt(data.encode('utf-8')).decode('utf-8')

    def decrypt(self, encrypted_data):
        if not encrypted_data:
            return None
        try:
            fernet = Fernet(self._key)
            return fernet.decrypt(encrypted_data.encode('utf-8')).decode('utf-8')
        except Exception as e:
            # If decryption fails, return None
            return None

class User(db.Model, UserMixin):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), unique=True, nullable=False, index=True)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(128), nullable=False)
    is_admin = db.Column(db.Boolean, default=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_login = db.Column(db.DateTime, nullable=True)
    active = db.Column(db.Boolean, default=True, index=True)
    login_attempts = db.Column(db.Integer, default=0)
    last_login_attempt = db.Column(db.DateTime, nullable=True)

    # 2FA fields
    totp_secret = db.Column(db.String(32), nullable=True)
    totp_enabled = db.Column(db.Boolean, default=False)

    # Create composite index for optimizing auth queries
    __table_args__ = (
        Index('idx_user_auth', 'username', 'email', 'active'),
    )

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    @hybrid_property
    def is_active(self):
        return self.active

    def reset_login_attempts(self):
        self.login_attempts = 0
        db.session.commit()

    def increment_login_attempts(self):
        self.login_attempts += 1
        self.last_login_attempt = datetime.utcnow()
        db.session.commit()

    # 2FA methods
    def generate_totp_secret(self):
        """Generate a new TOTP secret for the user"""
        self.totp_secret = base64.b32encode(os.urandom(10)).decode('utf-8')
        return self.totp_secret

    def get_totp_uri(self):
        """Get the provisioning URI for the TOTP"""
        if not self.totp_secret:
            return None

        totp = pyotp.TOTP(self.totp_secret)
        return totp.provisioning_uri(name=self.email, issuer_name="Jedi Flask App")

    def verify_totp(self, token):
        """Verify a TOTP token"""
        if not self.totp_secret:
            return False

        totp = pyotp.TOTP(self.totp_secret)
        return totp.verify(token)

    def enable_totp(self):
        """Enable TOTP for this user"""
        if not self.totp_secret:
            self.generate_totp_secret()

        self.totp_enabled = True
        db.session.commit()

    def disable_totp(self):
        """Disable TOTP for this user"""
        self.totp_enabled = False
        db.session.commit()

    def __repr__(self):
        return f'<User {self.username}>'

# Use SQLAlchemy event listeners for faster operations
@event.listens_for(User.password_hash, 'set')
def receive_password_hash_set(target, value, oldvalue, initiator):
    """Reset login attempts when password is changed"""
    target.login_attempts = 0

class EmailSettings(db.Model):
    __tablename__ = 'email_settings'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, unique=True)
    _username = db.Column('username', db.String(255), nullable=False)
    _password = db.Column('password', db.String(512), nullable=False)
    _imap_server = db.Column('imap_server', db.String(255), nullable=False)
    imap_port = db.Column(db.Integer, default=993)
    _smtp_server = db.Column('smtp_server', db.String(255), nullable=False)
    smtp_port = db.Column(db.Integer, default=587)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = db.relationship('User', backref=db.backref('email_settings', uselist=False))

    @property
    def username(self):
        """Get the decrypted username"""
        encryptor = Encryptor.get_instance()
        return encryptor.decrypt(self._username)

    @username.setter
    def username(self, value):
        """Encrypt the username before storing"""
        encryptor = Encryptor.get_instance()
        self._username = encryptor.encrypt(value)

    @property
    def password(self):
        """Get the decrypted password"""
        encryptor = Encryptor.get_instance()
        return encryptor.decrypt(self._password)

    @password.setter
    def password(self, value):
        """Encrypt the password before storing"""
        encryptor = Encryptor.get_instance()
        self._password = encryptor.encrypt(value)

    @property
    def imap_server(self):
        """Get the decrypted IMAP server"""
        encryptor = Encryptor.get_instance()
        return encryptor.decrypt(self._imap_server)

    @imap_server.setter
    def imap_server(self, value):
        """Encrypt the IMAP server before storing"""
        encryptor = Encryptor.get_instance()
        self._imap_server = encryptor.encrypt(value)

    @property
    def smtp_server(self):
        """Get the decrypted SMTP server"""
        encryptor = Encryptor.get_instance()
        return encryptor.decrypt(self._smtp_server)

    @smtp_server.setter
    def smtp_server(self, value):
        """Encrypt the SMTP server before storing"""
        encryptor = Encryptor.get_instance()
        self._smtp_server = encryptor.encrypt(value)

    def __repr__(self):
        return f'<EmailSettings for user {self.user_id}>'
