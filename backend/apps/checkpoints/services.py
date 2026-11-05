"""Distance-based checkpoint generation for GeoJSON route lines.

Checkpoint spacing and reported mileages use the route provider's total distance.
Positions are located by cumulative haversine distance along the actual route geometry
and spherical interpolation within a geometry segment. If per-geometry-segment
durations are available, they are scaled to the route's total duration and used for
ETAs. Otherwise ETA is proportional to distance progress along the route.
"""

import math
from datetime import datetime, timedelta, timezone

MILES_PER_METER = 1 / 1609.344
SUPPORTED_INTERVALS_MILES = (10, 25, 50)
EARTH_RADIUS_METERS = 6_371_000
DISTANCE_EPSILON_MILES = 1e-8


def haversine(point_a, point_b):
    """Return great-circle distance between [longitude, latitude] points in meters."""
    lon1, lat1 = map(math.radians, point_a)
    lon2, lat2 = map(math.radians, point_b)
    delta_lat = lat2 - lat1
    delta_lon = lon2 - lon1
    value = math.sin(delta_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    return 2 * EARTH_RADIUS_METERS * math.asin(math.sqrt(min(1.0, value)))


def _coordinates_from_geometry(route_geometry):
    if isinstance(route_geometry, dict) and route_geometry.get('type') == 'Feature':
        route_geometry = route_geometry.get('geometry')
    if isinstance(route_geometry, dict):
        if route_geometry.get('type') != 'LineString':
            raise ValueError('Route geometry must be a GeoJSON LineString or Feature.')
        coordinates = route_geometry.get('coordinates')
    else:
        coordinates = route_geometry
    if not isinstance(coordinates, (list, tuple)) or len(coordinates) < 2:
        raise ValueError('Route geometry must contain at least two coordinates.')
    normalized = []
    for coordinate in coordinates:
        if not isinstance(coordinate, (list, tuple)) or len(coordinate) < 2:
            raise ValueError('Each route coordinate must contain longitude and latitude.')
        longitude, latitude = float(coordinate[0]), float(coordinate[1])
        if not math.isfinite(longitude) or not math.isfinite(latitude):
            raise ValueError('Route coordinates must be finite numbers.')
        if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
            raise ValueError('Route coordinate is outside longitude/latitude bounds.')
        normalized.append((longitude, latitude))
    return normalized


def _spherical_interpolate(start, end, fraction):
    """Interpolate a point on the great-circle arc between two lon/lat points."""
    fraction = min(max(fraction, 0.0), 1.0)
    if fraction <= 0:
        return [float(start[0]), float(start[1])]
    if fraction >= 1:
        return [float(end[0]), float(end[1])]

    lon1, lat1 = map(math.radians, start)
    lon2, lat2 = map(math.radians, end)
    vector_a = (math.cos(lat1) * math.cos(lon1), math.cos(lat1) * math.sin(lon1), math.sin(lat1))
    vector_b = (math.cos(lat2) * math.cos(lon2), math.cos(lat2) * math.sin(lon2), math.sin(lat2))
    dot = max(-1.0, min(1.0, sum(a * b for a, b in zip(vector_a, vector_b))))
    angle = math.acos(dot)
    if angle < 1e-12:
        return [float(start[0]), float(start[1])]
    sin_angle = math.sin(angle)
    if abs(sin_angle) < 1e-12:
        # Antipodal endpoints have no unique shortest great-circle arc.
        raise ValueError('Cannot uniquely interpolate antipodal route coordinates.')
    weight_a = math.sin((1 - fraction) * angle) / sin_angle
    weight_b = math.sin(fraction * angle) / sin_angle
    x = weight_a * vector_a[0] + weight_b * vector_b[0]
    y = weight_a * vector_a[1] + weight_b * vector_b[1]
    z = weight_a * vector_a[2] + weight_b * vector_b[2]
    longitude = math.degrees(math.atan2(y, x))
    latitude = math.degrees(math.atan2(z, math.hypot(x, y)))
    return [longitude, latitude]


def _interpolate_along_route(coordinates, cumulative_meters, target_meters):
    if target_meters <= 0:
        return [float(coordinates[0][0]), float(coordinates[0][1])], 0
    if target_meters >= cumulative_meters[-1]:
        return [float(coordinates[-1][0]), float(coordinates[-1][1])], len(coordinates) - 2
    low, high = 0, len(cumulative_meters) - 1
    while low < high:
        middle = (low + high) // 2
        if cumulative_meters[middle] < target_meters:
            low = middle + 1
        else:
            high = middle
    segment_index = max(0, low - 1)
    segment_length = cumulative_meters[segment_index + 1] - cumulative_meters[segment_index]
    if segment_length <= 0:
        return [float(coordinates[segment_index + 1][0]), float(coordinates[segment_index + 1][1])], segment_index
    fraction = (target_meters - cumulative_meters[segment_index]) / segment_length
    return _spherical_interpolate(coordinates[segment_index], coordinates[segment_index + 1], fraction), segment_index


def _duration_at_distance(target_meters, segment_index, segment_fraction, cumulative_meters,
                          route_duration_seconds, segment_durations_seconds):
    if segment_durations_seconds is None:
        # Documented fallback: assume constant average speed, so ETA progress follows
        # route-distance progress. This preserves the given route ETA at the endpoint.
        return route_duration_seconds * target_meters / cumulative_meters[-1]
    total_segment_duration = sum(segment_durations_seconds)
    if total_segment_duration <= 0:
        return route_duration_seconds * target_meters / cumulative_meters[-1]
    scale = route_duration_seconds / total_segment_duration
    elapsed = sum(segment_durations_seconds[:segment_index])
    elapsed += segment_durations_seconds[segment_index] * segment_fraction
    return elapsed * scale


def generate_checkpoints(route_geometry, total_distance_miles, total_travel_duration_seconds,
                         departure_datetime, checkpoint_interval_miles, segment_durations_seconds=None,
                         additional_checkpoint_distances_miles=None):
    """Create endpoint-inclusive checkpoints spaced by route miles.

    `segment_durations_seconds`, when supplied, must contain one duration for each
    adjacent coordinate pair. The output keeps legacy `coordinates`, `index`,
    `distance_miles`, and `arrival_time` keys for existing frontend consumers.
    """
    try:
        total_distance_miles = float(total_distance_miles)
        total_travel_duration_seconds = float(total_travel_duration_seconds)
        interval_value = float(checkpoint_interval_miles)
    except (TypeError, ValueError) as exc:
        raise ValueError('Distance, duration, and checkpoint interval must be numeric.') from exc
    if not math.isfinite(total_distance_miles) or total_distance_miles <= 0:
        raise ValueError('Total route distance must be a positive finite number of miles.')
    if not math.isfinite(total_travel_duration_seconds) or total_travel_duration_seconds < 0:
        raise ValueError('Total travel duration must be a non-negative finite number of seconds.')
    if not math.isfinite(interval_value) or not interval_value.is_integer():
        raise ValueError('Checkpoint interval must be 10, 25, or 50 miles.')
    interval = int(interval_value)
    if interval not in SUPPORTED_INTERVALS_MILES:
        raise ValueError('Checkpoint interval must be 10, 25, or 50 miles.')
    if (not isinstance(departure_datetime, datetime) or departure_datetime.tzinfo is None
            or departure_datetime.utcoffset() is None):
        raise ValueError('Departure time must be a timezone-aware datetime value.')

    coordinates = _coordinates_from_geometry(route_geometry)
    segment_lengths = [haversine(a, b) for a, b in zip(coordinates, coordinates[1:])]
    cumulative_meters = [0.0]
    for length in segment_lengths:
        cumulative_meters.append(cumulative_meters[-1] + length)
    geometry_distance_meters = cumulative_meters[-1]
    if geometry_distance_meters <= 0:
        raise ValueError('Route geometry must have non-zero length.')

    segment_durations = None
    if segment_durations_seconds is not None:
        try:
            candidate = [float(value) for value in segment_durations_seconds]
        except (TypeError, ValueError) as exc:
            raise ValueError('Segment durations must be numeric seconds.') from exc
        if any(not math.isfinite(value) or value < 0 for value in candidate):
            raise ValueError('Segment durations must be non-negative finite seconds.')
        if len(candidate) == len(segment_lengths) and sum(candidate) > 0:
            segment_durations = candidate

    # Route-provider miles are authoritative for interval spacing and output distance;
    # map each distance target proportionally onto measured geometry cumulative length.
    targets = [0.0]
    next_target = float(interval)
    while next_target < total_distance_miles - DISTANCE_EPSILON_MILES:
        targets.append(next_target)
        next_target += interval
    targets.append(total_distance_miles)
    if additional_checkpoint_distances_miles is not None:
        for value in additional_checkpoint_distances_miles:
            try:
                distance = float(value)
            except (TypeError, ValueError) as exc:
                raise ValueError('Additional checkpoint distances must be numeric miles.') from exc
            if not math.isfinite(distance) or distance < 0 or distance > total_distance_miles:
                raise ValueError('Additional checkpoint distances must fall within the route distance.')
            targets.append(distance)
        targets.sort()
        deduplicated = []
        for distance in targets:
            if not deduplicated or distance - deduplicated[-1] > DISTANCE_EPSILON_MILES:
                deduplicated.append(distance)
        targets = deduplicated

    checkpoints = []
    for index, route_miles in enumerate(targets):
        geometry_meters = geometry_distance_meters * route_miles / total_distance_miles
        point, segment_index = _interpolate_along_route(coordinates, cumulative_meters, geometry_meters)
        segment_length = segment_lengths[segment_index]
        segment_fraction = 0.0 if segment_length <= 0 else (
            geometry_meters - cumulative_meters[segment_index]
        ) / segment_length
        elapsed_seconds = _duration_at_distance(
            geometry_meters, segment_index, segment_fraction, cumulative_meters,
            total_travel_duration_seconds, segment_durations,
        )
        next_miles = targets[index + 1] - route_miles if index + 1 < len(targets) else 0.0
        arrival = departure_datetime + timedelta(seconds=elapsed_seconds)
        checkpoints.append({
            'id': f'checkpoint-{index + 1:04d}',
            'index': index + 1,
            'latitude': point[1],
            'longitude': point[0],
            'coordinates': point,
            'distance_from_origin_miles': round(route_miles, 6),
            'distance_to_next_checkpoint_miles': round(next_miles, 6),
            'route_progress_percentage': round(route_miles / total_distance_miles * 100, 6),
            'estimated_arrival_time': arrival.isoformat(),
            # Backward-compatible aliases used in existing route/MapLibre UI.
            'distance_miles': round(route_miles, 6),
            'arrival_time': arrival.isoformat(),
        })
    return checkpoints


def sample_line(coordinates, interval_miles):
    """Backward-compatible geometry sampler; planning should use generate_checkpoints."""
    geometry_miles = sum(haversine(a, b) for a, b in zip(coordinates, coordinates[1:])) / 1609.344
    return generate_checkpoints(
        coordinates, geometry_miles, 0, departure_datetime=datetime.min.replace(tzinfo=timezone.utc),
        checkpoint_interval_miles=interval_miles,
    )
