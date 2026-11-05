from django.conf import settings
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.geocoding.services import geocode_place, reverse_geocode
from services.route_provider import openrouteservice_client
from .serializers import PlanRequestSerializer


class HealthView(APIView):
    authentication_classes = []
    permission_classes = []
    throttle_classes = []

    def get(self, request):
        return Response({'status': 'ok', 'version': settings.APP_VERSION})


class GeocodeView(APIView):
    throttle_scope = 'geocode'

    def get(self, request):
        query = request.query_params.get('q', '').strip()
        if len(query) < 3:
            raise ValidationError('Enter at least 3 characters.')
        return Response(geocode_place(query))


class ReverseGeocodeView(APIView):
    throttle_scope = 'geocode'

    def get(self, request):
        latitude = request.query_params.get('lat')
        longitude = request.query_params.get('lon')
        if latitude is None or longitude is None:
            raise ValidationError('Provide checkpoint latitude and longitude.')
        return Response(reverse_geocode(latitude, longitude))


class AddressAutocompleteView(APIView):
    throttle_scope = 'autocomplete'

    def get(self, request):
        query = request.query_params.get('q', '').strip()
        if len(query) < 3:
            return Response({'suggestions': []})
        return Response({'suggestions': openrouteservice_client.autocomplete(query)})


class PlanRouteView(APIView):
    throttle_scope = 'plan'

    def post(self, request):
        serializer = PlanRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        from .planning import build_plan
        return Response(build_plan(serializer.validated_data))
