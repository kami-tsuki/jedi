from flask import Blueprint, render_template, redirect, url_for, flash
from flask_login import login_required, current_user
import functools

from database.identity.models import User

admin_bp = Blueprint(
    'admin',
    __name__,
    url_prefix='/admin',
    template_folder='../templates'
)

# Security decorator
def admin_required(f):
    @functools.wraps(f)
    @login_required
    def decorated_function(*args, **kwargs):
        if not current_user.is_admin:
            flash('You need administrator privileges to access this page.', 'danger')
            return redirect(url_for('main.index'))
        return f(*args, **kwargs)
    return decorated_function

@admin_bp.route('/')
@admin_required
def admin():
    users = User.query.all()
    return render_template('admin/admin.html', title='Admin Dashboard', users=users)
#-神-#