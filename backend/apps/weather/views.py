from rest_framework.response import Response
from rest_framework.views import APIView

from apps.risk_engine.services import score_checkpoint
from .serializers import RouteForecastRequestSerializer
from .services import get_exploratory_weather, prefetch_weather


class RouteForecastView(APIView):
    throttle_scope = 'forecast'

    def post(self, request):
        serializer = RouteForecastRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data
        checkpoints = payload['checkpoints']
        prefetch_weather((point['latitude'], point['longitude']) for point in checkpoints)
        forecast_time = payload['forecast_time']
        forecasts = []
        for point in checkpoints:
            weather = get_exploratory_weather(
                point['latitude'], point['longitude'], forecast_time,
            )
            forecasts.append({
                **point,
                'weather': weather,
                'risk': score_checkpoint(weather, payload['load_weight_tons']),
            })
        return Response({
            'forecast_time': forecast_time.isoformat(),
            'forecasts': forecasts,
        })
