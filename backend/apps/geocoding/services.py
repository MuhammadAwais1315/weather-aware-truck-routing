import os
import threading
import time

import math
import requests

from services.exceptions import ServiceError
from services.http import SESSION


class NominatimGeocoder:
    """Forward geocoder. Public Nominatim calls are serialized and throttled."""

    def __init__(self, base_url=None, session=None, min_interval_seconds=1.0):
        self.base_url = base_url or os.getenv('NOMINATIM_BASE_URL', 'https://nominatim.openstreetmap.org/search')
        self.session = session or SESSION
        self.min_interval_seconds = min_interval_seconds
        self._lock = threading.Lock()
        self._last_request_at = 0.0
        self._cache = {}
        self._reverse_cache = {}

    def geocode(self, query):
        if not isinstance(query, str):
            raise ServiceError('Enter a valid location query.', status_code=400, code='invalid_query')
        query = query.strip()
        if len(query) < 3:
            raise ServiceError('Enter at least 3 characters.', status_code=400, code='invalid_query')
        cache_key = query.casefold()
        with self._lock:
            if cache_key in self._cache:
                return dict(self._cache[cache_key])
            delay = self.min_interval_seconds - (time.monotonic() - self._last_request_at)
            if delay > 0:
                time.sleep(delay)
            try:
                response = self.session.get(
                    self.base_url,
                    params={'q': query, 'format': 'jsonv2', 'limit': 1, 'addressdetails': 1},
                    timeout=15,
                )
                response.raise_for_status()
                results = response.json()
            except requests.Timeout as exc:
                raise ServiceError(
                    'Nominatim geocoding request timed out.', status_code=504, code='geocoding_timeout'
                ) from exc
            except requests.HTTPError as exc:
                raise ServiceError(
                    'Nominatim returned an HTTP error.', status_code=502, code='geocoding_provider_error'
                ) from exc
            except (requests.RequestException, ValueError, TypeError) as exc:
                raise ServiceError(f'Nominatim geocoding failed: {exc}', code='geocoding_provider_error') from exc
            finally:
                self._last_request_at = time.monotonic()
        if not isinstance(results, list):
            raise ServiceError('Nominatim returned an invalid response.', status_code=502, code='geocoding_invalid_response')
        if not results:
            raise ServiceError(f'Could not find location: {query}', status_code=404, code='location_not_found')
        try:
            item = results[0]
            latitude, longitude = float(item['lat']), float(item['lon'])
            if not math.isfinite(latitude) or not -90 <= latitude <= 90:
                raise ValueError('Latitude outside valid bounds.')
            if not math.isfinite(longitude) or not -180 <= longitude <= 180:
                raise ValueError('Longitude outside valid bounds.')
            result = {
                'label': item['display_name'],
                'latitude': latitude,
                'longitude': longitude,
            }
        except (KeyError, TypeError, ValueError) as exc:
            raise ServiceError('Nominatim returned an invalid location result.') from exc
        self._cache[cache_key] = result
        return dict(result)

    def reverse(self, latitude, longitude):
        """Resolve a coordinate to its nearest named place, cached and throttled."""
        try:
            latitude, longitude = float(latitude), float(longitude)
        except (TypeError, ValueError) as exc:
            raise ServiceError('Enter valid checkpoint coordinates.', status_code=400, code='invalid_coordinates') from exc
        if not math.isfinite(latitude) or not -90 <= latitude <= 90 or not math.isfinite(longitude) or not -180 <= longitude <= 180:
            raise ServiceError('Enter valid checkpoint coordinates.', status_code=400, code='invalid_coordinates')
        cache_key = (round(latitude, 4), round(longitude, 4))
        with self._lock:
            if cache_key in self._reverse_cache:
                return dict(self._reverse_cache[cache_key])
            delay = self.min_interval_seconds - (time.monotonic() - self._last_request_at)
            if delay > 0:
                time.sleep(delay)
            try:
                reverse_url = self.base_url.rsplit('/', 1)[0] + '/reverse'
                response = self.session.get(
                    reverse_url,
                    params={'lat': latitude, 'lon': longitude, 'format': 'jsonv2', 'addressdetails': 1, 'zoom': 10},
                    timeout=15,
                )
                response.raise_for_status()
                result = response.json()
            except requests.Timeout as exc:
                raise ServiceError('Nominatim reverse lookup timed out.', status_code=504, code='geocoding_timeout') from exc
            except requests.HTTPError as exc:
                raise ServiceError('Nominatim reverse lookup failed.', status_code=502, code='geocoding_provider_error') from exc
            except (requests.RequestException, ValueError, TypeError) as exc:
                raise ServiceError(f'Nominatim reverse lookup failed: {exc}', code='geocoding_provider_error') from exc
            finally:
                self._last_request_at = time.monotonic()
        if not isinstance(result, dict) or not result:
            raise ServiceError('No named place was found near this checkpoint.', status_code=404, code='place_not_found')
        address = result.get('address') if isinstance(result.get('address'), dict) else {}
        place = next((address.get(key) for key in (
            'city', 'town', 'village', 'municipality', 'suburb', 'hamlet', 'county',
        ) if address.get(key)), None)
        region = address.get('state') or address.get('region')
        label = ', '.join(part for part in (place, region) if part) or result.get('name') or result.get('display_name')
        if not label:
            raise ServiceError('Nominatim did not return a place name for this checkpoint.', status_code=502, code='geocoding_invalid_response')
        resolved = {'label': label, 'display_name': result.get('display_name') or label}
        self._reverse_cache[cache_key] = resolved
        return dict(resolved)


nominatim_geocoder = NominatimGeocoder()


def geocode_place(query):
    return nominatim_geocoder.geocode(query)


def reverse_geocode(latitude, longitude):
    return nominatim_geocoder.reverse(latitude, longitude)
