from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

import requests
from django.test import SimpleTestCase

from apps.weather.services import OpenMeteoWeatherService
from services.exceptions import ServiceError


class OpenMeteoWeatherServiceTests(SimpleTestCase):
    @staticmethod
    def response_for(hourly, status_code=200):
        response = Mock()
        response.status_code = status_code
        response.json.return_value = {'hourly': hourly}
        if status_code >= 400:
            response.raise_for_status.side_effect = requests.HTTPError(response=response)
        else:
            response.raise_for_status.return_value = None
        return response

    @staticmethod
    def epoch(hour, minute=0):
        return int(datetime(2026, 1, 1, hour, minute, tzinfo=timezone.utc).timestamp())

    @classmethod
    def populated_hourly(cls):
        return {
            'time': [cls.epoch(8), cls.epoch(9), cls.epoch(10)],
            'wind_speed_10m': [16.09344, 32.18688, 48.28032],
            'wind_gusts_10m': [24.14016, 40.2336, 56.32704],
            'precipitation': [25.4, 12.7, 0],
            'rain': [12.7, 6.35, 0],
            'snowfall': [2.54, 1.27, 0],
            'visibility': [10000, 9000, 8000],
            'weather_code': [0, 61, 71],
        }

    def make_service(self, hourly=None, status_code=200):
        session = Mock()
        session.get.return_value = self.response_for(hourly or self.populated_hourly(), status_code)
        return OpenMeteoWeatherService(session=session), session

    def test_unit_conversions_match_documented_source_units(self):
        service, _ = self.make_service()
        arrival = datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc)

        weather = service.get_weather(40.7, -74.0, arrival)

        self.assertAlmostEqual(weather['wind_speed_mph'], 10.0, places=6)
        self.assertAlmostEqual(weather['precipitation_inches_per_hour'], 1.0, places=6)
        self.assertAlmostEqual(weather['rain_inches_per_hour'], 0.5, places=6)
        self.assertAlmostEqual(weather['snowfall_inches_per_hour'], 1.0, places=6)
        self.assertEqual(weather['units']['wind_speed'], 'mph')

    def test_request_uses_explicit_units_and_utc_timestamps(self):
        service, session = self.make_service()
        service.get_weather(40.7, -74.0, datetime(2026, 1, 1, 8, tzinfo=timezone.utc))
        params = session.get.call_args.kwargs['params']

        self.assertEqual(params['hourly'], service.HOURLY_VARIABLES)
        self.assertEqual(params['wind_speed_unit'], 'kmh')
        self.assertEqual(params['precipitation_unit'], 'mm')
        self.assertEqual(params['timezone'], 'UTC')
        self.assertEqual(params['timeformat'], 'unixtime')

    def test_arrival_timezone_is_converted_to_utc_before_hour_matching(self):
        service, _ = self.make_service()
        local_arrival = datetime(2026, 1, 1, 13, 20, tzinfo=timezone(timedelta(hours=5)))

        weather = service.get_weather(40.7, -74.0, local_arrival)

        self.assertEqual(weather['forecast_time'], '2026-01-01T08:00:00+00:00')
        self.assertEqual(weather['requested_arrival_time'], '2026-01-01T08:20:00+00:00')
        self.assertEqual(weather['forecast_time_difference_minutes'], 20)
        self.assertAlmostEqual(weather['wind_speed_mph'], 10.0, places=6)

    def test_nearest_hour_is_selected_and_half_hour_ties_choose_earlier(self):
        service, _ = self.make_service()
        arrival = datetime(2026, 1, 1, 8, 30, tzinfo=timezone.utc)

        weather = service.get_weather(40.7, -74.0, arrival)

        self.assertEqual(weather['forecast_time'], '2026-01-01T08:00:00+00:00')

    def test_missing_forecast_hours_remain_unavailable_and_null(self):
        service, _ = self.make_service({'time': []})

        weather = service.get_weather(40.7, -74.0, datetime(2026, 1, 1, 8, tzinfo=timezone.utc))

        self.assertFalse(weather['available'])
        self.assertEqual(weather['unavailable_reason'], 'forecast_hours_missing')
        self.assertIsNone(weather['wind_speed_mph'])
        self.assertIsNone(weather['rain_inches_per_hour'])

    def test_requested_hour_outside_available_forecast_is_not_substituted(self):
        service, _ = self.make_service()

        weather = service.get_weather(40.7, -74.0, datetime(2026, 1, 1, 16, tzinfo=timezone.utc))

        self.assertFalse(weather['available'])
        self.assertEqual(weather['unavailable_reason'], 'forecast_hour_unavailable')
        self.assertIsNone(weather['forecast_time'])
        self.assertIsNone(weather['precipitation_inches_per_hour'])

    def test_null_weather_values_are_not_converted_to_zero(self):
        hourly = {
            'time': [self.epoch(8)],
            'wind_speed_10m': [None], 'wind_gusts_10m': [None],
            'precipitation': [None], 'rain': [None], 'snowfall': [None],
            'visibility': [None], 'weather_code': [None],
        }
        service, _ = self.make_service(hourly)

        weather = service.get_weather(40.7, -74.0, datetime(2026, 1, 1, 8, tzinfo=timezone.utc))

        self.assertFalse(weather['available'])
        for key in ('wind_speed_mph', 'precipitation_inches_per_hour', 'rain_inches_per_hour', 'snowfall_inches_per_hour'):
            self.assertIsNone(weather[key])

    def test_missing_variable_array_stays_null_while_available_values_survive(self):
        hourly = self.populated_hourly()
        hourly['rain'] = [None, None, None]
        service, _ = self.make_service(hourly)

        weather = service.get_weather(40.7, -74.0, datetime(2026, 1, 1, 8, tzinfo=timezone.utc))

        self.assertTrue(weather['available'])
        self.assertIsNone(weather['rain_inches_per_hour'])
        self.assertAlmostEqual(weather['wind_speed_mph'], 10.0, places=6)

    def test_repeated_location_requests_use_cached_hourly_payload(self):
        service, session = self.make_service()

        first = service.get_weather(40.70001, -74.00001, datetime(2026, 1, 1, 8, tzinfo=timezone.utc))
        second = service.get_weather(40.70002, -74.00002, datetime(2026, 1, 1, 9, tzinfo=timezone.utc))

        self.assertEqual(session.get.call_count, 1)
        self.assertAlmostEqual(first['wind_speed_mph'], 10.0, places=6)
        self.assertAlmostEqual(second['wind_speed_mph'], 20.0, places=6)

    def test_api_http_failure_is_reported(self):
        service, _ = self.make_service({'error': True}, status_code=503)

        with self.assertRaises(ServiceError) as error:
            service.get_weather(40.7, -74.0, datetime(2026, 1, 1, 8, tzinfo=timezone.utc))

        self.assertEqual(error.exception.status_code, 502)

    def test_api_timeout_is_reported(self):
        session = Mock()
        session.get.side_effect = requests.Timeout('timed out')
        service = OpenMeteoWeatherService(session=session)

        with self.assertRaises(ServiceError) as error:
            service.get_weather(40.7, -74.0, datetime(2026, 1, 1, 8, tzinfo=timezone.utc))

        self.assertEqual(error.exception.status_code, 504)
        self.assertEqual(error.exception.default_code, 'weather_timeout')

    def test_naive_checkpoint_datetime_is_rejected(self):
        service, _ = self.make_service()
        with self.assertRaises(ValueError):
            service.get_weather(40.7, -74.0, datetime(2026, 1, 1, 8))

    def test_invalid_location_coordinates_are_rejected_before_network(self):
        service, session = self.make_service()
        with self.assertRaises(ValueError):
            service.get_weather(91, -74, datetime(2026, 1, 1, 8, tzinfo=timezone.utc))
        session.get.assert_not_called()

    def test_malformed_provider_payload_is_a_service_error(self):
        session = Mock()
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = ['not', 'an', 'object']
        session.get.return_value = response
        service = OpenMeteoWeatherService(session=session)
        with self.assertRaises(ServiceError) as error:
            service.get_weather(40.7, -74, datetime(2026, 1, 1, 8, tzinfo=timezone.utc))
        self.assertEqual(error.exception.default_code, 'weather_invalid_response')

    def test_network_failure_is_reported(self):
        session = Mock()
        session.get.side_effect = requests.ConnectionError('offline')
        service = OpenMeteoWeatherService(session=session)
        with self.assertRaises(ServiceError) as error:
            service.get_weather(40.7, -74, datetime(2026, 1, 1, 8, tzinfo=timezone.utc))
        self.assertEqual(error.exception.status_code, 502)

    def test_cache_expires_after_ttl(self):
        clock = [0.0]
        session = Mock()
        session.get.return_value = self.response_for(self.populated_hourly())
        service = OpenMeteoWeatherService(session=session, cache_ttl_seconds=10, clock=lambda: clock[0])
        arrival = datetime(2026, 1, 1, 8, tzinfo=timezone.utc)
        service.get_weather(40.7, -74.0, arrival)
        clock[0] = 11
        service.get_weather(40.7, -74.0, arrival)
        self.assertEqual(session.get.call_count, 2)

    def test_multi_location_prefetch_batches_unique_coordinates_and_warms_hour_cache(self):
        session = Mock()
        hourly = self.populated_hourly()
        response_one = Mock()
        response_one.raise_for_status.return_value = None
        response_one.json.return_value = [{'hourly': hourly} for _ in range(100)]
        response_two = Mock()
        response_two.raise_for_status.return_value = None
        response_two.json.return_value = {'hourly': hourly}
        session.get.side_effect = [response_one, response_two]
        service = OpenMeteoWeatherService(session=session)
        coords = [(35 + index / 100, -100 - index / 100) for index in range(101)]
        coords.append(coords[0])

        service.prefetch_hourly(coords)
        weather = service.get_weather(*coords[0], datetime(2026, 1, 1, 8, tzinfo=timezone.utc))

        self.assertEqual(session.get.call_count, 2)
        first_params = session.get.call_args_list[0].kwargs['params']
        self.assertEqual(len(first_params['latitude'].split(',')), 100)
        self.assertEqual(len(first_params['longitude'].split(',')), 100)
        second_params = session.get.call_args_list[1].kwargs['params']
        self.assertEqual(len(second_params['latitude'].split(',')), 1)
        self.assertAlmostEqual(weather['wind_speed_mph'], 10.0, places=6)

    def test_multi_location_prefetch_rejects_malformed_batch_response(self):
        session = Mock()
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = [{'hourly': self.populated_hourly()}]
        session.get.return_value = response
        service = OpenMeteoWeatherService(session=session)

        with self.assertRaises(ServiceError) as error:
            service.prefetch_hourly([(40.7, -74), (41.0, -73)])

        self.assertEqual(error.exception.default_code, 'weather_invalid_response')

    def test_empty_prefetch_does_not_call_provider(self):
        service, session = self.make_service()
        service.prefetch_hourly([])
        session.get.assert_not_called()
