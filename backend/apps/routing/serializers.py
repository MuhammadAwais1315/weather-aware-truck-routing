import re
from datetime import datetime

from rest_framework import serializers


class AwareDateTimeField(serializers.DateTimeField):
    """Require request timestamps to carry an explicit UTC offset or Z suffix."""

    _timezone_suffix = re.compile(r'(?:Z|[+-]\d{2}:?\d{2})$', re.IGNORECASE)

    def to_internal_value(self, value):
        if isinstance(value, datetime):
            aware = value.tzinfo is not None and value.utcoffset() is not None
        elif isinstance(value, str):
            aware = bool(self._timezone_suffix.search(value.strip()))
        else:
            aware = False
        if not aware:
            self.fail('invalid', format='an ISO 8601 timestamp with an explicit timezone offset')
        result = super().to_internal_value(value)
        if result.tzinfo is None or result.utcoffset() is None:
            self.fail('invalid', format='a timezone-aware datetime')
        return result


class PlanRequestSerializer(serializers.Serializer):
    origin = serializers.CharField(max_length=200)
    destination = serializers.CharField(max_length=200)
    departure_time = AwareDateTimeField()
    load_weight_tons = serializers.FloatField(min_value=0, max_value=100, default=20)
    checkpoint_interval_miles = serializers.ChoiceField(choices=[10, 25, 50], default=25)

    def validate(self, attrs):
        if attrs['origin'].strip().casefold() == attrs['destination'].strip().casefold():
            raise serializers.ValidationError('Origin and destination must differ.')
        return attrs
