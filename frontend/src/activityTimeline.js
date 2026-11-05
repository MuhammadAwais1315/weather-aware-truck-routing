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
      risk: point.risk?.level || 'unknown',
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

