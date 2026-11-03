from datetime import datetime

from apps.checkpoints.services import MILES_PER_METER, generate_checkpoints
from apps.geocoding.services import geocode_place
from apps.recommendations.services import recommend_route
from apps.risk_engine.services import score_checkpoint
from apps.weather.services import get_weather
from services.route_provider import openrouteservice_client


def build_plan(payload):
    origin = geocode_place(payload['origin'])
    destination = geocode_place(payload['destination'])
    routes = openrouteservice_client.get_routes(origin, destination)
    departure = payload['departure_time']
    interval = int(payload['checkpoint_interval_miles'])
    load = payload['load_weight_tons']
    for route in routes:
        miles = route['distance_meters'] * MILES_PER_METER
        points = generate_checkpoints(
            route['geometry'], miles,
            route['duration_seconds'], departure, interval,
            segment_durations_seconds=route.get('segment_durations_seconds'),
        )
        checkpoints = []
        hours = route['duration_seconds'] / 3600
        for point in points:
            longitude, latitude = point['coordinates']
            weather = get_weather(latitude, longitude, datetime.fromisoformat(point['estimated_arrival_time']))
            risk = score_checkpoint(weather, load)
            checkpoints.append({**point, 'weather': weather, 'risk': risk})
        severe = sum(point['risk']['level'] in ('severe', 'no_travel') for point in checkpoints)
        high = sum(point['risk']['level'] == 'high' for point in checkpoints)
        known_scores = [point['risk']['score'] for point in checkpoints if point['risk']['score'] is not None]
        average = round(sum(known_scores) / len(known_scores), 1) if known_scores else None
        route.update({
            'distance_miles': round(miles, 1), 'duration_hours': round(hours, 2),
            'checkpoints': checkpoints,
            'metrics': {
                'severe_miles': round(severe * interval, 1),
                'high_miles': round(high * interval, 1),
                'average_risk': average, 'duration_hours': round(hours, 2),
            },
        })
    recommendation = recommend_route(routes)
    return {
        'origin': origin, 'destination': destination, 'departure_time': departure.isoformat(),
        'load_weight_tons': load, 'checkpoint_interval_miles': interval,
        'routes': routes, 'recommendation': recommendation,
        'recommended_route_id': recommendation['recommended_route_id'],
        'ranked_routes': recommendation['ranked_routes'],
        'route_summaries': recommendation['route_summaries'],
        'ranking_explanation': recommendation['ranking_explanation'],
        'routing_notice': 'Route results use the configured openrouteservice profile but are not a guarantee of compliance with truck height, axle-weight, or road restrictions. Verify restrictions before dispatch.',
    }
