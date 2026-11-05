const EARTH_RADIUS_METERS = 6_371_000
const SAMPLE_COUNT = 41
const NEARBY_METERS = 220

function lineCoordinates(route) {
  const geometry = route?.geometry || route?.geojson || route?.route_geometry
  const coordinates = Array.isArray(geometry) ? geometry : geometry?.coordinates
  return Array.isArray(coordinates)
    ? coordinates.filter(point => Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
      .map(point => [Number(point[0]), Number(point[1])])
    : []
}

function metersBetween(a, b) {
  const lat1 = a[1] * Math.PI / 180
  const lat2 = b[1] * Math.PI / 180
  const dLat = lat2 - lat1
  const dLon = (b[0] - a[0]) * Math.PI / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, h)))
}

function sampleLine(points) {
  if (points.length < 2) return points
  const distances = [0]
  for (let index = 1; index < points.length; index += 1) distances.push(distances[index - 1] + metersBetween(points[index - 1], points[index]))
  const length = distances.at(-1)
  if (!length) return Array.from({length: SAMPLE_COUNT}, () => points[0])
  return Array.from({length: SAMPLE_COUNT}, (_, sampleIndex) => {
    const target = length * sampleIndex / (SAMPLE_COUNT - 1)
    let segment = 1
    while (segment < distances.length - 1 && distances[segment] < target) segment += 1
    const segmentLength = distances[segment] - distances[segment - 1]
    const ratio = segmentLength ? (target - distances[segment - 1]) / segmentLength : 0
    return [
      points[segment - 1][0] + (points[segment][0] - points[segment - 1][0]) * ratio,
      points[segment - 1][1] + (points[segment][1] - points[segment - 1][1]) * ratio,
    ]
  })
}

function pointToSegmentMeters(point, start, end) {
  const latitude = point[1] * Math.PI / 180
  const scaleX = EARTH_RADIUS_METERS * Math.cos(latitude) * Math.PI / 180
  const scaleY = EARTH_RADIUS_METERS * Math.PI / 180
  const px = point[0] * scaleX
  const py = point[1] * scaleY
  const ax = start[0] * scaleX
  const ay = start[1] * scaleY
  const bx = end[0] * scaleX
  const by = end[1] * scaleY
  const dx = bx - ax
  const dy = by - ay
  const denominator = dx * dx + dy * dy
  const ratio = denominator ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denominator)) : 0
  return Math.hypot(px - (ax + ratio * dx), py - (ay + ratio * dy))
}

function pointToLineMeters(point, line) {
  if (line.length === 1) return metersBetween(point, line[0])
  let nearest = Infinity
  for (let index = 1; index < line.length; index += 1) nearest = Math.min(nearest, pointToSegmentMeters(point, line[index - 1], line[index]))
  return nearest
}

export function routesAreNearDuplicates(first, second) {
  const firstLine = lineCoordinates(first)
  const secondLine = lineCoordinates(second)
  if (firstLine.length < 2 || secondLine.length < 2) return false
  const firstLength = metersBetween(firstLine[0], firstLine.at(-1))
  const firstSamples = sampleLine(firstLine)
  const secondSamples = sampleLine(secondLine)
  const secondLength = metersBetween(secondLine[0], secondLine.at(-1))
  const miles1 = Number(first.distance_miles)
  const miles2 = Number(second.distance_miles)
  if (Number.isFinite(miles1) && Number.isFinite(miles2) && Math.abs(miles1 - miles2) / Math.max(miles1, miles2, 1) > 0.03) return false
  if (firstLength < 1 || secondLength < 1) return false
  const covered = (samples, line) => samples.filter(point => pointToLineMeters(point, line) <= NEARBY_METERS).length / samples.length
  return covered(firstSamples, secondLine) >= 0.95 && covered(secondSamples, firstLine) >= 0.95
}

export function deduplicateRoutes(routes, recommendedRouteId = null) {
  const ordered = [...(routes || [])].sort((a, b) => Number(b.id === recommendedRouteId) - Number(a.id === recommendedRouteId))
  const unique = []
  let removed = 0
  for (const route of ordered) {
    if (unique.some(existing => routesAreNearDuplicates(existing, route))) { removed += 1; continue }
    unique.push(route)
  }
  return {routes: unique, removed}
}
