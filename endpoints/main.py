from flask import Blueprint, render_template, redirect, url_for
from flask_login import current_user, login_required
from flask_caching import Cache

main_bp = Blueprint(
    'main',
    __name__,
    template_folder='../templates/main'
)

# Initialize cache without app - will be initialized in app.py
cache = Cache(config={'CACHE_TYPE': 'SimpleCache'})

@main_bp.route('/')
@cache.cached(timeout=60)
def index():
    # Redirect unauthenticated users to login
    if not current_user.is_authenticated:
        return redirect(url_for('auth.login'))
    return render_template('main/index.html', title='Home')

@main_bp.route('/health')
def health_check():
    """Health check endpoint for monitoring"""
    from database import db
    import datetime
    from flask import jsonify

    db_healthy = False
    try:
        # Test DB connection
        db.session.execute('SELECT 1')
        db_healthy = True
    except Exception as e:
        # Log error
        print(f"Database health check failed: {str(e)}")

    status = "healthy" if db_healthy else "unhealthy"
    code = 200 if db_healthy else 500

    return jsonify({
        "status": status,
        "database": "connected" if db_healthy else "disconnected",
        "timestamp": datetime.datetime.utcnow().isoformat()
    }), code
