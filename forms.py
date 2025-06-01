from flask_wtf import FlaskForm, RecaptchaField
from wtforms import StringField, PasswordField, BooleanField, SubmitField
from wtforms.validators import DataRequired, Email, Length, EqualTo, ValidationError, Regexp
from database.identity.models import User
import re

# Custom password validator
def password_check(form, field):
    password = field.data
    if not re.search(r'[A-Z]', password):
        raise ValidationError('Password must contain at least one uppercase letter.')
    if not re.search(r'[a-z]', password):
        raise ValidationError('Password must contain at least one lowercase letter.')
    if not re.search(r'[0-9]', password):
        raise ValidationError('Password must contain at least one number.')
    if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
        raise ValidationError('Password must contain at least one special character.')

class LoginForm(FlaskForm):
    username = StringField('Username or Email', validators=[
        DataRequired(),
        Length(min=3, max=120)
    ])
    password = PasswordField('Password', validators=[DataRequired()])
    remember_me = BooleanField('Remember Me')
    submit = SubmitField('Sign In')

class RegistrationForm(FlaskForm):
    username = StringField('Username', validators=[
        DataRequired(),
        Length(min=3, max=64),
        Regexp(r'^[\w.-]+$', message='Username must contain only letters, numbers, dots, underscores and dashes.')
    ])
    email = StringField('Email', validators=[
        DataRequired(),
        Email(message='Enter a valid email address.'),
        Length(max=120)
    ])
    password = PasswordField('Password', validators=[
        DataRequired(),
        Length(min=8, max=128, message='Password must be between 8 and 128 characters'),
        password_check
    ])
    confirm_password = PasswordField('Confirm Password', validators=[
        DataRequired(),
        EqualTo('password', message='Passwords must match')
    ])
    submit = SubmitField('Register')

    # Validate asynchronously for better performance
    def validate_username(self, username):
        if User.query.filter_by(username=username.data).first():
            raise ValidationError('Username already taken. Please choose a different one.')

    def validate_email(self, email):
        if User.query.filter_by(email=email.data.lower()).first():
            raise ValidationError('Email already registered. Please use a different email or log in.')

# New forms for 2FA
class TOTPVerificationForm(FlaskForm):
    """Form for verifying TOTP code during login"""
    token = StringField('6-Digit Authentication Code', validators=[
        DataRequired(),
        Length(min=6, max=6, message='Code must be exactly 6 digits'),
        Regexp(r'^\d{6}$', message='Code must contain 6 digits only')
    ])
    submit = SubmitField('Verify')

class TOTPSetupForm(FlaskForm):
    """Form for setting up 2FA"""
    token = StringField('Verification Code', validators=[
        DataRequired(),
        Length(min=6, max=6, message='Code must be exactly 6 digits'),
        Regexp(r'^\d{6}$', message='Code must contain 6 digits only')
    ])
    submit = SubmitField('Verify & Activate 2FA')

class TOTPDisableForm(FlaskForm):
    """Form for disabling 2FA"""
    token = StringField('Current 6-Digit Code', validators=[
        DataRequired(),
        Length(min=6, max=6, message='Code must be exactly 6 digits'),
        Regexp(r'^\d{6}$', message='Code must contain 6 digits only')
    ])
    submit = SubmitField('Disable 2FA')

class DisableTOTPForm(FlaskForm):
    password = PasswordField('Current Password', validators=[DataRequired()])
    submit = SubmitField('Disable 2FA')

class UpdateUsernameForm(FlaskForm):
    username = StringField('New Username', validators=[
        DataRequired(),
        Length(min=3, max=64),
        Regexp(r'^[\w.-]+$', message='Username must contain only letters, numbers, dots, underscores and dashes.')
    ])
    current_password = PasswordField('Current Password', validators=[DataRequired()])
    submit = SubmitField('Update Username')

    def validate_username(self, username):
        user = User.query.filter_by(username=username.data).first()
        if user:
            raise ValidationError('Username already taken. Please choose a different one.')

class UpdateEmailForm(FlaskForm):
    email = StringField('New Email', validators=[
        DataRequired(),
        Email(message='Enter a valid email address.'),
        Length(max=120)
    ])
    current_password = PasswordField('Current Password', validators=[DataRequired()])
    submit = SubmitField('Update Email')

    def validate_email(self, email):
        user = User.query.filter_by(email=email.data).first()
        if user:
            raise ValidationError('Email already registered. Please use a different one.')

class UpdatePasswordForm(FlaskForm):
    current_password = PasswordField('Current Password', validators=[DataRequired()])
    new_password = PasswordField('New Password', validators=[
        DataRequired(),
        Length(min=8, max=128, message='Password must be between 8 and 128 characters'),
        password_check
    ])
    confirm_password = PasswordField('Confirm New Password', validators=[
        DataRequired(),
        EqualTo('new_password', message='Passwords must match')
    ])
    submit = SubmitField('Update Password')

