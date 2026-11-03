from django.test import SimpleTestCase

from apps.risk_engine.services import score_checkpoint


class RiskThresholdTests(SimpleTestCase):
    @staticmethod
    def score(**values):
        weather = {
            'available': True,
            'wind_speed_mph': None,
            'rain_inches_per_hour': None,
            'snowfall_inches_per_hour': None,
        }
        weather.update(values)
        return score_checkpoint(weather, load_tons=0)

    def test_wind_threshold_boundaries(self):
        cases = [
            ('24.999', 'Low'),
            ('25', 'Moderate'), ('34.999', 'Moderate'),
            ('35', 'High'), ('44.999', 'High'),
            ('45', 'Severe'), ('54.999', 'Severe'),
            ('55', 'No Travel'), ('100', 'No Travel'),
        ]
        for value, expected in cases:
            with self.subTest(wind_mph=value):
                result = self.score(wind_speed_mph=value)
                self.assertEqual(result['wind_risk']['label'], expected)
                self.assertEqual(result['risk_label'], expected)

    def test_rain_threshold_boundaries(self):
        cases = [
            ('0.09999', 'Low'),
            ('0.10', 'Moderate'), ('0.24999', 'Moderate'),
            ('0.25', 'High'), ('0.49999', 'High'),
            ('0.50', 'Severe'), ('1.00', 'Severe'),
            ('1.00001', 'No Travel'),
        ]
        for value, expected in cases:
            with self.subTest(rain_inches_per_hour=value):
                result = self.score(rain_inches_per_hour=value)
                self.assertEqual(result['rain_risk']['label'], expected)
                self.assertEqual(result['risk_label'], expected)

    def test_snow_threshold_boundaries(self):
        cases = [
            ('0.49999', 'Low'),
            ('0.5', 'Moderate'), ('0.99999', 'Moderate'),
            ('1.0', 'High'), ('1.99999', 'High'),
            ('2.0', 'Severe'), ('3.0', 'Severe'),
            ('3.00001', 'No Travel'),
        ]
        for value, expected in cases:
            with self.subTest(snow_inches_per_hour=value):
                result = self.score(snowfall_inches_per_hour=value)
                self.assertEqual(result['snow_risk']['label'], expected)
                self.assertEqual(result['risk_label'], expected)

    def test_wind_55_or_higher_is_no_travel_for_every_load(self):
        for load_tons in (0, 15, 100):
            with self.subTest(load_tons=load_tons):
                result = score_checkpoint({'wind_speed_mph': 55}, load_tons)
                self.assertEqual(result['risk_label'], 'No Travel')
                self.assertFalse(result['load_override']['applied'])

    def test_severe_wind_load_override_is_strictly_above_30000_pounds(self):
        at_limit = score_checkpoint({'wind_speed_mph': 45}, 15)
        above_limit = score_checkpoint({'wind_speed_mph': 45}, 15.0005)

        self.assertEqual(at_limit['risk_label'], 'Severe')
        self.assertFalse(at_limit['load_override']['applied'])
        self.assertEqual(above_limit['risk_label'], 'No Travel')
        self.assertTrue(above_limit['load_override']['applied'])
        self.assertIn('30,000 lb', above_limit['load_override']['rule'])
        self.assertIn('Load rules raise', above_limit['explanation'])

    def test_severe_wind_load_override_applies_through_54_mph_but_not_55(self):
        for wind in (45, 54.999):
            with self.subTest(wind_mph=wind):
                result = score_checkpoint({'wind_speed_mph': wind}, 15.0005)
                self.assertEqual(result['risk_label'], 'No Travel')
                self.assertTrue(result['load_override']['applied'])
        at_55 = score_checkpoint({'wind_speed_mph': 55}, 15.0005)
        self.assertEqual(at_55['risk_label'], 'No Travel')
        self.assertFalse(at_55['load_override']['applied'])

    def test_high_wind_load_override_is_strictly_above_40000_pounds(self):
        at_limit = score_checkpoint({'wind_speed_mph': 35}, 20)
        above_limit = score_checkpoint({'wind_speed_mph': 35}, 20.0005)

        self.assertEqual(at_limit['risk_label'], 'High')
        self.assertFalse(at_limit['load_override']['applied'])
        self.assertEqual(above_limit['risk_label'], 'Severe')
        self.assertTrue(above_limit['load_override']['applied'])
        self.assertIn('40,000 lb', above_limit['load_override']['rule'])
        self.assertIn('Load rules raise', above_limit['explanation'])

    def test_high_wind_load_override_applies_through_44_mph_only(self):
        for wind in (35, 44.999):
            with self.subTest(wind_mph=wind):
                result = score_checkpoint({'wind_speed_mph': wind}, 20.0005)
                self.assertEqual(result['risk_label'], 'Severe')
                self.assertTrue(result['load_override']['applied'])
        at_45 = score_checkpoint({'wind_speed_mph': 45}, 20.0005)
        self.assertEqual(at_45['risk_label'], 'No Travel')
        self.assertEqual(at_45['load_override']['risk_label'], 'No Travel')

    def test_final_risk_uses_highest_weather_component(self):
        result = self.score(wind_speed_mph=35, rain_inches_per_hour=1.1, snowfall_inches_per_hour=0.8)

        self.assertEqual(result['wind_risk']['label'], 'High')
        self.assertEqual(result['rain_risk']['label'], 'No Travel')
        self.assertEqual(result['snow_risk']['label'], 'Moderate')
        self.assertEqual(result['risk_label'], 'No Travel')
        self.assertEqual(result['final_risk_score'], 100)

    def test_load_override_does_not_lower_a_higher_weather_risk(self):
        result = score_checkpoint({
            'wind_speed_mph': 40,
            'rain_inches_per_hour': 1.1,
            'snowfall_inches_per_hour': 0.1,
        }, 41)

        self.assertEqual(result['load_override']['risk_label'], 'Severe')
        self.assertEqual(result['risk_label'], 'No Travel')

    def test_missing_weather_is_explicit_and_not_scored_as_zero(self):
        result = score_checkpoint({
            'available': False,
            'wind_speed_mph': None,
            'rain_inches_per_hour': None,
            'snowfall_inches_per_hour': None,
        }, 10)

        self.assertEqual(result['wind_risk']['label'], 'Unknown')
        self.assertEqual(result['rain_risk']['label'], 'Unknown')
        self.assertEqual(result['snow_risk']['label'], 'Unknown')
        self.assertEqual(result['risk_label'], 'Unknown')
        self.assertIsNone(result['final_risk_score'])
        self.assertIn('missing', result['explanation'])

    def test_partial_weather_keeps_missing_components_unknown(self):
        result = self.score(rain_inches_per_hour=0.1)

        self.assertEqual(result['wind_risk']['label'], 'Unknown')
        self.assertEqual(result['rain_risk']['label'], 'Moderate')
        self.assertEqual(result['snow_risk']['label'], 'Unknown')
        self.assertEqual(result['risk_label'], 'Moderate')

    def test_response_contains_assessment_fields_and_explanation(self):
        result = self.score(wind_speed_mph=25, rain_inches_per_hour=0.1, snowfall_inches_per_hour=0.5)

        self.assertEqual(result['risk_label'], 'Moderate')
        self.assertEqual(result['final_risk_score'], 25)
        self.assertFalse(result['load_override']['applied'])
        self.assertIn('explanation', result)
        self.assertEqual(result['level'], 'moderate')
