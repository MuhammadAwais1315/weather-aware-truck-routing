from django.urls import path

from .views import AddressAutocompleteView, GeocodeView, PlanRouteView, ReverseGeocodeView

urlpatterns = [
    path('geocode/autocomplete/', AddressAutocompleteView.as_view(), name='geocode-autocomplete'),
    path('geocode/', GeocodeView.as_view(), name='geocode'),
    path('geocode/reverse/', ReverseGeocodeView.as_view(), name='geocode-reverse'),
    path('plan/', PlanRouteView.as_view(), name='plan-route'),
]
