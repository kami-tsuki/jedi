from datetime import datetime
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy import event, Index
from database import db
import pyotp
import base64
import os

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
