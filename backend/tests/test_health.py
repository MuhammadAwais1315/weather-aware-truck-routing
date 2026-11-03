from django.conf import settings
from django.test import SimpleTestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient


class HealthEndpointTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()

    def test_health_returns_status_and_application_version(self):
        response = self.client.get(reverse('health'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'status': 'ok', 'version': settings.APP_VERSION})

    @override_settings(APP_VERSION='9.8.7')
    def test_health_reports_configured_version(self):
        response = self.client.get('/api/health/')
        self.assertEqual(response.json()['version'], '9.8.7')

    def test_health_is_available_without_authentication(self):
        response = self.client.get('/api/health/')
        self.assertEqual(response.status_code, 200)


class ConfigurationTests(SimpleTestCase):
    def test_rest_framework_has_central_exception_handler(self):
        self.assertEqual(
            settings.REST_FRAMEWORK['EXCEPTION_HANDLER'],
            'services.exceptions.api_exception_handler',
        )

    def test_cors_allows_frontend_development_origin(self):
        self.assertIn('http://localhost:5173', settings.CORS_ALLOWED_ORIGINS)
        self.assertIn('http://127.0.0.1:5173', settings.CORS_ALLOWED_ORIGINS)
        self.assertIn('http://127.0.0.1:5174', settings.CORS_ALLOWED_ORIGINS)

    def test_api_keys_are_not_declared_as_settings_literals(self):
        import os
        self.assertEqual(settings.SECRET_KEY, os.getenv('DJANGO_SECRET_KEY', 'unsafe-local-development-key'))

    def test_routing_key_is_read_from_environment(self):
        import os
        from services.route_provider import OpenRouteServiceClient
        self.assertEqual(OpenRouteServiceClient().api_key, os.getenv('OPENROUTESERVICE_API_KEY', '').strip())
