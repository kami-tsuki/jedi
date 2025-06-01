import os
from datetime import timedelta
from flask import Flask, render_template, request, redirect, url_for, g
from flask_compress import Compress
from flask_caching import Cache
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.middleware.proxy_fix import ProxyFix
from dotenv import load_dotenv
from flask_login import current_user
import logging

from database import db
from database.identity.models import User
from endpoints.main import main_bp, cache as main_cache
from endpoints.auth import auth_bp, limiter as auth_limiter
from endpoints.dashboard import dashboard_bp
from endpoints.admin import admin_bp

# Define public endpoints that don't require authentication
PUBLIC_ENDPOINTS = [
    'auth.login',
    'auth.register',
    'auth.logout',
    'main.health_check',
    'static'
]

def create_app(config=None):
    """
    Application factory function that creates and configures the Flask application
    """
    # Load environment variables
    load_dotenv()

    # Initialize Flask app
    app = Flask(__name__)

    # Apply middleware for proxy server compatibility
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    # Configuration
    app_config = {
        'SECRET_KEY': os.getenv('SECRET_KEY', 'default-dev-key'),
        'SQLALCHEMY_DATABASE_URI': os.getenv('DATABASE_URI', 'sqlite:///app.db'),
        'SQLALCHEMY_TRACK_MODIFICATIONS': False,
        'SQLALCHEMY_ENGINE_OPTIONS': {
            'pool_pre_ping': True,
            'pool_recycle': 300,
        },
        'REMEMBER_COOKIE_SECURE': os.getenv('FLASK_ENV') != 'development',  # Allow insecure cookies in dev
        'REMEMBER_COOKIE_HTTPONLY': True,
        'SESSION_COOKIE_SECURE': os.getenv('FLASK_ENV') != 'development',  # Allow insecure cookies in dev
        'SESSION_COOKIE_HTTPONLY': True,
        'SESSION_COOKIE_SAMESITE': 'Lax',
        'PERMANENT_SESSION_LIFETIME': timedelta(days=7),
        'MAX_LOGIN_ATTEMPTS': 5,
        'LOCKOUT_TIME': 15,  # minutes
        'CACHE_TYPE': 'SimpleCache',
        'CACHE_DEFAULT_TIMEOUT': 300,
        # Feature flags
        'REGISTRATION_ENABLED': os.getenv('REGISTRATION_ENABLED', 'false').lower() == 'true'
    }

    # Apply config
    app.config.update(app_config)

    # Override with any passed config
    if config:
        app.config.update(config)

    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    # Initialize extensions
    db.init_app(app)

    # Initialize login manager
    from flask_login import LoginManager
    login_manager = LoginManager(app)
    login_manager.login_view = 'auth.login'
    login_manager.login_message = 'Please log in to access this page.'
    login_manager.login_message_category = 'info'
    login_manager.session_protection = "strong"

    @login_manager.user_loader
    def load_user(id):
        return User.query.get(int(id))

    # Authentication middleware
    @app.before_request
    def check_authentication():
        # Skip middleware for error handlers
        if request.endpoint and request.endpoint.startswith('static'):
            return

        # Allow access to public endpoints
        if request.endpoint in PUBLIC_ENDPOINTS or request.endpoint and any(request.endpoint.startswith(ep) for ep in PUBLIC_ENDPOINTS):
            return

        # Enforce authentication for all other routes
        if not current_user.is_authenticated:
            app.logger.warning(f"Unauthorized access attempt to {request.endpoint}")
            return redirect(url_for('auth.login'))

    # Configure caching
    cache = Cache(app)
    main_cache.init_app(app)  # Initialize cache in main blueprint

    # Enable compression
    compress = Compress(app)

    # Configure rate limiting
    limiter = Limiter(
        get_remote_address,
        app=app,
        default_limits=["200 per day", "50 per hour"],
        storage_uri="memory://",
    )
    auth_limiter.init_app(app)  # Initialize limiter in auth blueprint

    # Register blueprints
    app.register_blueprint(main_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(dashboard_bp)
    app.register_blueprint(admin_bp)

    # Error handlers
    @app.errorhandler(404)
    def not_found_error(error):
        return render_template('errors/404.html'), 404

    @app.errorhandler(500)
    def internal_error(error):
        db.session.rollback()  # Rollback db session in case of error
        return render_template('errors/500.html'), 500

    # Database initialization
    with app.app_context():
        initialize_database(app)

    return app

def initialize_database(app):
    """Create database tables and initial admin user"""
    db.create_all()

    # Check if admin user exists, if not create it
    admin_username = os.getenv('ADMIN_USERNAME')
    admin_email = os.getenv('ADMIN_EMAIL')
    admin_password = os.getenv('ADMIN_PASSWORD')

    if not all([admin_username, admin_email, admin_password]):
        app.logger.warning("Admin credentials not fully defined in .env file")
        return

    existing_admin = User.query.filter(
        (User.username == admin_username) | (User.email == admin_email)
    ).first()

    if not existing_admin:
        admin = User(
            username=admin_username,
            email=admin_email,
            is_admin=True
        )
        admin.set_password(admin_password)
        db.session.add(admin)
        db.session.commit()
        app.logger.info(f"Created initial admin user: {admin_username}")
    else:
        app.logger.info(f"Admin user already exists: {existing_admin.username}")

# Create the application instance
app = create_app()

if __name__ == '__main__':
    host = os.getenv('HOST', '0.0.0.0')
    port = int(os.getenv('PORT', 5000))
    debug = os.getenv('FLASK_DEBUG', '0') == '1'
    app.run(host=host, port=port, debug=debug)

