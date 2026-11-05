from django.urls import path

from .views import RouteForecastView

urlpatterns = [
    path('route-forecast/', RouteForecastView.as_view(), name='route-forecast'),
]
