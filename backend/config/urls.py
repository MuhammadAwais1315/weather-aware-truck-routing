from django.urls import include, path

from apps.routing.views import HealthView

urlpatterns = [
    path('api/health/', HealthView.as_view(), name='health'),
    path('api/', include('apps.routing.urls')),
    path('api/weather/', include('apps.weather.urls')),
]
