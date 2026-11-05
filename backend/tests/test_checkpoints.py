from datetime import datetime, timezone

from django.test import SimpleTestCase

from apps.checkpoints.services import MILES_PER_METER, generate_checkpoints, haversine


class CheckpointGenerationTests(SimpleTestCase):
    departure = datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc)

    @staticmethod
    def equatorial_distance_miles(longitude_degrees):
        return haversine([0, 0], [longitude_degrees, 0]) * MILES_PER_METER

    def generate(self, coordinates, interval, distance=None, duration=3600, **kwargs):
        if distance is None:
            distance = sum(haversine(a, b) for a, b in zip(coordinates, coordinates[1:])) * MILES_PER_METER
        return generate_checkpoints(
            {'type': 'LineString', 'coordinates': coordinates},
            distance, duration, self.departure, interval, **kwargs,
        )

    def test_all_supported_intervals_generate_distance_based_points(self):
        distance = self.equatorial_distance_miles(2)
        for interval in (10, 25, 50):
            with self.subTest(interval=interval):
                checkpoints = self.generate([[0, 0], [2, 0]], interval, distance=distance)
                expected_distances = [0.0]
                target = float(interval)
                while target < distance - 1e-8:
                    expected_distances.append(target)
                    target += interval
                actual = [p['distance_from_origin_miles'] for p in checkpoints[:-1]]
                self.assertEqual(actual, expected_distances)
                self.assertAlmostEqual(checkpoints[-1]['distance_from_origin_miles'], distance, places=5)

    def test_short_route_has_only_start_and_destination(self):
        distance = self.equatorial_distance_miles(0.005)
        checkpoints = self.generate([[0, 0], [0.005, 0]], 10, distance=distance, duration=120)
        self.assertEqual(len(checkpoints), 2)
        self.assertEqual(checkpoints[0]['distance_from_origin_miles'], 0)
        self.assertAlmostEqual(checkpoints[-1]['distance_from_origin_miles'], distance, places=6)

    def test_long_route_places_checkpoints_along_cumulative_geometry(self):
        coordinates = [[0, 0], [2, 0], [4, 0], [6, 0]]
        distance = self.equatorial_distance_miles(6)
        checkpoints = self.generate(coordinates, 50, distance=distance, duration=20_000)
        self.assertGreater(len(checkpoints), 8)
        self.assertEqual(checkpoints[0]['coordinates'], [0.0, 0.0])
        self.assertEqual(checkpoints[-1]['coordinates'], [6.0, 0.0])
        self.assertAlmostEqual(checkpoints[1]['distance_from_origin_miles'], 50)

    def test_interpolation_follows_great_circle_not_linear_latitude(self):
        checkpoints = self.generate([[-45, 60], [45, 60]], 50, distance=100, duration=3600)
        midpoint = checkpoints[1]
        self.assertAlmostEqual(midpoint['longitude'], 0, places=6)
        self.assertGreater(midpoint['latitude'], 67)

    def test_distance_values_and_progress_are_accurate(self):
        distance = self.equatorial_distance_miles(1)
        checkpoints = self.generate([[0, 0], [1, 0]], 25, distance=distance)
        self.assertAlmostEqual(distance, 69.093, delta=0.02)
        self.assertAlmostEqual(checkpoints[1]['distance_from_origin_miles'], 25)
        self.assertAlmostEqual(checkpoints[1]['route_progress_percentage'], 25 / distance * 100, places=5)
        self.assertAlmostEqual(checkpoints[1]['distance_to_next_checkpoint_miles'], 25)
        self.assertAlmostEqual(checkpoints[-2]['distance_to_next_checkpoint_miles'], distance - 50, places=5)
        self.assertEqual(checkpoints[-1]['distance_to_next_checkpoint_miles'], 0)

    def test_proportional_eta_matches_route_duration(self):
        checkpoints = self.generate([[0, 0], [1, 0]], 25, distance=100, duration=10 * 3600)
        eta = datetime.fromisoformat(checkpoints[1]['estimated_arrival_time'])
        self.assertAlmostEqual((eta - self.departure).total_seconds(), 2.5 * 3600, places=3)
        destination_eta = datetime.fromisoformat(checkpoints[-1]['estimated_arrival_time'])
        self.assertAlmostEqual((destination_eta - self.departure).total_seconds(), 10 * 3600, places=3)

    def test_segment_durations_drive_eta_when_available(self):
        checkpoints = self.generate(
            [[0, 0], [0.5, 0], [1, 0]], 25, distance=100, duration=10 * 3600,
            segment_durations_seconds=[2 * 3600, 8 * 3600],
        )
        at_25_miles = datetime.fromisoformat(checkpoints[1]['estimated_arrival_time'])
        at_50_miles = datetime.fromisoformat(checkpoints[2]['estimated_arrival_time'])
        at_75_miles = datetime.fromisoformat(checkpoints[3]['estimated_arrival_time'])
        self.assertAlmostEqual((at_25_miles - self.departure).total_seconds(), 3600, places=3)
        self.assertAlmostEqual((at_50_miles - self.departure).total_seconds(), 7200, places=3)
        self.assertAlmostEqual((at_75_miles - self.departure).total_seconds(), 21600, places=3)

    def test_exact_interval_endpoint_is_not_duplicated(self):
        checkpoints = self.generate([[0, 0], [1, 0]], 50, distance=100)
        self.assertEqual(len(checkpoints), 3)
        self.assertEqual(len({p['id'] for p in checkpoints}), len(checkpoints))
        self.assertEqual(checkpoints[0]['coordinates'], [0.0, 0.0])
        self.assertEqual(checkpoints[-1]['coordinates'], [1.0, 0.0])

    def test_required_pickup_distance_is_inserted_as_a_checkpoint(self):
        checkpoints = self.generate(
            [[0, 0], [1, 0]], 25, distance=100, duration=3600,
            additional_checkpoint_distances_miles=[40],
        )
        pickup = next(point for point in checkpoints if point['distance_from_origin_miles'] == 40)
        self.assertEqual([point['distance_from_origin_miles'] for point in checkpoints], [0, 25, 40, 50, 75, 100])
        self.assertAlmostEqual(pickup['longitude'], 0.4, places=6)
        self.assertEqual(pickup['distance_to_next_checkpoint_miles'], 10)
        self.assertEqual(datetime.fromisoformat(pickup['estimated_arrival_time']), self.departure.replace(minute=24))

    def test_required_checkpoint_outside_route_is_rejected(self):
        with self.assertRaises(ValueError):
            self.generate([[0, 0], [1, 0]], 25, distance=100, additional_checkpoint_distances_miles=[101])

    def test_every_checkpoint_contains_required_fields(self):
        checkpoints = self.generate([[0, 0], [1, 0]], 50, distance=100)
        required = {
            'id', 'latitude', 'longitude', 'distance_from_origin_miles',
            'distance_to_next_checkpoint_miles', 'route_progress_percentage',
            'estimated_arrival_time',
        }
        for checkpoint in checkpoints:
            self.assertTrue(required.issubset(checkpoint))

    def test_unsupported_interval_is_rejected(self):
        with self.assertRaises(ValueError):
            self.generate([[0, 0], [1, 0]], 15)

    def test_invalid_distances_duration_and_geometry_are_rejected(self):
        for value in (0, -1, float('nan'), float('inf')):
            with self.subTest(distance=value), self.assertRaises(ValueError):
                generate_checkpoints([[0, 0], [1, 0]], value, 3600, self.departure, 25)
        with self.assertRaises(ValueError):
            generate_checkpoints([[0, 0], [1, 0]], 60, -1, self.departure, 25)
        with self.assertRaises(ValueError):
            generate_checkpoints([[0, 0], [181, 0]], 60, 3600, self.departure, 25)

    def test_partial_segment_durations_fall_back_to_proportional_eta(self):
        checkpoints = self.generate(
            [[0, 0], [0.5, 0], [1, 0]], 25, distance=100,
            duration=8 * 3600, segment_durations_seconds=[3600],
        )
        eta = datetime.fromisoformat(checkpoints[1]['estimated_arrival_time'])
        self.assertAlmostEqual((eta - self.departure).total_seconds(), 2 * 3600, places=3)

    def test_timezone_naive_departure_is_rejected(self):
        naive = datetime(2026, 1, 1, 8)
        with self.assertRaises(ValueError):
            generate_checkpoints([[0, 0], [1, 0]], 100, 3600, naive, 50)
