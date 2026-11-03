import os
import math

import requests

from apps.checkpoints.services import haversine
from .exceptions import ServiceError


class OpenRouteServiceClient:
    """Client for ORS Pelias autocomplete and directions services."""

    def __init__(self, api_key=None, session=None, base_url='https://api.openrouteservice.org'):
        self.api_key = (api_key if api_key is not None else os.getenv('OPENROUTESERVICE_API_KEY', '')).strip()
        self.session = session or requests.Session()
        self.base_url = base_url.rstrip('/')

    def _ensure_api_key(self):
        if not self.api_key:
            raise ServiceError('OPENROUTESERVICE_API_KEY is not configured.', status_code=503, code='routing_not_configured')

    def autocomplete(self, query, limit=5):
        self._ensure_api_key()
        query = query.strip()
        if len(query) < 3:
            return []
        try:
            response = self.session.get(
                f'{self.base_url}/geocode/autocomplete',
                params={'text': query, 'size': min(max(int(limit), 1), 10)},
                headers={'Authorization': self.api_key}, timeout=15,
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict) or not isinstance(payload.get('features', []), list):
                raise ServiceError('OpenRouteService returned an invalid autocomplete response.', status_code=502, code='routing_invalid_response')
            features = payload.get('features', [])
        except requests.HTTPError as exc:
            self._raise_provider_error(exc, 'OpenRouteService autocomplete failed')
        except requests.Timeout as exc:
            raise ServiceError('OpenRouteService autocomplete request timed out.', status_code=504, code='routing_timeout') from exc
        except ServiceError:
            raise
        except (requests.RequestException, ValueError, TypeError) as exc:
            raise ServiceError(f'OpenRouteService autocomplete failed: {exc}') from exc
        suggestions = []
        for feature in features[:limit]:
            if not isinstance(feature, dict):
                continue
            props = feature.get('properties', {})
            if not isinstance(props, dict):
                continue
            label = props.get('label') or props.get('name')
            geometry = feature.get('geometry')
            coords = geometry.get('coordinates') if isinstance(geometry, dict) else None
            if label and isinstance(coords, list) and len(coords) >= 2:
                try:
                    longitude, latitude = float(coords[0]), float(coords[1])
                except (TypeError, ValueError):
                    continue
                if math.isfinite(longitude) and math.isfinite(latitude) and -180 <= longitude <= 180 and -90 <= latitude <= 90:
                    suggestions.append({'label': label, 'longitude': longitude, 'latitude': latitude})
        return suggestions

    def get_routes(self, origin, destination, profile=None):
        self._ensure_api_key()
        self._validate_place(origin, 'origin')
        self._validate_place(destination, 'destination')
        profile = profile or os.getenv('OPENROUTESERVICE_PROFILE', 'driving-hgv').strip()
        url = f'{self.base_url}/v2/directions/{profile}/geojson'
        body = {
            'coordinates': [
                [float(origin['longitude']), float(origin['latitude'])],
                [float(destination['longitude']), float(destination['latitude'])],
            ],
            'alternative_routes': {'target_count': 3, 'weight_factor': 1.6, 'share_factor': 0.6},
            'instructions': True,
        }
        alternatives_limited_note = None
        try:
            response = self.session.post(url, json=body, headers={'Authorization': self.api_key}, timeout=45)
            try:
                response.raise_for_status()
            except requests.HTTPError as exc:
                if not self._is_alternative_distance_limit(exc):
                    self._raise_provider_error(exc, 'OpenRouteService routing failed')
                # ORS limits its alternative-route algorithm to trips under 100 km.
                # Retry without alternatives and return the one actual provider route.
                # This is deliberately not replaced with a synthetic route.
                body = dict(body)
                body.pop('alternative_routes', None)
                alternatives_limited_note = (
                    'OpenRouteService limits alternative-route calculations to trips under 100 km. '
                    'One actual route was returned for this longer journey.'
                )
                response = self.session.post(url, json=body, headers={'Authorization': self.api_key}, timeout=45)
                response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict) or not isinstance(payload.get('features', []), list):
                raise ServiceError('OpenRouteService returned an invalid directions response.', status_code=502, code='routing_invalid_response')
            features = payload.get('features', [])
        except requests.HTTPError as exc:
            self._raise_provider_error(exc, 'OpenRouteService routing failed')
        except requests.Timeout as exc:
            raise ServiceError('OpenRouteService routing request timed out.', status_code=504, code='routing_timeout') from exc
        except ServiceError:
            raise
        except (requests.RequestException, ValueError, TypeError) as exc:
            raise ServiceError(f'OpenRouteService routing failed: {exc}') from exc

        routes = []
        try:
            for index, feature in enumerate(features[:3]):
                properties = feature.get('properties', {})
                summary = properties.get('summary', {})
                if 'distance' not in summary or 'duration' not in summary:
                    raise ServiceError('OpenRouteService route is missing its distance or duration summary.')
                geometry = self.decode_geometry(feature.get('geometry'))
                distance_meters = float(summary['distance'])
                duration_seconds = float(summary['duration'])
                if (not math.isfinite(distance_meters) or distance_meters <= 0
                        or not math.isfinite(duration_seconds) or duration_seconds < 0):
                    raise ServiceError('OpenRouteService returned invalid distance or duration values.')
                route = {
                    'id': f'route-{index + 1}',
                    'name': f'Route {index + 1}',
                    'geometry': geometry,
                    'distance_meters': distance_meters,
                    'duration_seconds': duration_seconds,
                    'distance_miles': round(distance_meters / 1609.344, 1),
                    'duration_hours': round(duration_seconds / 3600, 2),
                    'summary': {
                        'distance_meters': distance_meters,
                        'distance_miles': round(distance_meters / 1609.344, 1),
                        'duration_seconds': duration_seconds,
                        'duration_hours': round(duration_seconds / 3600, 2),
                        'profile': profile,
                    },
                }
                if alternatives_limited_note:
                    route['alternatives_note'] = alternatives_limited_note
                segment_durations = self._segment_durations(properties, geometry['coordinates'])
                if segment_durations:
                    route['segment_durations_seconds'] = segment_durations
                routes.append(route)
        except (AttributeError, TypeError, ValueError) as exc:
            raise ServiceError('OpenRouteService returned an invalid route summary.') from exc
        # Return precisely what the provider returned; never synthesize missing alternatives.
        return routes

    @staticmethod
    def _validate_place(place, name):
        try:
            longitude, latitude = float(place['longitude']), float(place['latitude'])
        except (KeyError, TypeError, ValueError) as exc:
            raise ServiceError(f'Invalid {name} coordinates.', status_code=400, code='invalid_coordinates') from exc
        if (not math.isfinite(longitude) or not -180 <= longitude <= 180
                or not math.isfinite(latitude) or not -90 <= latitude <= 90):
            raise ServiceError(f'Invalid {name} coordinates.', status_code=400, code='invalid_coordinates')

    @staticmethod
    def _segment_durations(properties, coordinates):
        """Expand ORS step durations across covered geometry edges when waypoints exist."""
        supplied = properties.get('segment_durations_seconds')
        edge_count = len(coordinates) - 1
        if isinstance(supplied, list) and len(supplied) == edge_count:
            try:
                values = [float(value) for value in supplied]
                if all(value >= 0 for value in values) and sum(values) > 0:
                    return values
            except (TypeError, ValueError):
                pass

        edge_durations = [None] * edge_count
        for segment in properties.get('segments', []):
            for step in segment.get('steps', []):
                waypoints = step.get('way_points')
                duration = step.get('duration')
                if not isinstance(waypoints, (list, tuple)) or len(waypoints) != 2 or duration is None:
                    continue
                start, end = int(waypoints[0]), int(waypoints[1])
                if start < 0 or end > len(coordinates) - 1 or end <= start:
                    continue
                edges = list(range(start, end))
                lengths = [haversine(coordinates[index], coordinates[index + 1]) for index in edges]
                total_length = sum(lengths)
                if total_length <= 0:
                    continue
                for edge, length in zip(edges, lengths):
                    edge_durations[edge] = float(duration) * length / total_length
        if all(value is not None for value in edge_durations) and sum(edge_durations) > 0:
            return edge_durations
        return None

    @staticmethod
    def decode_geometry(geometry):
        """Normalize GeoJSON LineString or ORS encoded-polyline geometry to GeoJSON."""
        if isinstance(geometry, dict) and geometry.get('type') == 'LineString':
            coordinates = geometry.get('coordinates')
        elif isinstance(geometry, str):
            coordinates = OpenRouteServiceClient._decode_polyline(geometry)
        else:
            raise ServiceError('OpenRouteService returned unsupported route geometry.')
        if not isinstance(coordinates, list) or len(coordinates) < 2:
            raise ServiceError('OpenRouteService returned invalid route geometry.')
        try:
            normalized = [[float(point[0]), float(point[1])] for point in coordinates]
        except (TypeError, ValueError, IndexError) as exc:
            raise ServiceError('OpenRouteService returned invalid route coordinates.') from exc
        if any(
            not math.isfinite(longitude) or not math.isfinite(latitude)
            or not -180 <= longitude <= 180 or not -90 <= latitude <= 90
            for longitude, latitude in normalized
        ):
            raise ServiceError('OpenRouteService returned out-of-range route coordinates.')
        return {'type': 'LineString', 'coordinates': normalized}

    @staticmethod
    def _decode_polyline(encoded, precision=5):
        coordinates, index, lat, lon = [], 0, 0, 0
        factor = 10 ** precision
        while index < len(encoded):
            values = []
            for _ in range(2):
                result = shift = 0
                while True:
                    if index >= len(encoded):
                        raise ServiceError('OpenRouteService returned a truncated encoded polyline.')
                    byte = ord(encoded[index]) - 63
                    index += 1
                    result |= (byte & 0x1f) << shift
                    shift += 5
                    if byte < 0x20:
                        break
                values.append(~(result >> 1) if result & 1 else result >> 1)
            lat += values[0]
            lon += values[1]
            coordinates.append([lon / factor, lat / factor])
        return coordinates

    @staticmethod
    def _raise_provider_error(exc, message):
        response = exc.response
        if response is not None and response.status_code in (401, 403):
            raise ServiceError('OpenRouteService rejected the configured API key.', status_code=502, code='invalid_routing_api_key') from exc
        detail = response.text[:300] if response is not None else str(exc)
        raise ServiceError(f'{message}: {detail}') from exc

    @staticmethod
    def _is_alternative_distance_limit(exc):
        """Detect the ORS-specific 100 km alternative-route limit response."""
        response = exc.response
        if response is None or response.status_code != 400:
            return False
        try:
            payload = response.json()
            error = payload.get('error', {}) if isinstance(payload, dict) else {}
            message = str(error.get('message', '')).lower() if isinstance(error, dict) else ''
            return error.get('code') == 2004 and 'alternative routes algorithm' in message and '100000' in message
        except (ValueError, TypeError, AttributeError):
            return False


openrouteservice_client = OpenRouteServiceClient()
