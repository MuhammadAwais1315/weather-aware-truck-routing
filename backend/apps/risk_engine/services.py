"""Assessment risk classification and load overrides for a checkpoint."""

from decimal import Decimal, InvalidOperation

from .thresholds import (
    LOAD_THRESHOLDS_LB,
    RAIN_THRESHOLDS_IN_PER_HOUR,
    RISK_ORDER,
    RISK_SCORES,
    SNOW_THRESHOLDS_IN_PER_HOUR,
    WIND_THRESHOLDS_MPH,
)


def _decimal(value):
    if value is None:
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None
    return number if number.is_finite() else None


def _classify(value, thresholds, *, upper_is_severe_inclusive=False):
    """Return the band label; input values are expected in the named unit."""
    value = _decimal(value)
    if value is None:
        return None
    if value < thresholds['moderate']:
        return 'Low'
    if value < thresholds['high']:
        return 'Moderate'
    if value < thresholds['severe']:
        return 'High'
    if upper_is_severe_inclusive:
        if value <= thresholds['no_travel']:
            return 'Severe'
    elif value < thresholds['no_travel']:
        return 'Severe'
    return 'No Travel'


def classify_wind(wind_mph):
    return _classify(wind_mph, WIND_THRESHOLDS_MPH)


def classify_rain(rain_inches_per_hour):
    return _classify(rain_inches_per_hour, RAIN_THRESHOLDS_IN_PER_HOUR, upper_is_severe_inclusive=True)


def classify_snow(snow_inches_per_hour):
    return _classify(snow_inches_per_hour, SNOW_THRESHOLDS_IN_PER_HOUR, upper_is_severe_inclusive=True)


def _component(label, value, unit):
    normalized = _decimal(value)
    return {
        'label': label or 'Unknown',
        'score': RISK_SCORES[label] if label else None,
        'value': float(normalized) if normalized is not None else None,
        'unit': unit,
    }


def score_checkpoint(weather, load_tons):
    """Classify wind, rain, and snow, then apply the highest label and load rules.

    Existing app load inputs are short tons. Assessment limits are interpreted as
    pounds and converted using 2,000 lb per short ton before strict `>` comparisons.
    """
    weather = weather or {}
    wind_value = weather.get('wind_speed_mph')
    rain_value = weather.get('rain_inches_per_hour')
    snow_value = weather.get('snowfall_inches_per_hour')

    wind_label = classify_wind(wind_value)
    rain_label = classify_rain(rain_value)
    snow_label = classify_snow(snow_value)
    wind_risk = _component(wind_label, wind_value, 'mph')
    rain_risk = _component(rain_label, rain_value, 'inches/hour')
    snow_risk = _component(snow_label, snow_value, 'inches/hour')

    known = [label for label in (wind_label, rain_label, snow_label) if label is not None]
    load_override = {'applied': False, 'risk_label': None, 'rule': None}
    load_value_tons = _decimal(load_tons)
    load_pounds = load_value_tons * LOAD_THRESHOLDS_LB['pounds_per_short_ton'] if load_value_tons is not None else None
    wind = _decimal(wind_value)

    if wind is not None and load_pounds is not None:
        if Decimal('45') <= wind < Decimal('55') and load_pounds > LOAD_THRESHOLDS_LB['wind_severe_no_travel']:
            load_override = {
                'applied': True,
                'risk_label': 'No Travel',
                'rule': 'Wind is 45–54 mph and load exceeds 30,000 lb.',
            }
        elif Decimal('35') <= wind < Decimal('45') and load_pounds > LOAD_THRESHOLDS_LB['wind_high_at_least_severe']:
            load_override = {
                'applied': True,
                'risk_label': 'Severe',
                'rule': 'Wind is 35–44 mph and load exceeds 40,000 lb.',
            }

    candidates = list(known)
    if load_override['applied']:
        candidates.append(load_override['risk_label'])
    final_label = max(candidates, key=lambda label: RISK_ORDER[label]) if candidates else None
    highest_components = [
        name for name, label in (('wind', wind_label), ('rain', rain_label), ('snow', snow_label))
        if final_label is not None and label == final_label
    ]
    if final_label is None:
        explanation = 'Risk is unknown because wind, rain, and snow forecasts are all missing.'
    elif load_override['applied'] and not highest_components:
        explanation = f"Load rules raise the checkpoint risk to {final_label}. {load_override['rule']}"
    else:
        explanation = f"Highest forecast risk is {final_label} from {', '.join(highest_components)}."
        if load_override['applied']:
            explanation += f" Load rule applied: {load_override['rule']}"

    score = RISK_SCORES[final_label] if final_label else None
    level = final_label.lower().replace(' ', '_') if final_label else 'unknown'
    return {
        'wind_risk': wind_risk,
        'rain_risk': rain_risk,
        'snow_risk': snow_risk,
        'final_risk_score': score,
        'risk_label': final_label or 'Unknown',
        'load_override': load_override,
        'explanation': explanation,
        # Backward-compatible fields consumed by existing route cards and map.
        'score': score,
        'level': level,
        'reasons': [explanation],
    }
