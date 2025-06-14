import os
from datetime import timedelta, datetime
from flask import Flask, render_template, request, redirect, url_for, g, jsonify
from flask_compress import Compress
from flask_caching import Cache
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.middleware.proxy_fix import ProxyFix
from dotenv import load_dotenv
from flask_login import current_user, LoginManager
from flask_migrate import Migrate
from flask_wtf.csrf import CSRFProtect
import logging
from logging.handlers import RotatingFileHandler

from database import db
from database.identity.models import User
from endpoints.main import main_bp, cache as main_cache
from endpoints.auth import auth_bp, limiter as auth_limiter
from endpoints.dashboard import dashboard_bp
from endpoints.admin import admin_bp
from endpoints.monitoring import monitoring_bp
from endpoints.email_client import email_bp, cache as email_cache, limiter as email_limiter

# Define public endpoints that don't require authentication
PUBLIC_ENDPOINTS = [
    'auth.login',
    'auth.register',
    'auth.logout',
    'main.health_check',
    'static'
]

# Initialize extensions
login_manager = LoginManager()
migrate = Migrate()
csrf = CSRFProtect()

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
    migrate.init_app(app, db)

    # Initialize login manager
    login_manager.init_app(app)
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
    email_cache.init_app(app)  # Initialize cache in email client blueprint

    # Add current year to all templates
    @app.context_processor
    def inject_now():
        return {'now': datetime.now()}

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
    email_limiter.init_app(app)  # Initialize limiter in email client blueprint

    # Initialize CSRF protection
    csrf.init_app(app)

    # Setup logging
    setup_logging(app)

    # Register blueprints
    app.register_blueprint(main_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(dashboard_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(monitoring_bp)
    app.register_blueprint(email_bp)

    # Create database tables
    with app.app_context():
        db.create_all()
        create_admin_user(db)

    # Register error handlers
    register_error_handlers(app)

    @app.context_processor
    def inject_now():
        return {'now': datetime.utcnow()}

    # Provide CSRF token for all templates
    @app.context_processor
    def inject_csrf_token():
        from flask_wtf.csrf import generate_csrf
        return dict(csrf_token=generate_csrf)

    @app.after_request
    def set_csrf_cookie(response):
        from flask_wtf.csrf import generate_csrf
        if request.path.startswith('/static/'):
            return response
        response.set_cookie('csrf_token', generate_csrf(), samesite='Strict')
        return response

    return app

def setup_logging(app):
    if not os.path.exists('logs'):
        os.mkdir('logs')

    file_handler = RotatingFileHandler('logs/app.log', maxBytes=10240, backupCount=10)
    file_handler.setFormatter(logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
    file_handler.setLevel(logging.INFO)

    app.logger.addHandler(file_handler)
    app.logger.setLevel(logging.INFO)
    app.logger.info('Application startup')

def create_admin_user(db):
    admin = User.query.filter_by(username='admin').first()
    if not admin:
        admin = User(username='admin', email='admin@example.com', is_admin=True)
        admin.set_password('adminpassword')
        db.session.add(admin)
        db.session.commit()
        print('Admin user created')
    else:
        print('Admin user already exists: admin')

def register_error_handlers(app):
    @app.errorhandler(404)
    def page_not_found(e):
        return render_template('errors/404.html'), 404

    @app.errorhandler(500)
    def internal_server_error(e):
        app.logger.error(f"Internal server error: {str(e)}")
        return render_template('errors/500.html'), 500

    @app.errorhandler(CSRFError)
    def handle_csrf_error(e):
        app.logger.warning(f"CSRF error: {str(e)}")
        if request.is_xhr:
            return jsonify({"error": "CSRF token is invalid or expired"}), 400
        return render_template('errors/400.html', error=str(e)), 400

# Import CSRF Error after function definition to avoid circular import
from flask_wtf.csrf import CSRFError

# Create the application instance
app = create_app()

if __name__ == '__main__':
    host = os.getenv('HOST', '0.0.0.0')
    port = int(os.getenv('PORT', 5000))
    debug = os.getenv('FLASK_DEBUG', '0') == '1'
    app.run(host=host, port=port, debug=debug)
