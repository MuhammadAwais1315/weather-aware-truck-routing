from datetime import datetime, timezone
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.routing.planning import build_plan


class PlanPipelineTests(SimpleTestCase):
    def test_geocode_route_checkpoint_weather_risk_and_recommendation_pipeline(self):
        origin = {'label': 'Origin', 'latitude': 40.0, 'longitude': -75.0}
        destination = {'label': 'Destination', 'latitude': 41.0, 'longitude': -74.0}
        geometry = {'type': 'LineString', 'coordinates': [[-75.0, 40.0], [-74.5, 40.5], [-74.0, 41.0]]}
        routes = [
            {
                'id': 'route-1', 'name': 'Route 1', 'geometry': geometry,
                'distance_meters': 160934.4, 'duration_seconds': 7200,
                'segment_durations_seconds': [3600, 3600],
            },
            {
                'id': 'route-2', 'name': 'Route 2', 'geometry': geometry,
                'distance_meters': 160934.4, 'duration_seconds': 9000,
                'segment_durations_seconds': [4500, 4500],
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
            'origin': 'Origin', 'destination': 'Destination',
            'departure_time': datetime(2026, 11, 3, 14, tzinfo=timezone.utc),
            'load_weight_tons': 20.0, 'checkpoint_interval_miles': 50,
        }
        with patch('apps.routing.planning.geocode_place', side_effect=[origin, destination]) as geocode, \
                patch('apps.routing.planning.openrouteservice_client.get_routes', return_value=routes) as route_call, \
                patch('apps.routing.planning.get_weather', side_effect=weather_for) as weather_call:
            plan = build_plan(payload)

        self.assertEqual(geocode.call_count, 2)
        route_call.assert_called_once_with(origin, destination)
        self.assertEqual(weather_call.call_count, 6)  # Three real checkpoints for each of two routes.
        self.assertEqual(len(plan['routes']), 2)
        self.assertEqual([len(route['checkpoints']) for route in plan['routes']], [3, 3])
        self.assertEqual(plan['recommended_route_id'], 'route-1')
        self.assertEqual(plan['routes'][0]['checkpoints'][0]['coordinates'], [-75.0, 40.0])
        self.assertAlmostEqual(requested_weather[0][0], 40.0)
        self.assertAlmostEqual(requested_weather[0][1], -75.0)
        self.assertTrue(all(item[2].tzinfo is not None for item in requested_weather))
        self.assertEqual(plan['route_summaries'][0]['total_distance_miles'], 100.0)
        self.assertTrue(plan['routes'][0]['checkpoints'][0]['risk']['risk_label'] == 'Low')

    def test_empty_provider_route_list_returns_no_safe_route_without_fabrication(self):
        with patch('apps.routing.planning.geocode_place', side_effect=[
            {'label': 'A', 'latitude': 0, 'longitude': 0},
            {'label': 'B', 'latitude': 1, 'longitude': 1},
        ]), patch('apps.routing.planning.openrouteservice_client.get_routes', return_value=[]):
            plan = build_plan({
                'origin': 'A', 'destination': 'B',
                'departure_time': datetime(2026, 11, 3, 14, tzinfo=timezone.utc),
                'load_weight_tons': 1, 'checkpoint_interval_miles': 25,
            })
        self.assertEqual(plan['routes'], [])
        self.assertIsNone(plan['recommended_route_id'])
        self.assertIn('No safe route available', plan['ranking_explanation'])
