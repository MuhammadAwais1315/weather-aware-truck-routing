import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / '.env')
load_dotenv(BASE_DIR.parent / '.env')

SECRET_KEY = os.getenv('DJANGO_SECRET_KEY', 'unsafe-local-development-key')
DEBUG = os.getenv('DEBUG', 'False').strip().lower() in {'1', 'true', 'yes', 'on'}
if not DEBUG and (not os.getenv('DJANGO_SECRET_KEY') or SECRET_KEY == 'unsafe-local-development-key'):
    from django.core.exceptions import ImproperlyConfigured
    raise ImproperlyConfigured('DJANGO_SECRET_KEY must be set when DEBUG is false.')

ALLOWED_HOSTS = [host.strip() for host in os.getenv('ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',') if host.strip()]
for host_variable in ('RENDER_EXTERNAL_HOSTNAME', 'VERCEL_URL', 'VERCEL_PROJECT_PRODUCTION_URL'):
    deployment_hostname = os.getenv(host_variable, '').strip().removeprefix('https://').removeprefix('http://').rstrip('/')
    if deployment_hostname and deployment_hostname not in ALLOWED_HOSTS:
        ALLOWED_HOSTS.append(deployment_hostname)
APP_VERSION = os.getenv('APP_VERSION', '1.0.0')

INSTALLED_APPS = [
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'rest_framework',
    'corsheaders',
    'apps.routing.apps.RoutingConfig',
    'apps.geocoding.apps.GeocodingConfig',
    'apps.weather.apps.WeatherConfig',
    'apps.checkpoints.apps.CheckpointsConfig',
    'apps.risk_engine.apps.RiskEngineConfig',
    'apps.recommendations.apps.RecommendationsConfig',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]
ROOT_URLCONF = 'config.urls'
TEMPLATES = []
WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': BASE_DIR / 'db.sqlite3'}}
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True
STATIC_URL = 'static/'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        'CORS_ALLOWED_ORIGINS',
        'http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:5174',
    ).split(',')
    if origin.strip()
]

# Render terminates TLS at its proxy; these settings make Django honor the
# original HTTPS scheme and apply browser-facing production security headers.
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SECURE_SSL_REDIRECT = not DEBUG
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'
if not DEBUG:
    SECURE_HSTS_SECONDS = int(os.getenv('SECURE_HSTS_SECONDS', '3600'))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = False

REST_FRAMEWORK = {
    'DEFAULT_RENDERER_CLASSES': ['rest_framework.renderers.JSONRenderer'],
    'DEFAULT_PARSER_CLASSES': ['rest_framework.parsers.JSONParser'],
    'EXCEPTION_HANDLER': 'services.exceptions.api_exception_handler',
    'DEFAULT_THROTTLE_CLASSES': ['rest_framework.throttling.ScopedRateThrottle'],
    'DEFAULT_THROTTLE_RATES': {
        'autocomplete': os.getenv('API_AUTOCOMPLETE_RATE', '120/min'),
        'geocode': os.getenv('API_GEOCODE_RATE', '60/min'),
        'plan': os.getenv('API_PLAN_RATE', '20/hour'),
        'forecast': os.getenv('API_FORECAST_RATE', '120/hour'),
    },
}

# Django's default cache is process-local, which makes DRF throttles ineffective
# across serverless instances. Set REDIS_URL in production for a shared cache.
REDIS_URL = os.getenv('REDIS_URL', '').strip()
if REDIS_URL:
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.redis.RedisCache',
            'LOCATION': REDIS_URL,
        },
    }
else:
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
            'LOCATION': 'weatherroute-local',
        },
    }

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'standard': {'format': '%(asctime)s %(levelname)s %(name)s %(message)s'},
    },
    'handlers': {
        'console': {'class': 'logging.StreamHandler', 'formatter': 'standard'},
    },
    'root': {'handlers': ['console'], 'level': os.getenv('LOG_LEVEL', 'INFO').upper()},
    'loggers': {
        'django.request': {'handlers': ['console'], 'level': 'ERROR', 'propagate': False},
        'services': {'handlers': ['console'], 'level': 'INFO', 'propagate': False},
    },
}
