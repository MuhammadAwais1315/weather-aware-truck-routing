export default function MapView({routes, selectedRouteId, exploratoryForecast}) {
  return <div data-testid="map-view" data-routes={routes.map(route => route.id).join(',')} data-selected={selectedRouteId} data-forecast-count={exploratoryForecast?.features?.length||0}>Map: {routes.map(route => route.name).join(' · ')}</div>
}
