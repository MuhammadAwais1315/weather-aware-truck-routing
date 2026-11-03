from unittest.mock import Mock

import requests
from django.test import SimpleTestCase

from apps.geocoding.services import NominatimGeocoder
from services.exceptions import ServiceError
from services.route_provider import OpenRouteServiceClient


def mocked_response(payload, status_code=200):
    response = Mock()
    response.status_code = status_code
    response.text = 'provider error'
    response.json.return_value = payload
    if status_code >= 400:
        response.raise_for_status.side_effect = requests.HTTPError(response=response)
    else:
        response.raise_for_status.return_value = None
    return response


class NominatimGeocoderTests(SimpleTestCase):
    def test_valid_address_returns_coordinates(self):
        session = Mock()
        session.get.return_value = mocked_response([{
            'display_name': 'New York, NY, USA', 'lat': '40.7128', 'lon': '-74.0060',
        }])
        geocoder = NominatimGeocoder(session=session, min_interval_seconds=0)

        result = geocoder.geocode('New York, NY')

        self.assertEqual(result, {'label': 'New York, NY, USA', 'latitude': 40.7128, 'longitude': -74.006})
        session.get.assert_called_once()

    def test_invalid_address_returns_not_found(self):
        session = Mock()
        session.get.return_value = mocked_response([])
        geocoder = NominatimGeocoder(session=session, min_interval_seconds=0)

        with self.assertRaises(ServiceError) as error:
            geocoder.geocode('No such place anywhere')

        self.assertEqual(error.exception.status_code, 404)

    def test_nominatim_api_failure_is_reported(self):
        session = Mock()
        session.get.return_value = mocked_response({}, status_code=503)
        geocoder = NominatimGeocoder(session=session, min_interval_seconds=0)

        with self.assertRaises(ServiceError):
            geocoder.geocode('New York, NY')

    def test_short_query_is_rejected_without_network_request(self):
        session = Mock()
        geocoder = NominatimGeocoder(session=session, min_interval_seconds=0)
        with self.assertRaises(ServiceError) as error:
            geocoder.geocode('NY')
        self.assertEqual(error.exception.status_code, 400)
        session.get.assert_not_called()

    def test_non_string_query_is_rejected(self):
        geocoder = NominatimGeocoder(session=Mock(), min_interval_seconds=0)
        with self.assertRaises(ServiceError):
            geocoder.geocode(None)

    def test_nominatim_timeout_maps_to_gateway_timeout(self):
        session = Mock()
        session.get.side_effect = requests.Timeout('timed out')
        geocoder = NominatimGeocoder(session=session, min_interval_seconds=0)
        with self.assertRaises(ServiceError) as error:
            geocoder.geocode('New York, NY')
        self.assertEqual(error.exception.status_code, 504)
        self.assertEqual(error.exception.default_code, 'geocoding_timeout')

    def test_nominatim_invalid_coordinates_are_rejected(self):
        session = Mock()
        session.get.return_value = mocked_response([{'display_name': 'Nowhere', 'lat': '95', 'lon': '0'}])
        geocoder = NominatimGeocoder(session=session, min_interval_seconds=0)
        with self.assertRaises(ServiceError):
            geocoder.geocode('Nowhere')

    def test_repeated_address_is_cached(self):
        session = Mock()
        session.get.return_value = mocked_response([{'display_name': 'New York', 'lat': '40.7', 'lon': '-74'}])
        geocoder = NominatimGeocoder(session=session, min_interval_seconds=0)
        self.assertEqual(geocoder.geocode('New York'), geocoder.geocode(' new york '))
        session.get.assert_called_once()


class OpenRouteServiceClientTests(SimpleTestCase):
    def setUp(self):
        self.origin = {'latitude': 40.7, 'longitude': -74.0}
        self.destination = {'latitude': 41.9, 'longitude': -87.6}

    @staticmethod
    def feature(index):
        return {
            'geometry': {'type': 'LineString', 'coordinates': [[-74.0, 40.7], [-73.5, 41.0], [-87.6, 41.9]]},
            'properties': {'summary': {'distance': 1_500_000 + index * 1000, 'duration': 50_000 + index * 100}},
        }

    def test_returns_exactly_one_two_or_three_provider_routes(self):
        for count in (1, 2, 3):
            with self.subTest(route_count=count):
                session = Mock()
                session.post.return_value = mocked_response({'features': [self.feature(i) for i in range(count)]})
                client = OpenRouteServiceClient(api_key='test-key', session=session)

                routes = client.get_routes(self.origin, self.destination)

                self.assertEqual(len(routes), count)
                self.assertEqual([route['id'] for route in routes], [f'route-{i}' for i in range(1, count + 1)])
                self.assertEqual(routes[0]['geometry']['type'], 'LineString')
                self.assertGreater(routes[0]['summary']['distance_miles'], 0)
                self.assertGreater(routes[0]['summary']['duration_hours'], 0)
                self.assertEqual(session.post.call_args.kwargs['json']['alternative_routes']['target_count'], 3)

    def test_provider_failure_is_reported(self):
        session = Mock()
        session.post.return_value = mocked_response({}, status_code=500)
        client = OpenRouteServiceClient(api_key='test-key', session=session)

        with self.assertRaises(ServiceError):
            client.get_routes(self.origin, self.destination)

    def test_directions_timeout_maps_to_gateway_timeout(self):
        session = Mock()
        session.post.side_effect = requests.Timeout('timed out')
        client = OpenRouteServiceClient(api_key='test-key', session=session)
        with self.assertRaises(ServiceError) as error:
            client.get_routes(self.origin, self.destination)
        self.assertEqual(error.exception.status_code, 504)
        self.assertEqual(error.exception.default_code, 'routing_timeout')

    def test_malformed_directions_response_is_a_service_error(self):
        session = Mock()
        session.post.return_value = mocked_response(['not', 'an', 'object'])
        client = OpenRouteServiceClient(api_key='test-key', session=session)
        with self.assertRaises(ServiceError) as error:
            client.get_routes(self.origin, self.destination)
        self.assertEqual(error.exception.default_code, 'routing_invalid_response')

    def test_non_finite_route_summary_is_rejected(self):
        feature = self.feature(0)
        feature['properties']['summary']['distance'] = float('nan')
        session = Mock()
        session.post.return_value = mocked_response({'features': [feature]})
        client = OpenRouteServiceClient(api_key='test-key', session=session)
        with self.assertRaises(ServiceError):
            client.get_routes(self.origin, self.destination)

    def test_invalid_input_coordinates_fail_before_provider_call(self):
        session = Mock()
        client = OpenRouteServiceClient(api_key='test-key', session=session)
        with self.assertRaises(ServiceError) as error:
            client.get_routes({'longitude': 181, 'latitude': 0}, self.destination)
        self.assertEqual(error.exception.status_code, 400)
        session.post.assert_not_called()

    def test_invalid_geometry_coordinate_range_is_rejected(self):
        with self.assertRaises(ServiceError):
            OpenRouteServiceClient.decode_geometry({'type': 'LineString', 'coordinates': [[0, 0], [181, 2]]})

    def test_openrouteservice_step_durations_are_mapped_to_geometry_edges(self):
        feature = self.feature(0)
        feature['properties']['segments'] = [{'steps': [{'way_points': [0, 2], 'duration': 1000}]}]
        session = Mock()
        session.post.return_value = mocked_response({'features': [feature]})
        client = OpenRouteServiceClient(api_key='test-key', session=session)

        route = client.get_routes(self.origin, self.destination)[0]

        self.assertEqual(len(route['segment_durations_seconds']), 2)
        self.assertAlmostEqual(sum(route['segment_durations_seconds']), 1000)

    def test_invalid_api_key_is_reported_clearly(self):
        session = Mock()
        session.post.return_value = mocked_response({'error': 'invalid key'}, status_code=401)
        client = OpenRouteServiceClient(api_key='bad-key', session=session)

        with self.assertRaises(ServiceError) as error:
            client.get_routes(self.origin, self.destination)

        self.assertEqual(error.exception.default_code, 'invalid_routing_api_key')
        self.assertEqual(error.exception.status_code, 502)

    def test_missing_api_key_fails_before_network_request(self):
        session = Mock()
        client = OpenRouteServiceClient(api_key='', session=session)

        with self.assertRaises(ServiceError):
            client.get_routes(self.origin, self.destination)

        session.post.assert_not_called()

    def test_encoded_polyline_geometry_is_decoded(self):
        geometry = OpenRouteServiceClient.decode_geometry('??_ibE_ibE')
        self.assertEqual(geometry['type'], 'LineString')
        self.assertEqual(geometry['coordinates'], [[0.0, 0.0], [1.0, 1.0]])

    def test_autocomplete_returns_provider_suggestions(self):
        session = Mock()
        session.get.return_value = mocked_response({'features': [{
            'geometry': {'coordinates': [-74.006, 40.7128]},
            'properties': {'label': 'New York, NY, USA'},
        }]})
        client = OpenRouteServiceClient(api_key='test-key', session=session)

        suggestions = client.autocomplete('New York')

        self.assertEqual(suggestions[0]['label'], 'New York, NY, USA')
        self.assertEqual(suggestions[0]['latitude'], 40.7128)

    def test_autocomplete_timeout_is_reported(self):
        session = Mock()
        session.get.side_effect = requests.Timeout('timed out')
        client = OpenRouteServiceClient(api_key='test-key', session=session)
        with self.assertRaises(ServiceError) as error:
            client.autocomplete('New York')
        self.assertEqual(error.exception.status_code, 504)
