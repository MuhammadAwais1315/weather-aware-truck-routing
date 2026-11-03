"""Route summaries and deterministic safety-first route recommendation."""

import math

from apps.risk_engine.thresholds import RISK_SCORES

MILES_PER_METER = 1 / 1609.344
RANKING_PRIORITIES = (
    'fewest severe miles',
    'fewest high miles',
    'lowest distance-weighted average risk',
    'shortest travel duration',
)


def _route_distance_miles(route):
    summary = route.get('summary') or {}
    value = route.get('distance_miles', summary.get('distance_miles'))
    if value is None:
        meters = route.get('distance_meters', summary.get('distance_meters'))
        value = float(meters) * MILES_PER_METER if meters is not None else 0
    return max(0.0, float(value))


def _route_duration_hours(route):
    summary = route.get('summary') or {}
    value = route.get('duration_hours', summary.get('duration_hours'))
    if value is None:
        seconds = route.get('duration_seconds', summary.get('duration_seconds'))
        value = float(seconds) / 3600 if seconds is not None else 0
    return max(0.0, float(value))


def _risk_label(checkpoint):
    risk = checkpoint.get('risk') or {}
    label = risk.get('risk_label')
    if label in RISK_SCORES:
        return label
    level = risk.get('level')
    if level == 'no_travel':
        return 'No Travel'
    if level in ('low', 'moderate', 'high', 'severe'):
        return level.title()
    return None


def _risk_score(checkpoint, label):
    risk = checkpoint.get('risk') or {}
    value = risk.get('final_risk_score', risk.get('score'))
    if value is None:
        return RISK_SCORES.get(label) if label else None
    return float(value)


def _checkpoint_distance(checkpoint):
    value = checkpoint.get('distance_from_origin_miles', checkpoint.get('distance_miles'))
    return None if value is None else float(value)


def summarize_route(route):
    """Calculate route exposure using actual distances between adjacent checkpoints.

    A checkpoint's forecast risk applies from that checkpoint up to the next one.
    The destination checkpoint has no following segment, so its risk is not assigned
    an invented mileage. Missing/unknown risk scores are excluded from average risk.
    """
    route_id = route.get('id') or route.get('route_id') or 'unknown-route'
    distance_miles = _route_distance_miles(route)
    duration_hours = _route_duration_hours(route)
    checkpoints = list(route.get('checkpoints') or [])
    checkpoints.sort(key=lambda checkpoint: (
        _checkpoint_distance(checkpoint) is None,
        _checkpoint_distance(checkpoint) if _checkpoint_distance(checkpoint) is not None else math.inf,
    ))

    severe_miles = 0.0
    high_miles = 0.0
    no_travel_miles = 0.0
    no_travel_segments = []
    weighted_risk_total = 0.0
    scored_miles = 0.0

    for index, start in enumerate(checkpoints[:-1]):
        end = checkpoints[index + 1]
        start_distance = _checkpoint_distance(start)
        end_distance = _checkpoint_distance(end)
        if start_distance is None or end_distance is None:
            continue
        segment_miles = max(0.0, end_distance - start_distance)
        if segment_miles <= 0:
            continue
        label = _risk_label(start)
        risk_score = _risk_score(start, label)
        if label == 'Severe':
            severe_miles += segment_miles
        elif label == 'High':
            high_miles += segment_miles
        elif label == 'No Travel':
            no_travel_miles += segment_miles
            no_travel_segments.append({
                'segment_id': f'{route_id}-segment-{index + 1:04d}',
                'from_distance_miles': round(start_distance, 6),
                'to_distance_miles': round(end_distance, 6),
                'distance_miles': round(segment_miles, 6),
                'checkpoint_id': start.get('id'),
            })
        if risk_score is not None:
            weighted_risk_total += risk_score * segment_miles
            scored_miles += segment_miles

    average_risk = round(weighted_risk_total / scored_miles, 2) if scored_miles > 0 else None
    return {
        'route_id': route_id,
        'route_name': route.get('name', route_id),
        'total_distance_miles': round(distance_miles, 2),
        'travel_duration_hours': round(duration_hours, 2),
        'severe_miles': round(severe_miles, 2),
        'high_miles': round(high_miles, 2),
        'average_risk': average_risk,
        'no_travel_segments': no_travel_segments,
        'no_travel_segment_count': len(no_travel_segments),
        'no_travel_miles': round(no_travel_miles, 2),
        'safe': not no_travel_segments,
    }


def recommend_route(routes):
    """Return all available routes ranked by the assessment's exact priority order."""
    route_list = list(routes or [])
    route_summaries = [summarize_route(route) for route in route_list]
    indexed = list(enumerate(route_summaries))
    indexed.sort(key=lambda pair: (
        pair[1]['severe_miles'],
        pair[1]['high_miles'],
        pair[1]['average_risk'] if pair[1]['average_risk'] is not None else math.inf,
        pair[1]['travel_duration_hours'],
        pair[0],
    ))
    ranked_routes = [dict(summary, rank=rank) for rank, (_, summary) in enumerate(indexed, start=1)]
    safe_summaries = [summary for _, summary in indexed if summary['safe']]
    selected = safe_summaries[0] if safe_summaries else None
    recommended_route_id = selected['route_id'] if selected else None

    if selected:
        explanation = (
            f"Recommended {selected['route_name']} (route {recommended_route_id}): it ranks best among "
            f"{len(safe_summaries)} safe route(s) by {', '.join(RANKING_PRIORITIES)}. "
            'Routes containing No Travel segments are excluded from recommendation.'
        )
    elif route_summaries:
        explanation = 'No safe route available: every available route contains one or more No Travel segments.'
    else:
        explanation = 'No safe route available: the routing provider returned no routes to compare.'

    for route in route_list:
        route_id = route.get('id') or route.get('route_id') or 'unknown-route'
        summary = next((item for item in route_summaries if item['route_id'] == route_id), None)
        if summary is None:
            continue
        route['recommended'] = route_id == recommended_route_id
        metrics = route.setdefault('metrics', {})
        metrics.update({
            'severe_miles': summary['severe_miles'],
            'high_miles': summary['high_miles'],
            'average_risk': summary['average_risk'],
            'duration_hours': summary['travel_duration_hours'],
            'no_travel_segments': summary['no_travel_segment_count'],
        })

    return {
        'recommended_route_id': recommended_route_id,
        'route_id': recommended_route_id,  # Backward compatibility for the existing React client.
        'ranked_routes': ranked_routes,
        'route_summaries': route_summaries,
        'ranking_explanation': explanation,
        'reason': explanation,
    }
