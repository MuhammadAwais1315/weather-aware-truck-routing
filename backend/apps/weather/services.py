"""Open-Meteo hourly weather client with UTC matching, explicit conversions, and cache."""

import math
import threading
import time
from collections import OrderedDict
from datetime import datetime, timezone

import requests

from services.exceptions import ServiceError
from services.http import SESSION

OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'
KMH_TO_MPH = 0.621371192237334
MM_TO_INCHES = 1 / 25.4
CM_TO_INCHES = 1 / 2.54
MAX_HOURLY_MATCH_MINUTES = 30


class OpenMeteoWeatherService:
    """Fetch and cache hourly forecasts; null or unavailable data remain null."""

    HOURLY_VARIABLES = 'wind_speed_10m,wind_gusts_10m,precipitation,rain,snowfall,visibility,weather_code'

    def __init__(self, session=None, base_url=OPEN_METEO_URL, cache_ttl_seconds=900,
                 max_cache_entries=256, clock=time.monotonic):
        self.session = session or SESSION
        self.base_url = base_url
        self.cache_ttl_seconds = cache_ttl_seconds
        self.max_cache_entries = max_cache_entries
        self.clock = clock
        self._cache = OrderedDict()
        self._cache_lock = threading.Lock()

    @staticmethod
    def _to_utc(value):
        if not isinstance(value, datetime):
            raise ValueError('Checkpoint arrival time must be a datetime.')
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError('Checkpoint arrival time must include a timezone.')
        return value.astimezone(timezone.utc)

    @staticmethod
    def _timestamp_utc(value):
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return datetime.fromtimestamp(value, tz=timezone.utc)
        if isinstance(value, str):
            timestamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
            if timestamp.tzinfo is None or timestamp.utcoffset() is None:
                # The request explicitly asks Open-Meteo for UTC timestamps.
                timestamp = timestamp.replace(tzinfo=timezone.utc)
            return timestamp.astimezone(timezone.utc)
        raise ValueError('Unsupported Open-Meteo timestamp format.')

    @staticmethod
    def _convert(value, factor):
        if value is None:
            return None
        try:
            numeric_value = float(value)
        except (TypeError, ValueError):
            return None
        if not math.isfinite(numeric_value):
            return None
        return numeric_value * factor

    def _fetch_hourly(self, latitude, longitude):
        cache_key = (round(float(latitude), 4), round(float(longitude), 4))
        now = self.clock()
        with self._cache_lock:
            cached = self._cache.get(cache_key)
            if cached and now - cached[0] < self.cache_ttl_seconds:
                self._cache.move_to_end(cache_key)
                return cached[1]
        params = {
            'latitude': latitude,
            'longitude': longitude,
            'hourly': self.HOURLY_VARIABLES,
            'wind_speed_unit': 'kmh',
            'precipitation_unit': 'mm',
            'timezone': 'UTC',
            'timeformat': 'unixtime',
            'forecast_days': 7,
        }
        try:
            response = self.session.get(self.base_url, params=params, timeout=15)
            response.raise_for_status()
            data = response.json()
        except requests.Timeout as exc:
            raise ServiceError('Open-Meteo forecast request timed out.', status_code=504, code='weather_timeout') from exc
        except requests.HTTPError as exc:
            raise ServiceError('Open-Meteo returned an HTTP error.', status_code=502, code='weather_provider_error') from exc
        except (requests.RequestException, ValueError) as exc:
            raise ServiceError(f'Open-Meteo forecast request failed: {exc}', status_code=502, code='weather_provider_error') from exc
        if not isinstance(data, dict):
            raise ServiceError('Open-Meteo returned an invalid response.', status_code=502, code='weather_invalid_response')
        with self._cache_lock:
            self._cache[cache_key] = (self.clock(), data)
            self._cache.move_to_end(cache_key)
            while len(self._cache) > self.max_cache_entries:
                self._cache.popitem(last=False)
        return data

    def get_weather(self, latitude, longitude, estimated_arrival):
        arrival_utc = self._to_utc(estimated_arrival)
        try:
            latitude, longitude = float(latitude), float(longitude)
        except (TypeError, ValueError) as exc:
            raise ValueError('Checkpoint latitude and longitude must be numeric.') from exc
        if not math.isfinite(latitude) or not -90 <= latitude <= 90:
            raise ValueError('Checkpoint latitude is outside valid bounds.')
        if not math.isfinite(longitude) or not -180 <= longitude <= 180:
            raise ValueError('Checkpoint longitude is outside valid bounds.')

        response = self._fetch_hourly(latitude, longitude)
        hourly = response.get('hourly') or {}
        if not isinstance(hourly, dict):
            return self._unavailable(arrival_utc, 'forecast_hours_missing')
        times = hourly.get('time') or []
        if not times:
            return self._unavailable(arrival_utc, 'forecast_hours_missing')

        try:
            parsed_times = [self._timestamp_utc(value) for value in times]
        except (TypeError, ValueError, OverflowError, OSError):
            return self._unavailable(arrival_utc, 'forecast_timestamps_invalid')
        index = min(range(len(parsed_times)), key=lambda item: (abs((parsed_times[item] - arrival_utc).total_seconds()), parsed_times[item]))
        matched_time = parsed_times[index]
        difference_minutes = abs((matched_time - arrival_utc).total_seconds()) / 60
        if difference_minutes > MAX_HOURLY_MATCH_MINUTES:
            return self._unavailable(arrival_utc, 'forecast_hour_unavailable')

        def value(name):
            values = hourly.get(name)
            if not isinstance(values, list) or index >= len(values):
                return None
            return values[index]

        wind_mph = self._convert(value('wind_speed_10m'), KMH_TO_MPH)
        gusts_mph = self._convert(value('wind_gusts_10m'), KMH_TO_MPH)
        precipitation_inches = self._convert(value('precipitation'), MM_TO_INCHES)
        rain_inches = self._convert(value('rain'), MM_TO_INCHES)
        snowfall_inches = self._convert(value('snowfall'), CM_TO_INCHES)
        visibility = value('visibility')
        weather_code = value('weather_code')
        has_weather_value = any(item is not None for item in (
            wind_mph, gusts_mph, precipitation_inches, rain_inches, snowfall_inches, visibility, weather_code,
        ))
        return {
            'available': has_weather_value,
            'unavailable_reason': None if has_weather_value else 'forecast_values_missing',
            'requested_arrival_time': arrival_utc.isoformat(),
            'forecast_time': matched_time.isoformat(),
            'forecast_time_difference_minutes': round(difference_minutes, 2),
            'wind_speed_mph': wind_mph,
            'wind_gusts_mph': gusts_mph,
            'precipitation_inches_per_hour': precipitation_inches,
            'rain_inches_per_hour': rain_inches,
            'snowfall_inches_per_hour': snowfall_inches,
            'visibility_m': visibility,
            'weather_code': weather_code,
            'units': {
                'wind_speed': 'mph',
                'precipitation': 'inches/hour (preceding hourly total)',
                'rain': 'inches/hour (preceding hourly total)',
                'snowfall': 'inches/hour (preceding hourly total)',
            },
        }

    @staticmethod
    def _unavailable(arrival_utc, reason):
        return {
            'available': False,
            'unavailable_reason': reason,
            'requested_arrival_time': arrival_utc.isoformat(),
            'forecast_time': None,
            'forecast_time_difference_minutes': None,
            'wind_speed_mph': None,
            'wind_gusts_mph': None,
            'precipitation_inches_per_hour': None,
            'rain_inches_per_hour': None,
            'snowfall_inches_per_hour': None,
            'visibility_m': None,
            'weather_code': None,
            'units': {
                'wind_speed': 'mph',
                'precipitation': 'inches/hour (preceding hourly total)',
                'rain': 'inches/hour (preceding hourly total)',
                'snowfall': 'inches/hour (preceding hourly total)',
            },
        }


open_meteo_service = OpenMeteoWeatherService()


def get_weather(lat, lon, arrival):
    return open_meteo_service.get_weather(lat, lon, arrival)
