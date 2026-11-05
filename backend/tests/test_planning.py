from datetime import datetime, timezone
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.routing.planning import build_plan
from services.exceptions import ServiceError


class PlanPipelineTests(SimpleTestCase):
    def test_distinct_location_texts_that_geocode_to_same_coordinates_are_rejected(self):
        place = {'label': 'Same place', 'latitude': 40.0, 'longitude': -75.0}
        with patch('apps.routing.planning.geocode_place', side_effect=[place, place, {'label': 'Destination', 'latitude': 41, 'longitude': -74}]), \
                patch('apps.routing.planning.openrouteservice_client.get_routes') as route_call:
            with self.assertRaises(ServiceError) as error:
                build_plan({
                    'origin': 'Office', 'pickup': 'Nearby office', 'destination': 'Destination',
                    'departure_time': datetime(2026, 11, 3, 14, tzinfo=timezone.utc),
                    'load_weight_tons': 20, 'checkpoint_interval_miles': 25,
                })
        self.assertEqual(error.exception.status_code, 400)
        self.assertEqual(error.exception.default_code, 'duplicate_locations')
        route_call.assert_not_called()

    def test_geocode_route_checkpoint_weather_risk_and_recommendation_pipeline(self):
        origin = {'label': 'Origin', 'latitude': 40.0, 'longitude': -75.0}
        pickup = {'label': 'Pickup', 'latitude': 40.4, 'longitude': -74.6}
        destination = {'label': 'Destination', 'latitude': 41.0, 'longitude': -74.0}
        geometry = {'type': 'LineString', 'coordinates': [[-75.0, 40.0], [-74.5, 40.5], [-74.0, 41.0]]}
        routes = [
            {
                'id': 'route-1', 'name': 'Route 1', 'geometry': geometry,
                'distance_meters': 160934.4, 'duration_seconds': 7200,
                'segment_durations_seconds': [3600, 3600],
                'provider_legs': [
                    {'distance_miles': 40, 'duration_seconds': 3000, 'waypoint_coordinate': [-74.6, 40.4]},
                    {'distance_miles': 60, 'duration_seconds': 4200},
                ], 'waypoint_distances_miles': [40],
            },
            {
                'id': 'route-2', 'name': 'Route 2', 'geometry': geometry,
                'distance_meters': 160934.4, 'duration_seconds': 9000,
                'segment_durations_seconds': [4500, 4500],
                'provider_legs': [
                    {'distance_miles': 40, 'duration_seconds': 3800, 'waypoint_coordinate': [-74.6, 40.4]},
                    {'distance_miles': 60, 'duration_seconds': 5200},
                ], 'waypoint_distances_miles': [40],
            },
        ]
        requested_weather = []

        def weather_for(latitude, longitude, arrival):
            requested_weather.append((latitude, longitude, arrival))
            return {
                'available': True,
                'forecast_time': arrival.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0).isoformat(),
                'wind_speed_mph': 20.0,
                'rain_inches_per_hour': 0.0,
                'snowfall_inches_per_hour': 0.0,
            }

        payload = {
            'origin': 'Origin', 'pickup': 'Pickup', 'destination': 'Destination',
            'departure_time': datetime(2026, 11, 3, 14, tzinfo=timezone.utc),
            'load_weight_tons': 20.0, 'checkpoint_interval_miles': 50,
        }
        with patch('apps.routing.planning.geocode_place', side_effect=[origin, pickup, destination]) as geocode, \
                patch('apps.routing.planning.openrouteservice_client.get_routes', return_value=routes) as route_call, \
                patch('apps.routing.planning.get_weather', side_effect=weather_for) as weather_call:
            plan = build_plan(payload)

        self.assertEqual(geocode.call_count, 3)
        route_call.assert_called_once_with(origin, destination, via_points=[pickup])
        self.assertEqual(weather_call.call_count, 8)  # Four checkpoints per route, including the pickup.
        self.assertEqual(len(plan['routes']), 2)
        self.assertEqual([len(route['checkpoints']) for route in plan['routes']], [4, 4])
        self.assertEqual(plan['recommended_route_id'], 'route-1')
        self.assertEqual(plan['routes'][0]['checkpoints'][0]['coordinates'], [-75.0, 40.0])
        pickup_checkpoint = next(point for point in plan['routes'][0]['checkpoints'] if point['checkpoint_type'] == 'pickup')
        self.assertEqual(pickup_checkpoint['distance_from_origin_miles'], 40)
        self.assertEqual(pickup_checkpoint['coordinates'], [-74.6, 40.4])
        self.assertEqual(plan['pickup'], pickup)
        self.assertEqual(plan['routes'][0]['legs'][0]['to'], pickup)
        self.assertAlmostEqual(requested_weather[0][0], 40.0)
        self.assertAlmostEqual(requested_weather[0][1], -75.0)
        self.assertTrue(all(item[2].tzinfo is not None for item in requested_weather))
        self.assertEqual(plan['route_summaries'][0]['total_distance_miles'], 100.0)
        self.assertTrue(plan['routes'][0]['checkpoints'][0]['risk']['risk_label'] == 'Low')

    def test_empty_provider_route_list_returns_no_safe_route_without_fabrication(self):
        with patch('apps.routing.planning.geocode_place', side_effect=[
            {'label': 'A', 'latitude': 0, 'longitude': 0},
            {'label': 'P', 'latitude': 0.5, 'longitude': 0.5},
            {'label': 'B', 'latitude': 1, 'longitude': 1},
        ]), patch('apps.routing.planning.openrouteservice_client.get_routes', return_value=[]):
            plan = build_plan({
                'origin': 'A', 'pickup': 'P', 'destination': 'B',
                'departure_time': datetime(2026, 11, 3, 14, tzinfo=timezone.utc),
                'load_weight_tons': 1, 'checkpoint_interval_miles': 25,
            })
        self.assertEqual(plan['routes'], [])
        self.assertIsNone(plan['recommended_route_id'])
        self.assertIn('No safe route available', plan['ranking_explanation'])

    def test_provider_alternative_limit_is_disclosed_in_routing_notice(self):
        route = {
            'id': 'route-1', 'name': 'Route 1',
            'geometry': {'type': 'LineString', 'coordinates': [[-75, 40], [-74, 41]]},
            'distance_meters': 160934.4, 'duration_seconds': 7200,
            'provider_legs': [
                {'distance_miles': 40, 'duration_seconds': 3600, 'waypoint_coordinate': [-74.5, 40.5]},
                {'distance_miles': 60, 'duration_seconds': 3600},
            ], 'waypoint_distances_miles': [40],
            'alternatives_note': 'OpenRouteService limits alternatives to under 100 km. One actual route was returned.',
        }
        with patch('apps.routing.planning.geocode_place', side_effect=[
            {'label': 'A', 'latitude': 40, 'longitude': -75},
            {'label': 'P', 'latitude': 40.5, 'longitude': -74.5},
            {'label': 'B', 'latitude': 41, 'longitude': -74},
        ]), patch('apps.routing.planning.openrouteservice_client.get_routes', return_value=[route]), \
                patch('apps.routing.planning.get_weather', return_value={
                    'available': True, 'wind_speed_mph': 10,
                    'rain_inches_per_hour': 0, 'snowfall_inches_per_hour': 0,
                }):
            plan = build_plan({
                'origin': 'A', 'pickup': 'P', 'destination': 'B',
                'departure_time': datetime(2026, 11, 3, 14, tzinfo=timezone.utc),
                'load_weight_tons': 1, 'checkpoint_interval_miles': 50,
            })

        self.assertEqual(len(plan['routes']), 1)
        self.assertIn('One actual route was returned', plan['routing_notice'])
