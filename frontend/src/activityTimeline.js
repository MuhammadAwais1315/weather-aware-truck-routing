const checkpointTime = point => point?.estimated_arrival_time || point?.arrival_time

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function localMidnight(key) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function buildTripActivityTimeline(route, departureTime) {
  const checkpoints = (route?.checkpoints || [])
    .map((point, index) => ({point, index, time: new Date(checkpointTime(point) || '')}))
    .filter(entry => Number.isFinite(entry.time.getTime()))
    .sort((left, right) => left.time - right.time)

  if (!checkpoints.length) return {days: [], events: [], segments: []}

  const lastPointIndex = checkpoints.length - 1
  const events = checkpoints.map((entry, index) => {
    const {point, time} = entry
    const isOrigin = index === 0 || Number(point.distance_from_origin_miles ?? point.distance_miles) === 0
    const isDestination = index === lastPointIndex
    const isPickup = point.checkpoint_type === 'pickup'
    const kind = isOrigin ? 'start' : isPickup ? 'pickup' : isDestination ? 'dropoff' : 'weather'
    return {
      id: String(point.id || `${route?.id || 'route'}-activity-${entry.index}`),
      time,
      day: dateKey(time),
      kind,
      title: {start: 'Trip start', pickup: 'Pickup', dropoff: 'Drop-off', weather: 'Weather checkpoint'}[kind],
      location: point.location_label || null,
      distance: Number(point.distance_from_origin_miles ?? point.distance_miles ?? 0),
      coordinates: Array.isArray(point.coordinates) ? point.coordinates : [point.longitude, point.latitude],
      risk: point.risk?.level || 'unknown',
      riskScore: point.risk?.final_risk_score ?? point.risk?.score ?? null,
      weather: point.weather || null,
      endpoint: isOrigin || isPickup || isDestination,
      pickup: isPickup,
    }
  })

  const departure = new Date(departureTime || '')
  const dayKeys = new Set(events.map(event => event.day))
  if (Number.isFinite(departure.getTime())) dayKeys.add(dateKey(departure))
  const days = [...dayKeys].sort().map((key, index) => ({
    key,
    label: `Day ${index + 1} · ${localMidnight(key).toLocaleDateString([], {weekday: 'short', month: 'short', day: 'numeric'})}`,
  }))

  const segments = []
  for (let index = 0; index < events.length - 1; index += 1) {
    const start = events[index]
    const end = events[index + 1]
    if (end.time <= start.time) continue
    const firstDay = localMidnight(start.day)
    const lastDay = localMidnight(end.day)
    for (let day = new Date(firstDay); day <= lastDay; day.setDate(day.getDate() + 1)) {
      const key = dateKey(day)
      const dayStart = localMidnight(key)
      const dayEnd = new Date(dayStart)
      dayEnd.setDate(dayEnd.getDate() + 1)
      const clippedStart = new Date(Math.max(start.time.getTime(), dayStart.getTime()))
      const clippedEnd = new Date(Math.min(end.time.getTime(), dayEnd.getTime()))
      if (clippedEnd <= clippedStart) continue
      segments.push({
        id: `${start.id}-${end.id}-${key}`,
        day: key,
        start: clippedStart,
        end: clippedEnd,
      })
    }
  }
  return {days, events, segments}
}

export function formatTimelineDateTime(timestamp) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  return Number.isFinite(date.getTime())
    ? date.toLocaleString([], {weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'})
    : 'Time unavailable'
}

const RISK_COLORS = {no_travel: '#7f1d1d', severe: '#dc2626', high: '#f97316', moderate: '#d2a000', low: '#22a06b', unknown: '#64748b'}

export function buildRiskTimelineGraph(events, {width = 760, height = 230} = {}) {
  const left = 54
  const right = 18
  const top = 18
  const bottom = 44
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const times = (events || []).map(event => event.time instanceof Date ? event.time.getTime() : new Date(event.time).getTime()).filter(Number.isFinite)
  if (!times.length) return {width, height, plot: {left, right, top, bottom, width: plotWidth, height: plotHeight}, points: [], ticks: [], segments: []}

  let startTime = Math.min(...times)
  let endTime = Math.max(...times)
  if (endTime === startTime) { startTime -= 30 * 60_000; endTime += 30 * 60_000 }
  const points = (events || []).flatMap(event => {
    const time = event.time instanceof Date ? event.time.getTime() : new Date(event.time).getTime()
    if (!Number.isFinite(time)) return []
    const scoreValue = event.riskScore ?? event.risk?.final_risk_score ?? event.risk?.score
    const score = scoreValue == null || !Number.isFinite(Number(scoreValue)) ? null : Math.max(0, Math.min(100, Number(scoreValue)))
    const level = event.risk || 'unknown'
    return [{
      id: event.id,
      x: left + (time - startTime) / (endTime - startTime) * plotWidth,
      y: score == null ? null : top + (100 - score) / 100 * plotHeight,
      score,
      risk: typeof level === 'string' ? level : level.level || 'unknown',
      time,
      color: RISK_COLORS[typeof level === 'string' ? level : level.level] || RISK_COLORS.unknown,
    }]
  }).sort((a, b) => a.time - b.time)

  const segments = []
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]
    const to = points[index]
    if (from.y == null || to.y == null) continue
    segments.push({id: `${from.id}-${to.id}`, x1: from.x, y1: from.y, x2: to.x, y2: to.y})
  }

  const ticks = Array.from({length: 5}, (_, index) => {
    const ratio = index / 4
    const time = startTime + (endTime - startTime) * ratio
    return {x: left + plotWidth * ratio, time, label: new Date(time).toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'})}
  })
  return {width, height, plot: {left, right, top, bottom, width: plotWidth, height: plotHeight}, points, ticks, segments}
}

