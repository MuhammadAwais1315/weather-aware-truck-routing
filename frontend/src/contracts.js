function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validCoordinates(longitude, latitude) {
  return typeof longitude === 'number' && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    && typeof latitude === 'number' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
}

function requirePlace(place, name) {
  if (!isRecord(place) || typeof place.label !== 'string' || !validCoordinates(place.longitude, place.latitude)) {
    throw new TypeError(`Backend response is missing valid ${name} geocoding data.`)
  }
}

function requireAwareTimestamp(value, name) {
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/i.test(value) || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`Backend response contains an invalid or timezone-naive ${name}.`)
  }
}

export function validatePlanResponse(data) {
  if (!isRecord(data)) throw new TypeError('Backend returned an empty or invalid route analysis response.')
  requirePlace(data.origin, 'origin')
  requirePlace(data.pickup, 'pickup')
  requirePlace(data.destination, 'destination')
  requireAwareTimestamp(data.departure_time, 'departure time')
  if (!Array.isArray(data.routes)) throw new TypeError('Backend response is missing the routes array.')
  if (data.recommended_route_id != null && typeof data.recommended_route_id !== 'string') {
    throw new TypeError('Backend response contains an invalid recommended route ID.')
  }

  for (const [index, route] of data.routes.entries()) {
    const prefix = `Route ${index + 1}`
    if (!isRecord(route) || typeof route.id !== 'string') throw new TypeError(`${prefix} is missing its route ID.`)
    if (!Array.isArray(route.legs) || route.legs.length !== 2) throw new TypeError(`${prefix} must contain truck-to-pickup and pickup-to-destination legs.`)
    for (const [legIndex, leg] of route.legs.entries()) {
      if (!isRecord(leg) || typeof leg.distance_miles !== 'number' || !Number.isFinite(leg.distance_miles)
          || typeof leg.duration_hours !== 'number' || !Number.isFinite(leg.duration_hours)) {
        throw new TypeError(`${prefix} leg ${legIndex + 1} is missing valid distance or duration.`)
      }
      requireAwareTimestamp(leg.departure_time, `${prefix} leg ${legIndex + 1} departure`)
      requireAwareTimestamp(leg.estimated_arrival_time, `${prefix} leg ${legIndex + 1} ETA`)
    }
    if (!isRecord(route.geometry) || route.geometry.type !== 'LineString' || !Array.isArray(route.geometry.coordinates) || route.geometry.coordinates.length < 2) {
      throw new TypeError(`${prefix} is missing valid GeoJSON route geometry.`)
    }
    for (const coordinate of route.geometry.coordinates) {
      if (!Array.isArray(coordinate) || !validCoordinates(coordinate[0], coordinate[1])) {
        throw new TypeError(`${prefix} has invalid GeoJSON coordinates; expected [longitude, latitude].`)
      }
    }
    if (typeof route.distance_miles !== 'number' || !Number.isFinite(route.distance_miles) || route.distance_miles < 0
      || typeof route.duration_hours !== 'number' || !Number.isFinite(route.duration_hours) || route.duration_hours < 0) {
      throw new TypeError(`${prefix} is missing valid distance or travel duration.`)
    }
    if (!Array.isArray(route.checkpoints)) throw new TypeError(`${prefix} is missing its checkpoints array.`)
    for (const [checkpointIndex, checkpoint] of route.checkpoints.entries()) {
      if (!isRecord(checkpoint) || !validCoordinates(checkpoint.longitude, checkpoint.latitude)) {
        throw new TypeError(`${prefix} checkpoint ${checkpointIndex + 1} has invalid longitude/latitude.`)
      }
      requireAwareTimestamp(checkpoint.estimated_arrival_time || checkpoint.arrival_time, `${prefix} checkpoint ETA`)
      if (!isRecord(checkpoint.weather) || !isRecord(checkpoint.risk)) {
        throw new TypeError(`${prefix} checkpoint ${checkpointIndex + 1} is missing weather or risk results.`)
      }
    }
  }
  return data
}
