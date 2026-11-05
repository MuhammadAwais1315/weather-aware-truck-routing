from unittest.mock import Mock, patch

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
        self.pickup = {'latitude': 41.5, 'longitude': -78.0}
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

    def test_via_pickup_routes_include_two_provider_leg_summaries(self):
        first = self.feature(0)
        first['geometry']['coordinates'] = [[-74.0, 40.7], [-77.0, 41.0], [-78.0, 41.5]]
        first['properties']['summary'] = {'distance': 600_000, 'duration': 20_000}
        second = self.feature(0)
        second['geometry']['coordinates'] = [[-78.0, 41.5], [-82.0, 41.7], [-87.6, 41.9]]
        second['properties']['summary'] = {'distance': 900_000, 'duration': 30_000}
        session = Mock()
        session.post.side_effect = [mocked_response({'features': [first]}), mocked_response({'features': [second]})]
        client = OpenRouteServiceClient(api_key='test-key', session=session)

        routes = client.get_routes(self.origin, self.destination, via_points=[self.pickup])

        first_request, second_request = [call.kwargs['json'] for call in session.post.call_args_list]
        self.assertEqual(first_request['coordinates'], [[-74.0, 40.7], [-78.0, 41.5]])
        self.assertEqual(second_request['coordinates'], [[-78.0, 41.5], [-87.6, 41.9]])
        self.assertEqual(len(routes[0]['provider_legs']), 2)
        self.assertAlmostEqual(routes[0]['waypoint_distances_miles'][0], 600_000 / 1609.344)
        self.assertEqual(routes[0]['duration_seconds'], 50_000)
        self.assertEqual(routes[0]['provider_legs'][0]['waypoint_coordinate'], [-78.0, 41.5])

    def test_pickup_routes_combine_actual_leg_alternatives_up_to_three(self):
        def leg_feature(start, midpoint, end, distance, duration):
            feature = self.feature(0)
            feature['geometry']['coordinates'] = [start, midpoint, end]
            feature['properties']['summary'] = {'distance': distance, 'duration': duration}
            return feature

        first_routes = [
            leg_feature([-74.0, 40.7], [-76.0, 41.0 + i * 0.01], [-78.0, 41.5], 500_000 + i * 1000, 20_000 + i * 100)
            for i in range(2)
        ]
        second_routes = [
            leg_feature([-78.0, 41.5], [-82.0, 41.6 + i * 0.01], [-87.6, 41.9], 800_000 + i * 1000, 30_000 + i * 100)
            for i in range(2)
        ]
        session = Mock()
        session.post.side_effect = [
            mocked_response({'features': first_routes}), mocked_response({'features': second_routes}),
        ]
        client = OpenRouteServiceClient(api_key='test-key', session=session)

        routes = client.get_routes(self.origin, self.destination, via_points=[self.pickup])

        self.assertEqual(len(routes), 3)
        self.assertEqual([route['id'] for route in routes], ['route-1', 'route-2', 'route-3'])
        self.assertEqual(len({tuple(map(tuple, route['geometry']['coordinates'])) for route in routes}), 3)
        self.assertTrue(all(len(route['provider_legs']) == 2 for route in routes))

    def test_pickup_routes_drop_near_identical_provider_combinations(self):
        def route(coordinates, distance, duration):
            return {
                'geometry': {'type': 'LineString', 'coordinates': coordinates},
                'distance_meters': distance, 'duration_seconds': duration,
                'distance_miles': distance / 1609.344, 'duration_hours': duration / 3600,
                'summary': {}, 'steps': [],
            }

        first = route([[-74.0, 40.7], [-76.0, 41.0], [-78.0, 41.5]], 500_000, 20_000)
        second_a = route([[-78.0, 41.5], [-82.0, 41.6], [-87.6, 41.9]], 800_000, 30_000)
        # Small provider shape jitter on the same corridor must not be presented
        # as a separate driver choice.
        second_b = route([[-78.0, 41.5], [-82.0, 41.60004], [-87.6, 41.9]], 805_000, 30_100)
        client = OpenRouteServiceClient(api_key='test-key', session=Mock())
        with patch.object(client, 'get_routes', side_effect=[[first], [second_a, second_b]]):
            routes = client._get_pickup_routes(self.origin, self.pickup, self.destination, 'driving-hgv')

        self.assertEqual(len(routes), 1)
        self.assertEqual(routes[0]['id'], 'route-1')
        self.assertIn('Near-identical route paths were omitted', routes[0]['alternatives_note'])

    def test_long_trip_alternative_limit_retries_for_one_actual_route(self):
        limit_response = mocked_response({
            'error': {
                'code': 2004,
                'message': 'The approximated route distance must not be greater than 100000.0 meters for use with the alternative Routes algorithm.',
            },
        }, status_code=400)
        session = Mock()
        session.post.side_effect = [limit_response, mocked_response({'features': [self.feature(0)]})]
        client = OpenRouteServiceClient(api_key='test-key', session=session)

        routes = client.get_routes(self.origin, self.destination)

        self.assertEqual(len(routes), 1)
        self.assertEqual(routes[0]['id'], 'route-1')
        self.assertIn('One actual route', routes[0]['alternatives_note'])
        self.assertIn('alternative_routes', session.post.call_args_list[0].kwargs['json'])
        self.assertNotIn('alternative_routes', session.post.call_args_list[1].kwargs['json'])
        self.assertEqual(session.post.call_count, 2)

    def test_other_directions_400_errors_do_not_retry_without_alternatives(self):
        session = Mock()
        session.post.return_value = mocked_response({'error': {'code': 2004, 'message': 'Different invalid request.'}}, status_code=400)
        client = OpenRouteServiceClient(api_key='test-key', session=session)

        with self.assertRaises(ServiceError):
            client.get_routes(self.origin, self.destination)

        session.post.assert_called_once()

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
