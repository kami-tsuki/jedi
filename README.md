# Jedi Flask Application

A secure, feature-rich Flask web application with robust authentication, user management, and administrative capabilities built following modern security practices.

![Flask](https://img.shields.io/badge/Flask-3.0+-green.svg)
![Python](https://img.shields.io/badge/Python-3.9+-blue.svg)
![SQLAlchemy](https://img.shields.io/badge/SQLAlchemy-2.0+-orange.svg)
![License](https://img.shields.io/badge/License-MIT-yellow.svg)

## Features

- **Multi-layered Authentication System**
  - Username/email + password login
  - Two-factor authentication (TOTP)
  - Brute force protection with account lockout
  - Password security policies

- **User Management**
  - Self-service account management
  - Profile settings for username and email changes
  - Password updates with security verification
  - Two-factor authentication activation/deactivation

- **Role-based Access Control**
  - Regular user access
  - Administrative capabilities
  - Protected routes and content

- **Security Features**
  - CSRF protection
  - Rate limiting on sensitive endpoints
  - Secure session configuration
  - Password hashing with Werkzeug
  - SQL injection protection with SQLAlchemy
  - Proxy server compatibility

- **Performance Optimization**
  - Response compression
  - Cache system for public content
  - Database connection pooling
  - SQL query optimization with indexes

- **Developer-friendly Architecture**
  - Blueprint-based modular design
  - SQLAlchemy ORM for database interactions
  - Separation of concerns
  - Environmental configuration

## Project Structure

```
jedi/
├── app.py                  # Application factory and entry point
├── docker-compose.yml      # Docker configuration for containerized deployment
├── Dockerfile              # Docker build instructions
├── forms.py                # WTForms definitions for all forms
├── requirements.txt        # Python dependencies
├── database/               # Database models and configuration
│   ├── __init__.py
│   └── identity/           # User and authentication models
│       ├── __init__.py
│       └── models.py       # User model with authentication logic
├── docker/                 # Additional Docker configuration
├── endpoints/              # API and view endpoints (Flask Blueprints)
│   ├── __init__.py
│   ├── admin.py            # Admin panel functionality
│   ├── auth.py             # Authentication routes
│   ├── dashboard.py        # User dashboard and settings
│   └── main.py             # Main public routes
├── static/                 # Static assets (CSS, JS, images)
│   └── css/
│       └── style.css       # Main stylesheet
└── templates/              # Jinja2 HTML templates
    ├── admin/              # Admin panel templates
    ├── auth/               # Authentication templates
    ├── dashboard/          # User dashboard templates
    ├── errors/             # Error pages
    └── main/               # Main site templates
```

## Installation

### Prerequisites

- Python 3.9+
- pip (Python package manager)
- [Optional] Docker and Docker Compose for containerized deployment

### Local Development Setup

1. **Clone the repository**

```bash
git clone https://github.com/yourusername/jedi-flask-app.git
cd jedi-flask-app
```

2. **Create a virtual environment**

```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. **Install dependencies**

```bash
pip install -r requirements.txt
```

4. **Configure environment variables**

Create a `.env` file in the project root (or modify the existing one):

```
FLASK_APP=app.py
FLASK_ENV=development
FLASK_DEBUG=1
SECRET_KEY=your-secret-key-change-this
HOST=0.0.0.0
PORT=5000

# Database settings
DATABASE_URI=sqlite:///app.db

# Initial admin credentials
ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=StrongAdminPassword

# Feature flags
REGISTRATION_ENABLED=true
```

5. **Run the application**

```bash
flask run
```

The application will be available at http://localhost:5000

### Docker Deployment

1. **Build and start the containers**

```bash
docker-compose up -d
```

2. **Access the application**

The application will be available at http://localhost:5000

## Usage

### Default Admin Access

The system comes preconfigured with an administrator account that's created on first startup:

- Username: admin (or as configured in .env)
- Email: admin@example.com (or as configured in .env)
- Password: As configured in the ADMIN_PASSWORD environment variable

### User Features

- **Registration**: If enabled, new users can register from the login page
- **Dashboard**: Personal area with user information
- **Settings**: Manage account details:
  - Update username
  - Change email address
  - Update password
  - Enable/disable two-factor authentication

### Administrative Features

- **User Management**: View, edit, and manage user accounts
- **System Settings**: Configure application behavior

## Security

The application implements several security best practices:

- Passwords are hashed using Werkzeug's generate_password_hash
- CSRF protection on all forms
- Rate limiting to prevent brute force attacks
- Secure session cookies with httpOnly and SameSite flags
- SQL injection protection through parameterized queries
- Two-factor authentication using TOTP (compatible with Google Authenticator, Authy, etc.)

## Development

### Adding New Features

The application uses Flask Blueprints for modularity. To add a new feature:

1. Create a new blueprint in the `endpoints` directory
2. Register the blueprint in `app.py`
3. Add templates in the `templates` directory
4. Add forms in `forms.py` if needed
5. Update database models in `database` if needed

### Database Migrations

The application uses SQLAlchemy's ORM. For database schema changes:

1. Update the models in `database/identity/models.py`
2. Run the application - the changes will be applied automatically with `db.create_all()`

For more complex migrations, consider adding Flask-Migrate to the project.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgements

- [Flask](https://flask.palletsprojects.com/)
- [SQLAlchemy](https://www.sqlalchemy.org/)
- [Flask-Login](https://flask-login.readthedocs.io/)
- [PyOTP](https://pyauth.github.io/pyotp/)
