import {act, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import MapView from '../src/components/MapView.jsx'
import {FakeMap, FakePopup, FakeLngLatBounds, FakeNavigationControl, resetFakeMaps} from './mocks/maplibre.js'
import {makePlan} from './fixtures.js'

vi.mock('maplibre-gl', async () => {
  const mock = await import('./mocks/maplibre.js')
  return {Map: mock.FakeMap, Popup: mock.FakePopup, LngLatBounds: mock.FakeLngLatBounds, NavigationControl: mock.FakeNavigationControl, setWorkerUrl: vi.fn()}
})

const basePlan = makePlan()

describe('MapLibre route and weather layers', () => {
  beforeEach(() => resetFakeMaps())

  it('creates one map, renders actual route geometry and weather checkpoints with risk heat weights', async () => {
    const {routes, origin, pickup, destination, departure_time, recommended_route_id} = basePlan
    render(<MapView routes={routes} selectedRouteId="route-1" recommendedRouteId={recommended_route_id} departureTime={departure_time} origin={origin} pickup={pickup} destination={destination}/>)
    await waitFor(() => expect(FakeMap.instances[0]?.getSource('route-lines')?.data.features).toHaveLength(2))
    const map = FakeMap.instances[0]
    expect(FakeMap.instances).toHaveLength(1)
    expect(map.options.style).toBe('https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json')
    expect(map.options.attributionControl).toBe(true)
    expect(map.options.center).toEqual([-98, 39])
    expect(map.getSource('route-lines').data.features[0].geometry).toEqual(routes[0].geometry)
    const checkpoints = map.getSource('trip-checkpoints').data.features
    expect(checkpoints).toHaveLength(6)
    expect(checkpoints[0].geometry.coordinates).toEqual([-74, 40.7])
    expect(checkpoints.find(feature => feature.properties.riskLevel === 'high').properties.riskWeight).toBe(0.5)
    expect(map.getLayer('checkpoint-heat').type).toBe('heatmap')
    expect(map.getLayer('checkpoint-heat').paint['heatmap-weight']).toEqual(['get', 'riskWeight'])
    expect(map.getLayer('route-lines').paint['line-color']).toEqual(['get', 'color'])
    expect(map.lastBounds.bounds).toBeInstanceOf(FakeLngLatBounds)
    expect(map.getSource('journey-endpoints').data.features.map(feature => feature.geometry.coordinates)).toEqual([[-74, 40.7], [-73.5, 41.76], [-71.06, 42.36]])
  })

  it('updates GeoJSON on forecast slider changes and replaces old route and checkpoint features', async () => {
    const plan = makePlan()
    const view = render(<MapView routes={plan.routes} selectedRouteId="route-1" recommendedRouteId="route-1" departureTime={plan.departure_time} origin={plan.origin} pickup={plan.pickup} destination={plan.destination} forecastHour={0}/> )
    await waitFor(() => expect(FakeMap.instances[0]?.getSource('trip-checkpoints')?.data.features).toHaveLength(6))
    const map = FakeMap.instances[0]
    const firstHeatmap = map.getSource('weather-checkpoints').data.features
    expect(firstHeatmap).toHaveLength(6)
    view.rerender(<MapView routes={plan.routes} selectedRouteId="route-1" recommendedRouteId="route-1" departureTime={plan.departure_time} origin={plan.origin} pickup={plan.pickup} destination={plan.destination} forecastHour={48}/> )
    await waitFor(() => expect(map.getSource('weather-checkpoints').data.features).toHaveLength(0))
    expect(map.getSource('trip-checkpoints').data.features).toHaveLength(6)
    view.rerender(<MapView routes={plan.routes} selectedRouteId="route-1" recommendedRouteId="route-1" departureTime={plan.departure_time} origin={plan.origin} pickup={plan.pickup} destination={plan.destination} forecastHour={0}/> )
    const replacement = makePlan({routes: [plan.routes[1]], recommendedId: 'route-2'})
    view.rerender(<MapView routes={replacement.routes} selectedRouteId="route-2" recommendedRouteId="route-2" departureTime={replacement.departure_time} origin={replacement.origin} pickup={replacement.pickup} destination={replacement.destination} forecastHour={0}/> )
    await waitFor(() => expect(map.getSource('route-lines').data.features.map(feature => feature.properties.id)).toEqual(['route-2']))
    expect(map.getSource('trip-checkpoints').data.features.map(feature => feature.properties.routeId)).toEqual(['route-2', 'route-2', 'route-2'])
    expect(FakeMap.instances).toHaveLength(1)
    expect([...map.sources.keys()]).toEqual(['route-lines', 'weather-checkpoints', 'trip-checkpoints', 'journey-endpoints'])
    expect([...map.layers.keys()].filter(id => id === 'checkpoint-dots')).toHaveLength(1)
  })

  it('toggles the heatmap and checkpoint visibility with layer controls', async () => {
    const plan = makePlan()
    render(<MapView routes={plan.routes} selectedRouteId="route-1" recommendedRouteId="route-1" departureTime={plan.departure_time} origin={plan.origin} pickup={plan.pickup} destination={plan.destination}/>)
    await waitFor(() => expect(FakeMap.instances[0]?.getLayer('checkpoint-heat')).toBeTruthy())
    const map = FakeMap.instances[0]
    fireEvent.click(screen.getByLabelText('Weather heatmap'))
    await waitFor(() => expect(map.getLayer('checkpoint-heat').layout.visibility).toBe('visible'))
    fireEvent.click(screen.getByLabelText('Weather checkpoints'))
    await waitFor(() => expect(map.getLayer('checkpoint-dots').layout.visibility).toBe('none'))
  })

  it('opens checkpoint details from actual route data and does not fabricate missing weather values', async () => {
    const plan = makePlan()
    render(<MapView routes={plan.routes} selectedRouteId="route-1" recommendedRouteId="route-1" departureTime={plan.departure_time} origin={plan.origin} pickup={plan.pickup} destination={plan.destination}/>)
    await waitFor(() => expect(FakeMap.instances[0]?.getSource('trip-checkpoints')?.data.features).toHaveLength(6))
    const map = FakeMap.instances[0]
    const feature = map.getSource('trip-checkpoints').data.features[0]
    act(() => map.fireLayer('click', 'checkpoint-dots', {features: [feature], lngLat: {lng: -74, lat: 40.7}}))
    expect(FakePopup.instances).toHaveLength(1)
    expect(FakePopup.instances[0].element).toHaveTextContent('Distance from origin')
    expect(FakePopup.instances[0].element).toHaveTextContent('Wind speed')
    expect(FakePopup.instances[0].element).toHaveTextContent('18.5 mph')
    expect(FakePopup.instances[0].element).toHaveTextContent('No load override applied.')
    expect(FakePopup.instances[0].lngLat).toEqual({lng: -74, lat: 40.7})
  })

  it('keeps unknown weather checkpoints visible without treating them as heatmap observations', async () => {
    const plan = makePlan()
    plan.routes[0].checkpoints[1] = {...plan.routes[0].checkpoints[1], risk: {level: 'unknown', risk_label: 'Unknown'}, weather: {available: false}}
    render(<MapView routes={plan.routes} selectedRouteId="route-1" recommendedRouteId="route-1" departureTime={plan.departure_time} origin={plan.origin} pickup={plan.pickup} destination={plan.destination}/> )
    await waitFor(() => expect(FakeMap.instances[0]?.getSource('trip-checkpoints')?.data.features).toHaveLength(6))
    const map = FakeMap.instances[0]
    expect(map.getSource('trip-checkpoints').data.features.find(feature => feature.properties.checkpointId === 'route-1-cp-2').properties.riskLevel).toBe('unknown')
    expect(map.getSource('weather-checkpoints').data.features).toHaveLength(5)
  })

  it('cleans up map and source data when unmounted', async () => {
    const plan = makePlan()
    const view = render(<MapView routes={plan.routes} selectedRouteId="route-1" recommendedRouteId="route-1" departureTime={plan.departure_time} origin={plan.origin} pickup={plan.pickup} destination={plan.destination}/>)
    await waitFor(() => expect(FakeMap.instances).toHaveLength(1))
    const map = FakeMap.instances[0]
    view.unmount()
    expect(map.removed).toBe(true)
    expect(map.sources.size).toBe(0)
  })
})
