from rest_framework import serializers

from apps.routing.serializers import AwareDateTimeField


class ExploratoryCheckpointSerializer(serializers.Serializer):
    route_id = serializers.CharField(max_length=100)
    checkpoint_id = serializers.CharField(max_length=100)
    route_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    latitude = serializers.FloatField(min_value=-90, max_value=90)
    longitude = serializers.FloatField(min_value=-180, max_value=180)


class RouteForecastRequestSerializer(serializers.Serializer):
    forecast_time = AwareDateTimeField()
    load_weight_tons = serializers.FloatField(min_value=0, max_value=100)
    checkpoints = serializers.ListField(
        child=ExploratoryCheckpointSerializer(), min_length=1, max_length=1000,
    )

    def validate_checkpoints(self, checkpoints):
        identifiers = [(point['route_id'], point['checkpoint_id']) for point in checkpoints]
        if len(identifiers) != len(set(identifiers)):
            raise serializers.ValidationError('Checkpoint identifiers must be unique within each route.')
        return checkpoints
