import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { buildCheckpointGeoJSON } from '../forecast.js'

// Vite must emit MapLibre's module worker as a first-class asset. Without this,
// its default relative URL points at a dependency file that Vercel does not serve.
maplibregl.setWorkerUrl(mapLibreWorkerUrl)

const ROUTE_COLORS = ['#258b65', '#3978c5', '#8b5fc7']
const SOURCE_IDS = ['route-lines', 'weather-checkpoints', 'journey-endpoints']

const safeCoordinate = point => {
  const coordinates = point?.coordinates || [point?.longitude, point?.latitude]
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null
  const [longitude, latitude] = coordinates.map(Number)
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return null
  return [longitude, latitude]
}

function featureCollection(features) { return { type: 'FeatureCollection', features } }
function valueOrDash(value, digits = 1) { return value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(digits) }
function displayTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}
function addDetailRow(container, label, value) {
  const row = document.createElement('div')
  row.className = 'checkpoint-popup-row'
  const key = document.createElement('span')
  key.textContent = label
  const val = document.createElement('strong')
  val.textContent = value
  row.append(key, val)
  container.append(row)
}

export default function MapView({ routes = [], selectedRouteId, recommendedRouteId, forecastHour = 0, departureTime, origin, pickup, destination }) {
  const host = useRef(null)
  const map = useRef(null)
  const popup = useRef(null)
  const latest = useRef(null)
  const fittedRoutes = useRef(null)
  const [layers, setLayers] = useState({ alternatives: true, checkpoints: true, heatmap: false, endpoints: true })
  const routeSignature = useMemo(() => JSON.stringify([
    origin?.longitude, origin?.latitude, pickup?.longitude, pickup?.latitude, destination?.longitude, destination?.latitude,
    routes.map(route => [route.id, route.geometry?.coordinates?.[0], route.geometry?.coordinates?.at(-1), route.geometry?.coordinates?.length || 0]),
  ]), [routes, origin, destination])

  const data = useMemo(() => ({ routes, selectedRouteId, recommendedRouteId, forecastHour, departureTime, origin, pickup, destination, layers, routeSignature }), [routes, selectedRouteId, recommendedRouteId, forecastHour, departureTime, origin, pickup, destination, layers, routeSignature])
  latest.current = data

  const onCheckpointClick = useCallback(event => {
    const feature = event.features?.[0]
    if (!feature || !map.current) return
    const props = feature.properties || {}
    const route = latest.current?.routes?.find(item => String(item.id) === String(props.routeId))
    const point = route?.checkpoints?.find(item => String(item.id || `${route.id}-${item.index ?? item.distance_miles}`) === String(props.checkpointId))
    if (!point) return
    popup.current?.remove()
    const root = document.createElement('div')
    root.className = 'checkpoint-popup'
    const heading = document.createElement('div')
    heading.className = 'checkpoint-popup-heading'
    const badge = document.createElement('span')
    badge.className = `checkpoint-popup-risk ${props.riskLevel || 'unknown'}`
    badge.textContent = props.riskLabel || 'Unknown'
    const title = document.createElement('strong')
    title.textContent = props.routeName || 'Route checkpoint'
    heading.append(badge, title)
    root.append(heading)
    addDetailRow(root, 'Distance from origin', `${valueOrDash(point.distance_from_origin_miles ?? point.distance_miles)} mi`)
    addDetailRow(root, 'Estimated arrival', displayTime(point.estimated_arrival_time || point.arrival_time))
    addDetailRow(root, 'Wind speed', `${valueOrDash(point.weather?.wind_speed_mph)} mph`)
    addDetailRow(root, 'Rain intensity', `${valueOrDash(point.weather?.rain_inches_per_hour, 3)} in/hr`)
    addDetailRow(root, 'Snowfall intensity', `${valueOrDash(point.weather?.snowfall_inches_per_hour, 3)} in/hr`)
    const override = point.risk?.load_override
    const explanation = document.createElement('p')
    explanation.className = `checkpoint-popup-explanation${override?.applied ? ' is-override' : ''}`
    explanation.textContent = override?.applied
      ? `Load override applied: ${override.rule || 'A load rule changed this checkpoint classification.'}`
      : 'No load override applied.'
    root.append(explanation)
    popup.current = new maplibregl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '310px', offset: 12 })
      .setLngLat(event.lngLat)
      .setDOMContent(root)
      .addTo(map.current)
  }, [])

  useEffect(() => {
    if (!host.current) return undefined
    const instance = new maplibregl.Map({
      container: host.current,
      // CARTO Voyager uses an OSM road network with clearer highways, streets,
      // water and place labels for turn-by-turn style route context.
      style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
      center: [-98, 39],
      zoom: 3.5,
      attributionControl: true,
      renderWorldCopies: false,
      cooperativeGestures: true,
    })
    map.current = instance
    instance.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    instance.on('load', () => {
      SOURCE_IDS.forEach(id => instance.addSource(id, { type: 'geojson', data: featureCollection([]), ...(id === 'route-lines' ? { lineMetrics: true } : {}) }))
      instance.addLayer({ id: 'route-casing', type: 'line', source: 'route-lines', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': ['case', ['get', 'recommended'], 11, ['get', 'selected'], 9, 6], 'line-opacity': ['case', ['get', 'visible'], 0.95, 0] } })
      instance.addLayer({ id: 'route-lines', type: 'line', source: 'route-lines', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'recommended'], 7, ['get', 'selected'], 5, 3], 'line-opacity': ['case', ['get', 'visible'], ['case', ['get', 'recommended'], 1, ['get', 'selected'], 0.95, 0.68], 0] } })
      instance.addLayer({ id: 'checkpoint-heat', type: 'heatmap', source: 'weather-checkpoints', maxzoom: 10, layout: { visibility: 'none' }, paint: { 'heatmap-weight': ['get', 'riskWeight'], 'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.7, 9, 2], 'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 10, 9, 28], 'heatmap-opacity': 0.68, 'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(34,160,107,0)', 0.15, '#eab308', 0.4, '#f97316', 0.7, '#dc2626', 1, '#7f1d1d'] } })
      instance.addLayer({ id: 'checkpoint-dots', type: 'circle', source: 'weather-checkpoints', layout: { visibility: 'visible' }, paint: { 'circle-radius': 6, 'circle-color': ['match', ['get', 'riskLevel'], 'no_travel', '#7f1d1d', 'severe', '#dc2626', 'high', '#f97316', 'moderate', '#eab308', 'low', '#22a06b', '#94a3b8'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5, 'circle-opacity': 0.98 } })
      instance.addLayer({ id: 'endpoint-dots', type: 'circle', source: 'journey-endpoints', paint: { 'circle-radius': 8, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } })
      instance.addLayer({ id: 'endpoint-labels', type: 'symbol', source: 'journey-endpoints', layout: { 'text-field': ['get', 'label'], 'text-font': ['Open Sans Bold'], 'text-size': 11, 'text-offset': [0, 1.35], 'text-anchor': 'top', 'text-allow-overlap': true }, paint: { 'text-color': '#20312b', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } })
      instance.on('click', 'checkpoint-dots', onCheckpointClick)
      instance.on('mouseenter', 'checkpoint-dots', () => { instance.getCanvas().style.cursor = 'pointer' })
      instance.on('mouseleave', 'checkpoint-dots', () => { instance.getCanvas().style.cursor = '' })
      instance.on('moveend', () => { popup.current?.remove() })
      updateMap(instance, latest.current, true)
      fittedRoutes.current = latest.current?.routeSignature
    })
    return () => {
      popup.current?.remove()
      popup.current = null
      instance.remove()
      if (map.current === instance) map.current = null
    }
  }, [onCheckpointClick])

  useEffect(() => {
    if (map.current?.isStyleLoaded()) {
      const shouldFit = Boolean(routes.length) && fittedRoutes.current !== routeSignature
      updateMap(map.current, data, shouldFit)
      if (shouldFit) fittedRoutes.current = routeSignature
    }
  }, [data, routeSignature])

  return (
    <div className="map-canvas" ref={host}>
      <div className="map-layer-control" role="group" aria-label="Map layers">
        <strong>Map layers</strong>
        {[["alternatives", 'Alternative routes'], ["checkpoints", 'Weather checkpoints'], ["heatmap", 'Weather heatmap'], ["endpoints", 'Truck, pickup & destination']].map(([key, label]) => (
          <label key={key}><input type="checkbox" checked={layers[key]} onChange={event => setLayers(current => ({ ...current, [key]: event.target.checked }))} />{label}</label>
        ))}
      </div>
    </div>
  )
}

function updateMap(map, data, shouldFit) {
  if (!map || !data || !SOURCE_IDS.every(id => map.getSource(id))) return
  const { routes = [], selectedRouteId, recommendedRouteId, forecastHour = 0, departureTime, origin, pickup, destination, layers } = data
  const routeFeatures = routes.filter(route => route.geometry?.type === 'LineString' && route.geometry.coordinates?.length >= 2).map((route, index) => {
    const recommended = route.id === recommendedRouteId || route.recommended === true
    return { type: 'Feature', geometry: route.geometry, properties: { id: route.id, name: route.name || `Route ${index + 1}`, color: recommended ? ROUTE_COLORS[0] : ROUTE_COLORS[(index % (ROUTE_COLORS.length - 1)) + 1], selected: route.id === selectedRouteId, recommended, visible: recommended || route.id === selectedRouteId || layers.alternatives } }
  })
  const checkpointData = buildCheckpointGeoJSON(routes, departureTime, forecastHour, {
    selectedRouteId,
    includeAlternatives: layers.alternatives,
  })
  const checkpointFeatures = checkpointData.features
  const endpoints = []
  for (const [key, place, label, color] of [['origin', origin, 'Truck', '#23966c'], ['pickup', pickup, 'Pickup', '#3978c5'], ['destination', destination, 'Destination', '#dc513d']]) {
    const coordinate = safeCoordinate(place)
    if (coordinate) endpoints.push({ type: 'Feature', geometry: { type: 'Point', coordinates: coordinate }, properties: { id: key, label: place.label ? `${label}: ${place.label.split(',')[0]}` : label, color } })
  }

  map.getSource('route-lines').setData(featureCollection(routeFeatures))
  map.getSource('weather-checkpoints').setData(checkpointData)
  map.getSource('journey-endpoints').setData(featureCollection(endpoints))
  for (const id of ['route-lines', 'route-casing', 'checkpoint-dots']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible')
  }
  if (map.getLayer('checkpoint-dots')) map.setLayoutProperty('checkpoint-dots', 'visibility', layers.checkpoints ? 'visible' : 'none')
  if (map.getLayer('checkpoint-heat')) map.setLayoutProperty('checkpoint-heat', 'visibility', layers.heatmap ? 'visible' : 'none')
  for (const id of ['endpoint-dots', 'endpoint-labels']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', layers.endpoints ? 'visible' : 'none')

  if (shouldFit && routeFeatures.length) {
    const bounds = new maplibregl.LngLatBounds()
    routeFeatures.forEach(feature => feature.geometry.coordinates.forEach(coordinate => bounds.extend(coordinate)))
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: { top: 74, right: 62, bottom: 50, left: 62 }, maxZoom: 11, duration: 0 })
  }
}

