from django.test import SimpleTestCase

from apps.recommendations.services import recommend_route, summarize_route
from apps.risk_engine.thresholds import RISK_SCORES


def route_with_segments(route_id, labels, lengths, duration_hours):
    checkpoints = []
    distance = 0.0
    for index, (label, length) in enumerate(zip(labels, lengths)):
        checkpoints.append({
            'id': f'{route_id}-cp-{index}',
            'distance_from_origin_miles': distance,
            'risk': {
                'risk_label': label,
                'final_risk_score': RISK_SCORES[label] if label else None,
            },
        })
        distance += length
    checkpoints.append({
        'id': f'{route_id}-destination',
        'distance_from_origin_miles': distance,
        'risk': {'risk_label': None, 'final_risk_score': None},
    })
    return {
        'id': route_id,
        'name': route_id.upper(),
        'distance_miles': distance,
        'duration_hours': duration_hours,
        'checkpoints': checkpoints,
    }


class RouteSummaryTests(SimpleTestCase):
    def test_risk_miles_use_adjacent_checkpoint_distance_not_checkpoint_count(self):
        route = route_with_segments('route-a', ['Severe', 'High', 'No Travel'], [2.5, 6.5, 1], 3)

        summary = summarize_route(route)

        self.assertEqual(summary['total_distance_miles'], 10)
        self.assertEqual(summary['travel_duration_hours'], 3)
        self.assertEqual(summary['severe_miles'], 2.5)
        self.assertEqual(summary['high_miles'], 6.5)
        self.assertEqual(summary['no_travel_segment_count'], 1)
        self.assertEqual(summary['no_travel_miles'], 1)
        self.assertEqual(summary['average_risk'], 61.25)
        self.assertFalse(summary['safe'])

    def test_destination_checkpoint_has_no_outgoing_no_travel_miles(self):
        route = route_with_segments('route-a', ['Low'], [10], 1)
        route['checkpoints'][-1]['risk'] = {'risk_label': 'No Travel', 'final_risk_score': 100}

        summary = summarize_route(route)

        self.assertEqual(summary['no_travel_segment_count'], 0)
        self.assertTrue(summary['safe'])


class RouteRankingPriorityTests(SimpleTestCase):
    def test_priority_1_fewest_severe_miles(self):
        few_severe = route_with_segments('few-severe', ['Severe', 'High'], [1, 9], 12)
        more_severe = route_with_segments('more-severe', ['Severe', 'Low'], [5, 5], 1)

        result = recommend_route([more_severe, few_severe])

        self.assertEqual(result['recommended_route_id'], 'few-severe')
        self.assertEqual([item['route_id'] for item in result['ranked_routes']], ['few-severe', 'more-severe'])

    def test_priority_2_fewest_high_miles_after_severe_tie(self):
        few_high = route_with_segments('few-high', ['High', 'Low'], [2, 8], 12)
        more_high = route_with_segments('more-high', ['High', 'Low'], [8, 2], 1)

        result = recommend_route([more_high, few_high])

        self.assertEqual(result['ranked_routes'][0]['route_id'], 'few-high')

    def test_priority_3_lowest_distance_weighted_average_risk(self):
        lower_risk = route_with_segments('lower-risk', ['Moderate', 'Low'], [5, 5], 20)
        higher_risk = route_with_segments('higher-risk', ['Moderate', 'Moderate'], [5, 5], 1)

        result = recommend_route([higher_risk, lower_risk])

        self.assertEqual(result['ranked_routes'][0]['route_id'], 'lower-risk')
        self.assertEqual(result['recommended_route_id'], 'lower-risk')

    def test_priority_4_shortest_duration_after_risk_tie(self):
        slow = route_with_segments('slow', ['Low'], [10], 8)
        fast = route_with_segments('fast', ['Low'], [10], 3)

        result = recommend_route([slow, fast])

        self.assertEqual(result['ranked_routes'][0]['route_id'], 'fast')
        self.assertEqual(result['recommended_route_id'], 'fast')

    def test_no_travel_route_is_never_recommended_as_safe(self):
        unsafe = route_with_segments('unsafe', ['No Travel', 'Low'], [1, 9], 1)
        safe = route_with_segments('safe', ['Severe', 'Low'], [2, 8], 3)

        result = recommend_route([unsafe, safe])

        self.assertEqual(result['recommended_route_id'], 'safe')
        self.assertFalse(next(item for item in result['ranked_routes'] if item['route_id'] == 'unsafe')['safe'])
        self.assertTrue(next(item for item in result['ranked_routes'] if item['route_id'] == 'safe')['safe'])

    def test_all_routes_unsafe_returns_no_safe_route_available(self):
        routes = [
            route_with_segments('unsafe-a', ['No Travel'], [5], 1),
            route_with_segments('unsafe-b', ['Severe', 'No Travel'], [4, 6], 2),
        ]

        result = recommend_route(routes)

        self.assertIsNone(result['recommended_route_id'])
        self.assertEqual(result['ranking_explanation'].split(':')[0], 'No safe route available')
        self.assertTrue(all(not item['safe'] for item in result['ranked_routes']))
        self.assertTrue(all(not route['recommended'] for route in routes))

    def test_one_or_two_routes_are_compared_without_fabricating_options(self):
        one = [route_with_segments('only', ['Low'], [5], 1)]
        two = [route_with_segments('first', ['Low'], [5], 1), route_with_segments('second', ['Moderate'], [5], 2)]

        one_result = recommend_route(one)
        two_result = recommend_route(two)

        self.assertEqual(len(one_result['ranked_routes']), 1)
        self.assertEqual(len(one_result['route_summaries']), 1)
        self.assertEqual(len(two_result['ranked_routes']), 2)
        self.assertEqual(len(two_result['route_summaries']), 2)

    def test_response_includes_recommendation_summaries_and_explanation(self):
        result = recommend_route([route_with_segments('route-a', ['Low'], [10], 2)])

        self.assertEqual(result['route_id'], result['recommended_route_id'])
        self.assertEqual(result['route_summaries'][0]['total_distance_miles'], 10)
        self.assertIn('ranking_explanation', result)
        self.assertIn('fewest severe miles', result['ranking_explanation'])
