from datetime import datetime, timezone
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient, APIRequestFactory

from apps.routing.serializers import PlanRequestSerializer
from services.exceptions import ServiceError, api_exception_handler
from rest_framework.exceptions import ValidationError


VALID_REQUEST = {
    'origin': 'New York, NY',
    'pickup': 'Cleveland, OH',
    'destination': 'Chicago, IL',
    'departure_time': '2026-11-03T14:00:00Z',
    'load_weight_tons': 20,
    'checkpoint_interval_miles': 25,
}


class PlanRequestSerializerTests(SimpleTestCase):
    def test_valid_request_normalizes_types_and_timezone(self):
        serializer = PlanRequestSerializer(data=VALID_REQUEST)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertIsInstance(serializer.validated_data['departure_time'], datetime)
        self.assertIsNotNone(serializer.validated_data['departure_time'].utcoffset())
        self.assertEqual(serializer.validated_data['load_weight_tons'], 20.0)
        self.assertEqual(serializer.validated_data['checkpoint_interval_miles'], 25)

    def test_default_load_and_interval_are_applied(self):
        payload = {key: value for key, value in VALID_REQUEST.items() if key not in ('load_weight_tons', 'checkpoint_interval_miles')}
        serializer = PlanRequestSerializer(data=payload)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data['load_weight_tons'], 20)
        self.assertEqual(serializer.validated_data['checkpoint_interval_miles'], 25)

    def test_missing_fields_are_rejected(self):
        serializer = PlanRequestSerializer(data={})
        self.assertFalse(serializer.is_valid())
        self.assertTrue({'origin', 'pickup', 'destination', 'departure_time'}.issubset(serializer.errors))

    def test_invalid_interval_and_load_boundaries_are_rejected(self):
        for interval in (0, 15, 100):
            with self.subTest(interval=interval):
                serializer = PlanRequestSerializer(data={**VALID_REQUEST, 'checkpoint_interval_miles': interval})
                self.assertFalse(serializer.is_valid())
        for load in (-0.01, 100.01):
            with self.subTest(load=load):
                serializer = PlanRequestSerializer(data={**VALID_REQUEST, 'load_weight_tons': load})
                self.assertFalse(serializer.is_valid())
        self.assertTrue(PlanRequestSerializer(data={**VALID_REQUEST, 'load_weight_tons': 0}).is_valid())
        self.assertTrue(PlanRequestSerializer(data={**VALID_REQUEST, 'load_weight_tons': 100}).is_valid())

    def test_identical_locations_are_rejected_case_insensitively(self):
        serializer = PlanRequestSerializer(data={**VALID_REQUEST, 'destination': ' new york, ny '})
        self.assertFalse(serializer.is_valid())
        self.assertIn('non_field_errors', serializer.errors)

    def test_pickup_cannot_duplicate_truck_location_or_destination(self):
        for field, value in [('pickup', ' new york, ny '), ('pickup', ' Chicago, IL '), ('destination', 'Cleveland, OH')]:
            with self.subTest(field=field, value=value):
                serializer = PlanRequestSerializer(data={**VALID_REQUEST, field: value})
                self.assertFalse(serializer.is_valid())
                self.assertIn('non_field_errors', serializer.errors)

    def test_invalid_departure_format_is_rejected(self):
        serializer = PlanRequestSerializer(data={**VALID_REQUEST, 'departure_time': 'next Tuesday morning'})
        self.assertFalse(serializer.is_valid())

    def test_timezone_naive_departure_is_rejected(self):
        serializer = PlanRequestSerializer(data={**VALID_REQUEST, 'departure_time': '2026-11-03T14:00:00'})
        self.assertFalse(serializer.is_valid())
        self.assertIn('departure_time', serializer.errors)


class ApiEndpointTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()

    @patch('apps.routing.views.geocode_place')
    def test_geocode_endpoint_returns_nominatim_schema(self, geocode):
        expected = {'label': 'New York, NY', 'latitude': 40.7, 'longitude': -74.0}
        geocode.return_value = expected
        response = self.client.get('/api/geocode/', {'q': 'New York'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), expected)
        geocode.assert_called_once_with('New York')

    @patch('apps.routing.views.reverse_geocode')
    def test_reverse_geocode_endpoint_returns_checkpoint_place_name(self, reverse_geocode):
        reverse_geocode.return_value = {
            'label': 'Lewisville, Texas',
            'display_name': 'Lewisville, Denton County, Texas, United States',
        }
        response = self.client.get('/api/geocode/reverse/', {'lat': '33.0462', 'lon': '-96.9942'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['label'], 'Lewisville, Texas')
        reverse_geocode.assert_called_once_with('33.0462', '-96.9942')

    def test_geocode_endpoint_rejects_short_query(self):
        response = self.client.get('/api/geocode/', {'q': 'NY'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], 'Enter at least 3 characters.')

    @patch('apps.routing.views.openrouteservice_client.autocomplete')
    def test_autocomplete_endpoint_returns_suggestion_schema(self, autocomplete):
        suggestions = [{'label': 'New York, NY', 'longitude': -74.0, 'latitude': 40.7}]
        autocomplete.return_value = suggestions
        response = self.client.get('/api/geocode/autocomplete/', {'q': 'New York'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'suggestions': suggestions})
        autocomplete.assert_called_once_with('New York')

    @patch('apps.routing.views.openrouteservice_client.autocomplete')
    def test_autocomplete_short_query_returns_empty_without_provider_call(self, autocomplete):
        response = self.client.get('/api/geocode/autocomplete/', {'q': 'NY'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'suggestions': []})
        autocomplete.assert_not_called()

    @patch('apps.routing.planning.build_plan')
    def test_plan_endpoint_passes_validated_request_and_returns_actual_plan(self, build_plan):
        expected = {
            'origin': {'label': 'New York', 'latitude': 40.7, 'longitude': -74.0},
            'pickup': {'label': 'Cleveland', 'latitude': 41.5, 'longitude': -81.7},
            'destination': {'label': 'Chicago', 'latitude': 41.9, 'longitude': -87.6},
            'departure_time': '2026-11-03T14:00:00+00:00',
            'routes': [], 'recommended_route_id': None, 'route_summaries': [],
        }
        build_plan.return_value = expected
        response = self.client.post('/api/plan/', VALID_REQUEST, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), expected)
        build_plan.assert_called_once()
        validated = build_plan.call_args.args[0]
        self.assertEqual(validated['load_weight_tons'], 20.0)
        self.assertEqual(validated['checkpoint_interval_miles'], 25)
        self.assertEqual(validated['departure_time'].astimezone(timezone.utc).hour, 14)

    @patch('apps.routing.planning.build_plan')
    def test_plan_endpoint_does_not_call_providers_for_invalid_request(self, build_plan):
        response = self.client.post('/api/plan/', {**VALID_REQUEST, 'checkpoint_interval_miles': 15}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('details', response.json())
        build_plan.assert_not_called()

    @patch('apps.routing.planning.build_plan', side_effect=ServiceError('Weather provider timed out.', status_code=504, code='weather_timeout'))
    def test_plan_endpoint_returns_normalized_provider_failure(self, build_plan):
        response = self.client.post('/api/plan/', VALID_REQUEST, format='json')
        self.assertEqual(response.status_code, 504)
        self.assertEqual(response.json(), {'error': 'Weather provider timed out.', 'code': 'weather_timeout'})
        build_plan.assert_called_once()

    @override_settings(CORS_ALLOWED_ORIGINS=['http://localhost:5173', 'http://127.0.0.1:5173'])
    def test_cors_preflight_allows_each_vite_development_hostname(self):
        for origin in ('http://localhost:5173', 'http://127.0.0.1:5173'):
            with self.subTest(origin=origin):
                response = self.client.options('/api/health/', HTTP_ORIGIN=origin, HTTP_ACCESS_CONTROL_REQUEST_METHOD='GET')
                self.assertEqual(response['Access-Control-Allow-Origin'], origin)


class CentralExceptionHandlerTests(SimpleTestCase):
    factory = APIRequestFactory()

    def test_service_error_has_stable_error_code_and_status(self):
        response = api_exception_handler(
            ServiceError('Provider unavailable', status_code=503, code='provider_down'),
            {'request': self.factory.get('/api/plan/')},
        )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data, {'error': 'Provider unavailable', 'code': 'provider_down'})

    def test_validation_error_details_are_preserved(self):
        error = ValidationError({'load_weight_tons': ['Must be non-negative.']})
        response = api_exception_handler(error, {'request': self.factory.post('/api/plan/')})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['error'], 'Request validation failed')
        self.assertEqual(response.data['details'], {'load_weight_tons': ['Must be non-negative.']})

    def test_non_field_validation_error_is_returned_as_plain_message(self):
        error = ValidationError('Enter at least 3 characters.')
        response = api_exception_handler(error, {'request': self.factory.get('/api/geocode/')})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['error'], 'Enter at least 3 characters.')

    def test_unhandled_errors_return_json_500(self):
        response = api_exception_handler(RuntimeError('internal detail'), {'request': self.factory.get('/api/plan/')})
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.data, {'error': 'Internal server error', 'code': 'internal_error'})
