const checkpointTime = point => point?.estimated_arrival_time || point?.arrival_time

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function localMidnight(key) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function labelTime(value, options = {hour: 'numeric', minute: '2-digit'}) {
  return value.toLocaleTimeString([], options)
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
    return {
      id: String(point.id || `${route?.id || 'route'}-activity-${entry.index}`),
      time,
      day: dateKey(time),
      title: isOrigin ? 'Depart' : isPickup ? 'Pickup' : isDestination ? 'Arrive' : 'Weather checkpoint',
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
      const dayDuration = dayEnd.getTime() - dayStart.getTime()
      segments.push({
        id: `${start.id}-${end.id}-${key}`,
        day: key,
        start: clippedStart,
        end: clippedEnd,
        left: (clippedStart.getTime() - dayStart.getTime()) / dayDuration * 100,
        width: (clippedEnd.getTime() - clippedStart.getTime()) / dayDuration * 100,
      })
    }
  }
  return {days, events, segments}
}

const NICE_INTERVALS_MS = [5, 10, 15, 30, 60, 120, 180, 240, 360, 720].map(minutes => minutes * 60_000)

export function getTimelineScale(events, segments = []) {
  const values = [
    ...(events || []).map(event => new Date(event.time).getTime()),
    ...(segments || []).flatMap(segment => [new Date(segment.start).getTime(), new Date(segment.end).getTime()]),
  ].filter(Number.isFinite)
  if (!values.length) return {start: null, end: null, ticks: []}

  const first = new Date(Math.min(...values))
  const last = new Date(Math.max(...values))
  const dayStart = localMidnight(dateKey(first)).getTime()
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)
  const span = Math.max(last.getTime() - first.getTime(), 5 * 60_000)
  const interval = NICE_INTERVALS_MS.find(value => value >= span / 4) || 720 * 60_000
  const start = Math.max(dayStart, Math.floor(first.getTime() / interval) * interval)
  let end = Math.min(dayEnd.getTime(), Math.ceil(last.getTime() / interval) * interval)
  if (end - start < interval) end = Math.min(dayEnd.getTime(), start + interval)
  if (end - start < interval) return {start, end, ticks: [start, end]}

  const ticks = []
  for (let tick = start; tick <= end; tick += interval) ticks.push(tick)
  if (ticks.at(-1) !== end) ticks.push(end)
  return {start, end, ticks}
}

export function getTimelineEventPosition(timestamp, scale) {
  const time = timestamp instanceof Date ? timestamp : new Date(timestamp)
  if (!Number.isFinite(time.getTime())) return null
  if (scale?.start != null && scale?.end != null && scale.end > scale.start) {
    return Math.min(100, Math.max(0, (time.getTime() - scale.start) / (scale.end - scale.start) * 100))
  }
  const key = dateKey(time)
  const start = localMidnight(key)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return (time.getTime() - start.getTime()) / (end.getTime() - start.getTime()) * 100
}

export function formatTimelineTime(timestamp) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  return Number.isFinite(date.getTime()) ? labelTime(date) : 'Time unavailable'
}

