"""Single source of truth for assessment risk bands and load override limits."""

from decimal import Decimal

RISK_ORDER = {
    'Low': 0,
    'Moderate': 1,
    'High': 2,
    'Severe': 3,
    'No Travel': 4,
}
RISK_SCORES = {
    'Low': 0,
    'Moderate': 25,
    'High': 50,
    'Severe': 75,
    'No Travel': 100,
}

# Lower bounds are inclusive. Upper bounds are exclusive except where explicitly
# represented by the final inclusive range check in the classifier.
WIND_THRESHOLDS_MPH = {
    'moderate': Decimal('25'),
    'high': Decimal('35'),
    'severe': Decimal('45'),
    'no_travel': Decimal('55'),
}
RAIN_THRESHOLDS_IN_PER_HOUR = {
    'moderate': Decimal('0.10'),
    'high': Decimal('0.25'),
    'severe': Decimal('0.50'),
    'no_travel': Decimal('1.00'),
}
SNOW_THRESHOLDS_IN_PER_HOUR = {
    'moderate': Decimal('0.5'),
    'high': Decimal('1.0'),
    'severe': Decimal('2.0'),
    'no_travel': Decimal('3.0'),
}
LOAD_THRESHOLDS_LB = {
    'wind_severe_no_travel': Decimal('30000'),
    'wind_high_at_least_severe': Decimal('40000'),
    'pounds_per_short_ton': Decimal('2000'),
}
