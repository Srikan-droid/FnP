"""Django settings. Everything environment-specific comes from the environment (or backend/.env in
development); nothing secret lives in this file. Defaults are the safe ones: DEBUG is off unless
turned on, and cookies are Secure whenever DEBUG is off."""

import os
from pathlib import Path
from urllib.parse import unquote, urlparse

from django.core.exceptions import ImproperlyConfigured
from django.utils.csp import CSP

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """Reads KEY=VALUE lines into the environment without overriding real environment variables."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


_load_dotenv(BASE_DIR / ".env")


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None:
        raise ImproperlyConfigured(f"Set {name} in the environment or backend/.env")
    return value


def env_bool(name: str, default: bool = False) -> bool:
    # Left empty ("DJANGO_HTTPS=" copied from .env.example) means not set: the default applies.
    value = os.environ.get(name, "").strip().lower()
    return default if not value else value in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in env(name, default).split(",") if item.strip()]


SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = env_bool("DJANGO_DEBUG", False)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "127.0.0.1,localhost")
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS", "")

INSTALLED_APPS = [
    # Django's admin site at /admin/, for staff accounts (manage.py createsuperuser); see cases/admin.py.
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    "rest_framework",
    "cases",
]

MIDDLEWARE = [
    "cases.middleware.RequestSizeLimitMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.csp.ContentSecurityPolicyMiddleware",
    # After the CSP middleware, so it hands it the admin's policy (responses pass back up the list).
    "cases.middleware.AdminCspMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "cases.auth_sessions.SessionRenewalMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    # Last, so it sees who is signed in and the response as sent. Writes only while API_LOG is on.
    "cases.middleware.ApiLogMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
# The API renders nothing server-side; templates are for the admin site only.
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# The admin site's stylesheets and scripts. runserver serves them in development; elsewhere run
# collectstatic and serve STATIC_ROOT from the reverse proxy.
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"


def _database_from_url(url: str) -> dict:
    parsed = urlparse(url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise ImproperlyConfigured("DATABASE_URL must be a postgres:// URL")
    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": parsed.path.lstrip("/"),
        "USER": unquote(parsed.username or ""),
        "PASSWORD": unquote(parsed.password or ""),
        "HOST": parsed.hostname or "",
        "PORT": str(parsed.port or 5432),
        # psycopg's connection pool; PgBouncer can sit in front later without code changes.
        "OPTIONS": {"pool": {"min_size": 1, "max_size": int(env("DATABASE_POOL_MAX", "10"))}},
        "CONN_HEALTH_CHECKS": True,
    }


DATABASES = {"default": _database_from_url(env("DATABASE_URL"))}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_USER_MODEL = "cases.User"
# The development sign-in issues sessions directly; no password is ever set or checked.
AUTH_PASSWORD_VALIDATORS: list = []

LANGUAGE_CODE = "en-gb"
TIME_ZONE = "UTC"
USE_I18N = False
USE_TZ = True

# ---- Files: uploaded evidence. Local disk now; swapping to Azure Blob is a STORAGES change only.
MEDIA_ROOT = BASE_DIR / env("MEDIA_ROOT", "media")
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    # The admin site's stylesheets and scripts (see STATIC_URL).
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}
EVIDENCE_MAX_BYTES = int(env("EVIDENCE_MAX_BYTES", str(15 * 1024 * 1024)))
# How many documents one application's library ("Your documents") holds beyond a place for every
# document its form takes (documents replaced at a question stay in it), so a draft cannot grow
# without bound. See views.evidence.library_limit.
EVIDENCE_LIBRARY_MAX_FILES = int(env("EVIDENCE_LIBRARY_MAX_FILES", "30"))
FILE_UPLOAD_PERMISSIONS = 0o600
DATA_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024  # JSON bodies; files stream to disk instead.

# ---- Encryption of personal identifiers at rest (national ID number).
FIELD_ENCRYPTION_KEY = env("FIELD_ENCRYPTION_KEY")

# ---- Data Authentication API (server-to-server only; never exposed to the browser).
ENGINE_BASE_URL = env("ENGINE_BASE_URL").rstrip("/")
ENGINE_TIMEOUT_SECONDS = float(env("ENGINE_TIMEOUT_SECONDS", "30"))
ENGINE_POLL_INTERVAL_SECONDS = int(env("ENGINE_POLL_INTERVAL_SECONDS", "5"))
# Whether page requests follow running cases themselves (the queue and a case page ask the engine
# when no worker has). Needed without the follow_runs worker; with it running, set false so no page
# ever waits on the engine.
ENGINE_FOLLOW_IN_REQUESTS = env_bool("ENGINE_FOLLOW_IN_REQUESTS", True)
# A run still unfinished this long after it was sent is failed, so it can be sent again. Real runs
# take two to three minutes.
ENGINE_MAX_RUN_SECONDS = int(env("ENGINE_MAX_RUN_SECONDS", "3600"))
# An editing lock on a department's questions lapses after this long without word from the editor.
QUESTIONNAIRE_LOCK_IDLE_SECONDS = int(env("QUESTIONNAIRE_LOCK_IDLE_SECONDS", "900"))
# When the reviewer accepts every flagged answer, ask the engine to score the run anyway
# (POST /authentication/force-score), so the decision has a score and an assessment. Off: the case
# goes to the decision unscored, as before.
ENGINE_FORCE_SCORE = env_bool("ENGINE_FORCE_SCORE", True)
# A forced run the engine has not started scoring this long after it was asked is given up on (the
# case returns to the decision, where the reviewer can ask again).
ENGINE_FORCE_START_SECONDS = int(env("ENGINE_FORCE_START_SECONDS", "300"))

# ---- Sessions and CSRF. The frontend is served from the same origin (dev proxy / reverse proxy).
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
# HTTPS only, unless DJANGO_HTTPS=false: a proof-of-concept server reached over plain HTTP, where
# secure-only cookies would never be sent back and nobody could stay signed in. Not for real data.
HTTPS = env_bool("DJANGO_HTTPS", not DEBUG)
SESSION_COOKIE_SECURE = HTTPS
# The development sign-in: any email signs in as that applicant and "admin" as the reviewer, with no
# password (cases/views/session.py). On only where DEBUG is, unless set explicitly, so a deployment
# never lets anyone in as the reviewer by typing a word.
DEV_SIGN_IN = env_bool("DEV_SIGN_IN", DEBUG)
# A session ends after 8 hours without use, not 8 hours after sign-in: using it renews it, so
# someone working through a long review is never signed out mid-task (the frontend assumes this).
# It is renewed at most every few minutes rather than on every request (every poll would otherwise
# write the session row): cases.auth_sessions.SessionRenewalMiddleware.
SESSION_COOKIE_AGE = 8 * 60 * 60
SESSION_ENGINE = "cases.auth_sessions"
SESSION_SAVE_EVERY_REQUEST = False
CSRF_COOKIE_HTTPONLY = False  # The SPA reads it to send X-CSRFToken; it is not a secret.
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SECURE = HTTPS

# ---- Transport and headers.
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https") if env_bool("DJANGO_BEHIND_PROXY") else None
SECURE_SSL_REDIRECT = HTTPS and not DEBUG and env_bool("DJANGO_SSL_REDIRECT", True)
SECURE_HSTS_SECONDS = 31536000 if HTTPS and not DEBUG else 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = HTTPS and not DEBUG
# API responses are JSON or documents: nothing in them may load or run anything.
SECURE_CSP = {"default-src": [CSP.NONE], "frame-ancestors": [CSP.NONE], "base-uri": [CSP.NONE]}

# ---- API.
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["cases.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
        "rest_framework.throttling.ScopedRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": env("THROTTLE_ANON", "60/min"),
        "user": env("THROTTLE_USER", "600/min"),
        "session": env("THROTTLE_SESSION", "10/min"),
        "upload": env("THROTTLE_UPLOAD", "60/min"),
        "create": env("THROTTLE_CREATE", "20/hour"),
    },
}

# With several server processes, set REDIS_URL so they share one cache: rate limits then count
# across all of them, and the engine's evidence options are fetched once. Needs the redis package.
CACHES = {
    "default": (
        {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": env("REDIS_URL")}
        if env("REDIS_URL", "")
        else {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}
    )
}

# Requests are logged by method, path and status only: bodies carry personal data.
# Every /api/ call, with the JSON sent and returned (cases.middleware.ApiLogMiddleware): to the
# console and to API_LOG_FILE ("" for the console only). On by default only while debugging, as it
# holds personal data; API_LOG=true turns it on elsewhere. Bodies longer than API_LOG_MAX_CHARS are cut.
API_LOG = env_bool("API_LOG", DEBUG)
API_LOG_FILE = env("API_LOG_FILE", str(BASE_DIR / "logs" / "api.log"))
API_LOG_MAX_CHARS = int(env("API_LOG_MAX_CHARS", "4000"))
_api_handlers = ["api_console"]
if API_LOG and API_LOG_FILE:
    Path(API_LOG_FILE).parent.mkdir(parents=True, exist_ok=True)
    _api_handlers.append("api_file")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"api": {"format": "[%(asctime)s] %(message)s", "datefmt": "%Y-%m-%d %H:%M:%S"}},
    "handlers": {
        "console": {"class": "logging.StreamHandler"},
        "api_console": {"class": "logging.StreamHandler", "formatter": "api"},
        **(
            {
                "api_file": {
                    "class": "logging.handlers.RotatingFileHandler",
                    "filename": API_LOG_FILE,
                    "maxBytes": 5 * 1024 * 1024,
                    "backupCount": 3,
                    "encoding": "utf-8",
                    "formatter": "api",
                }
            }
            if API_LOG and API_LOG_FILE
            else {}
        ),
    },
    "root": {"handlers": ["console"], "level": "WARNING"},
    "loggers": {
        "cases.api": {"handlers": _api_handlers, "level": "INFO" if API_LOG else "WARNING", "propagate": False},
        "cases": {"level": "INFO"},
        "engine": {"level": "INFO"},
        # One line per call to the AI engine (method, URL, status), e.g. in `journalctl -u
        # fnp-portal-worker`. ENGINE_LOG_REQUESTS=false hides them.
        "httpx": {"level": "INFO" if env_bool("ENGINE_LOG_REQUESTS", True) else "WARNING"},
    },
}
