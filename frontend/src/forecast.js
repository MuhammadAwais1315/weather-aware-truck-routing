const MAX_FORECAST_HOURS = 48
const MATCH_WINDOW_MS = 30 * 60 * 1000

const RISK_WEIGHTS = {
  low: 0,
  moderate: 0.25,
  high: 0.5,
  severe: 0.75,
  no_travel: 1,
}

export function clampForecastHour(value) {
  const hours = Number(value)
  if (!Number.isFinite(hours)) return 0
  return Math.min(MAX_FORECAST_HOURS, Math.max(0, Math.round(hours)))
}

export function getSelectedForecastTimestamp(departureTime, hoursOffset) {
  const departure = new Date(departureTime)
  if (!departureTime || Number.isNaN(departure.getTime())) return null
  departure.setTime(departure.getTime() + clampForecastHour(hoursOffset) * 60 * 60 * 1000)
  return departure.toISOString()
}

function validForecastAt(checkpoint) {
  const weather = checkpoint?.weather
  if (!weather || weather.available === false || !weather.forecast_time) return null
  const timestamp = new Date(weather.forecast_time).getTime()
  return Number.isNaN(timestamp) ? null : timestamp
}

export function getVisibleForecastCheckpoints(routes, departureTime, hoursOffset) {
  const selectedTimestamp = getSelectedForecastTimestamp(departureTime, hoursOffset)
  if (!selectedTimestamp) return []
  const selectedMs = new Date(selectedTimestamp).getTime()
  return (routes || []).flatMap(route => (route.checkpoints || []).flatMap(checkpoint => {
    const forecastMs = validForecastAt(checkpoint)
    if (forecastMs == null || Math.abs(forecastMs - selectedMs) > MATCH_WINDOW_MS) return []
    return [{ route, checkpoint }]
  }))
}

function coordinateOf(checkpoint) {
  const coordinates = checkpoint?.coordinates || [checkpoint?.longitude, checkpoint?.latitude]
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null
  const [longitude, latitude] = coordinates.map(Number)
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return null
  return [longitude, latitude]
}

function riskWeight(risk) {
  const label = risk?.risk_label?.toLowerCase().replaceAll(' ', '_') || risk?.level
  return Object.hasOwn(RISK_WEIGHTS, label) ? RISK_WEIGHTS[label] : null
}

export function buildCheckpointGeoJSON(routes, departureTime, hoursOffset, { selectedRouteId, includeAlternatives = true } = {}) {
  const features = getVisibleForecastCheckpoints(routes, departureTime, hoursOffset).flatMap(({ route, checkpoint }) => {
    if (!includeAlternatives && route.id !== selectedRouteId) return []
    const coordinates = coordinateOf(checkpoint)
    const weight = riskWeight(checkpoint.risk)
    // Unknown risk or missing weather is not converted to a zero-risk observation.
    if (!coordinates || weight == null || checkpoint.weather?.available === false) return []
    const risk = checkpoint.risk || {}
    const level = risk.level || risk.risk_label?.toLowerCase().replaceAll(' ', '_') || 'unknown'
    const checkpointId = checkpoint.id || `${route.id}-${checkpoint.index ?? checkpoint.distance_miles}`
    return [{
      type: 'Feature',
      id: `${route.id}:${checkpointId}`,
      geometry: { type: 'Point', coordinates },
      properties: {
        checkpointId,
        routeId: route.id,
        routeName: route.name || String(route.id),
        riskLabel: risk.risk_label || level.replaceAll('_', ' '),
        riskLevel: level,
        riskWeight: weight,
        riskScore: risk.final_risk_score ?? risk.score ?? null,
        forecastTime: checkpoint.weather.forecast_time,
        tripEta: checkpoint.estimated_arrival_time || checkpoint.arrival_time || null,
      },
    }]
  })
  return { type: 'FeatureCollection', features }
}

export function buildExploratoryForecastGeoJSON(forecasts, {selectedRouteId, includeAlternatives = true} = {}) {
  const features = (forecasts || []).flatMap(forecast => {
    if (!includeAlternatives && forecast.route_id !== selectedRouteId) return []
    const coordinates = coordinateOf(forecast)
    if (!coordinates) return []
    const risk = forecast.risk || {}
    const weather = forecast.weather || {}
    const level = risk.level || risk.risk_label?.toLowerCase().replaceAll(' ', '_') || 'unknown'
    const weight = riskWeight(risk)
    return [{
      type: 'Feature',
      id: `${forecast.route_id}:${forecast.checkpoint_id}`,
      geometry: {type: 'Point', coordinates},
      properties: {
        routeId: forecast.route_id,
        checkpointId: forecast.checkpoint_id,
        routeName: forecast.route_name || forecast.route_id,
        exploratory: true,
        weatherAvailable: weather.available === true,
        forecastTime: weather.forecast_time || null,
        riskLabel: risk.risk_label || 'Unknown',
        riskLevel: weight == null ? 'unknown' : level,
        riskWeight: weight,
        riskScore: risk.final_risk_score ?? risk.score ?? null,
        windSpeedMph: weather.wind_speed_mph ?? null,
        rainInchesPerHour: weather.rain_inches_per_hour ?? null,
        snowfallInchesPerHour: weather.snowfall_inches_per_hour ?? null,
        loadOverrideApplied: risk.load_override?.applied === true,
        loadOverrideRule: risk.load_override?.rule || '',
        riskExplanation: risk.explanation || 'Forecast risk is unknown.',
      },
    }]
  })
  return {type: 'FeatureCollection', features}
}

// Trip checkpoint markers describe the assessment at each checkpoint's actual
// ETA. Keep them independent from the exploratory slider's heatmap observations
// so a slider time with no matching hourly forecast cannot hide route stops.
export function buildTripCheckpointGeoJSON(routes, { selectedRouteId, includeAlternatives = true } = {}) {
  const features = (routes || []).flatMap(route => (route.checkpoints || []).flatMap(checkpoint => {
    if (!includeAlternatives && route.id !== selectedRouteId) return []
    const coordinates = coordinateOf(checkpoint)
    if (!coordinates) return []
    const risk = checkpoint.risk || {}
    const level = risk.level || risk.risk_label?.toLowerCase().replaceAll(' ', '_') || 'unknown'
    const checkpointId = checkpoint.id || `${route.id}-${checkpoint.index ?? checkpoint.distance_miles}`
    const weight = riskWeight(risk)
    return [{
      type: 'Feature',
      id: `${route.id}:${checkpointId}`,
      geometry: { type: 'Point', coordinates },
      properties: {
        checkpointId,
        routeId: route.id,
        routeName: route.name || String(route.id),
        riskLabel: risk.risk_label || level.replaceAll('_', ' '),
        riskLevel: weight == null ? 'unknown' : level,
        riskWeight: weight,
        riskScore: risk.final_risk_score ?? risk.score ?? null,
        forecastTime: checkpoint.weather?.forecast_time || null,
        tripEta: checkpoint.estimated_arrival_time || checkpoint.arrival_time || null,
      },
    }]
  }))
  return { type: 'FeatureCollection', features }
}

export function formatForecastTimestamp(timestamp, locale) {
  if (!timestamp) return 'Forecast time unavailable'
  const value = new Date(timestamp)
  if (Number.isNaN(value.getTime())) return 'Forecast time unavailable'
  return value.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
}
