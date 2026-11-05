export function makeCheckpoint(id, longitude, latitude, miles, riskLevel = 'low', forecastTime = '2026-11-03T14:00:00Z') {
  const risks = {low: 0, moderate: 25, high: 50, severe: 75, no_travel: 100, unknown: null}
  const labels = {low: 'Low', moderate: 'Moderate', high: 'High', severe: 'Severe', no_travel: 'No Travel', unknown: 'Unknown'}
  return {
    id, longitude, latitude, coordinates: [longitude, latitude], distance_miles: miles,
    distance_from_origin_miles: miles,
    estimated_arrival_time: forecastTime,
    weather: {
      available: riskLevel !== 'unknown', forecast_time: riskLevel === 'unknown' ? null : forecastTime,
      wind_speed_mph: riskLevel === 'unknown' ? null : 18.5,
      rain_inches_per_hour: riskLevel === 'unknown' ? null : 0.04,
      snowfall_inches_per_hour: riskLevel === 'unknown' ? null : 0,
    },
    risk: {
      level: riskLevel, risk_label: labels[riskLevel], final_risk_score: risks[riskLevel], score: risks[riskLevel],
      load_override: {applied: riskLevel === 'no_travel', rule: riskLevel === 'no_travel' ? 'Load threshold exceeded.' : null},
      explanation: 'Fixture risk explanation.',
    },
  }
}

export function makeRoute(id, name, {recommended = false, risk = 'low', distance = 100} = {}) {
  const legDistance = distance / 2
  return {
    id, name, recommended, distance_miles: distance, duration_hours: 2,
    geometry: {type: 'LineString', coordinates: [[-74, 40.7], [-73.5, 41.76], [-73, 41.5]]},
    legs: [
      {id: 'leg-1', from: {label: 'Truck'}, to: {label: 'Pickup'}, distance_miles: legDistance, duration_hours: 1, departure_time: '2026-11-03T14:00:00Z', estimated_arrival_time: '2026-11-03T15:00:00Z'},
      {id: 'leg-2', from: {label: 'Pickup'}, to: {label: 'Destination'}, distance_miles: legDistance, duration_hours: 1, departure_time: '2026-11-03T15:00:00Z', estimated_arrival_time: '2026-11-03T16:00:00Z'},
    ],
    metrics: {severe_miles: 0, high_miles: risk === 'high' ? 10 : 0, average_risk: risk === 'low' ? 0 : 50, no_travel_segments: risk === 'no_travel' ? 1 : 0},
    checkpoints: [
      {...makeCheckpoint(`${id}-cp-1`, -74, 40.7, 0, risk), estimated_arrival_time: '2026-11-03T14:00:00Z', checkpoint_type: 'origin'},
      {...makeCheckpoint(`${id}-cp-2`, -73.5, 41.76, legDistance, risk), estimated_arrival_time: '2026-11-03T15:00:00Z', checkpoint_type: 'pickup'},
      {...makeCheckpoint(`${id}-cp-3`, -73, 41.5, distance, risk), estimated_arrival_time: '2026-11-03T16:00:00Z', checkpoint_type: 'destination'},
    ],
  }
}

export function makePlan({origin = 'New York, NY', pickup = 'Hartford, CT', destination = 'Boston, MA', routes = null, recommendedId = 'route-1'} = {}) {
  const availableRoutes = routes || [
    makeRoute('route-1', 'Northern corridor', {recommended: true, risk: 'low'}),
    makeRoute('route-2', 'Coastal corridor', {risk: 'high'}),
  ]
  return {
    origin: {label: origin, latitude: 40.7, longitude: -74},
    pickup: {label: pickup, latitude: 41.76, longitude: -73.5},
    destination: {label: destination, latitude: 42.36, longitude: -71.06},
    departure_time: '2026-11-03T14:00:00Z',
    load_weight_tons: 21, checkpoint_interval_miles: 25,
    routes: availableRoutes,
    recommended_route_id: recommendedId,
    ranking_explanation: `Recommended ${recommendedId} based on the backend route risk summary.`,
    route_summaries: availableRoutes.map(route => ({
      route_id: route.id, total_distance_miles: route.distance_miles, travel_duration_hours: route.duration_hours,
      severe_miles: route.metrics.severe_miles, high_miles: route.metrics.high_miles,
      average_risk: route.metrics.average_risk, no_travel_segment_count: route.metrics.no_travel_segments,
      safe: route.metrics.no_travel_segments === 0,
    })),
    routing_notice: 'Use this route as planning guidance.',
  }
}
