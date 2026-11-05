from datetime import datetime, timedelta

from apps.checkpoints.services import MILES_PER_METER, generate_checkpoints
from apps.geocoding.services import geocode_place
from apps.recommendations.services import recommend_route
from apps.risk_engine.services import score_checkpoint
from apps.weather.services import get_weather
from services.exceptions import ServiceError
from services.route_provider import openrouteservice_client


def build_plan(payload):
    origin = geocode_place(payload['origin'])
    pickup = geocode_place(payload['pickup'])
    destination = geocode_place(payload['destination'])
    coordinates = [
        (round(float(place['longitude']), 7), round(float(place['latitude']), 7))
        for place in (origin, pickup, destination)
    ]
    if len(set(coordinates)) != 3:
        raise ServiceError(
            'Truck location, pickup, and destination must resolve to different places.',
            status_code=400, code='duplicate_locations',
        )
    routes = openrouteservice_client.get_routes(origin, destination, via_points=[pickup])
    departure = payload['departure_time']
    interval = int(payload['checkpoint_interval_miles'])
    load = payload['load_weight_tons']
    for route in routes:
        miles = route['distance_meters'] * MILES_PER_METER
        waypoint_distances = route.get('waypoint_distances_miles', [])
        points = generate_checkpoints(
            route['geometry'], miles,
            route['duration_seconds'], departure, interval,
            segment_durations_seconds=route.get('segment_durations_seconds'),
            additional_checkpoint_distances_miles=waypoint_distances,
        )
        locations = [origin, pickup, destination]
        provider_legs = route.get('provider_legs', [])
        legs = []
        elapsed_seconds = 0.0
        for index, provider_leg in enumerate(provider_legs):
            leg_departure = departure + timedelta(seconds=elapsed_seconds)
            elapsed_seconds += provider_leg['duration_seconds']
            leg_arrival = departure + timedelta(seconds=elapsed_seconds)
            legs.append({
                'id': f'leg-{index + 1}',
                'from': locations[index],
                'to': locations[index + 1],
                'distance_miles': round(provider_leg['distance_miles'], 1),
                'duration_seconds': provider_leg['duration_seconds'],
                'duration_hours': round(provider_leg['duration_seconds'] / 3600, 2),
                'departure_time': leg_departure.isoformat(),
                'estimated_arrival_time': leg_arrival.isoformat(),
                'steps': provider_leg.get('steps', []),
            })
        checkpoints = []
        hours = route['duration_seconds'] / 3600
        for point in points:
            route_miles = point['distance_from_origin_miles']
            if route_miles <= 1e-6:
                point.update({'checkpoint_type': 'origin', 'location_label': origin['label']})
            elif waypoint_distances and any(abs(route_miles - value) <= 1e-3 for value in waypoint_distances):
                point.update({'checkpoint_type': 'pickup', 'location_label': pickup['label']})
                pickup_coordinate = provider_legs[0].get('waypoint_coordinate') if provider_legs else None
                if pickup_coordinate:
                    point['coordinates'] = pickup_coordinate
                    point['longitude'], point['latitude'] = pickup_coordinate
            elif abs(route_miles - miles) <= 1e-6:
                point.update({'checkpoint_type': 'destination', 'location_label': destination['label']})
            else:
                point['checkpoint_type'] = 'weather'
            longitude, latitude = point['coordinates']
            weather = get_weather(latitude, longitude, datetime.fromisoformat(point['estimated_arrival_time']))
            risk = score_checkpoint(weather, load)
            checkpoints.append({**point, 'weather': weather, 'risk': risk})
        severe = sum(point['risk']['level'] in ('severe', 'no_travel') for point in checkpoints)
        high = sum(point['risk']['level'] == 'high' for point in checkpoints)
        known_scores = [point['risk']['score'] for point in checkpoints if point['risk']['score'] is not None]
        average = round(sum(known_scores) / len(known_scores), 1) if known_scores else None
        route.update({
            # Keep provider precision for exposure coverage and route ranking;
            # the UI formats these values for display.
            'distance_miles': miles, 'duration_hours': hours,
            'legs': legs,
            'checkpoints': checkpoints,
            'metrics': {
                'severe_miles': round(severe * interval, 1),
                'high_miles': round(high * interval, 1),
                'average_risk': average, 'duration_hours': round(hours, 2),
            },
        })
    recommendation = recommend_route(routes)
    alternatives_notes = list(dict.fromkeys(
        route['alternatives_note'] for route in routes if route.get('alternatives_note')
    ))
    routing_notice = (
        'Route results use the configured openrouteservice profile but are not a guarantee of compliance '
        'with truck height, axle-weight, or road restrictions. Verify restrictions before dispatch.'
    )
    if alternatives_notes:
        routing_notice = f"{routing_notice} {' '.join(alternatives_notes)}"
    return {
        'origin': origin, 'pickup': pickup, 'destination': destination, 'departure_time': departure.isoformat(),
        'load_weight_tons': load, 'checkpoint_interval_miles': interval,
        'routes': routes, 'recommendation': recommendation,
        'recommendation_status': recommendation['recommendation_status'],
        'recommended_route_id': recommendation['recommended_route_id'],
        'ranked_routes': recommendation['ranked_routes'],
        'route_summaries': recommendation['route_summaries'],
        'ranking_explanation': recommendation['ranking_explanation'],
        'routing_notice': routing_notice,
    }
