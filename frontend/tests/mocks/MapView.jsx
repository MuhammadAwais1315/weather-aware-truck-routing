export default function MapView({routes, selectedRouteId, forecastHour}) {
  return <div data-testid="map-view" data-routes={routes.map(route => route.id).join(',')} data-selected={selectedRouteId} data-forecast-hour={forecastHour}>Map: {routes.map(route => route.name).join(' · ')}</div>
}
