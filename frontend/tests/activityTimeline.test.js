import {describe, expect, it} from 'vitest'
import {buildRiskTimelineGraph, buildTripActivityTimeline, formatTimelineDateTime} from '../src/activityTimeline.js'

function makePoint(id, date, miles, risk = 'low') {
  const scores = {low: 0, moderate: 25, high: 50, severe: 75, no_travel: 100, unknown: null}
  return {id, distance_from_origin_miles: miles, estimated_arrival_time: date.toISOString(), risk: {level: risk, final_risk_score: scores[risk]}, weather: {wind_speed_mph: 12, rain_inches_per_hour: 0.1, snowfall_inches_per_hour: 0}}
}

describe('estimated trip activity timeline', () => {
  it('builds departure, weather checkpoint, arrival, and driving segments from actual checkpoint ETAs', () => {
    const start = new Date(2026, 10, 3, 14, 0)
    const middle = new Date(2026, 10, 3, 15, 0)
    const end = new Date(2026, 10, 3, 16, 30)
    const route = {id: 'route-1', checkpoints: [makePoint('a', start, 0), makePoint('b', middle, 25, 'high'), makePoint('c', end, 52)]}
    const model = buildTripActivityTimeline(route, start.toISOString())
    expect(model.events.map(event => event.title)).toEqual(['Trip start', 'Weather checkpoint', 'Drop-off'])
    expect(model.events[1]).toMatchObject({kind: 'weather', distance: 25, risk: 'high', day: model.days[0].key})
    expect(model.segments).toHaveLength(2)
    expect(model.segments.map(segment => segment.start.getTime())).toEqual([start.getTime(), middle.getTime()])
    expect(model.segments.map(segment => segment.end.getTime())).toEqual([middle.getTime(), end.getTime()])
    expect(model.segments[0]).toMatchObject({start, end: middle})
  })

  it('splits estimated driving periods at local midnight and exposes days for selection', () => {
    const start = new Date(2026, 10, 3, 23, 30)
    const middle = new Date(2026, 10, 4, 0, 15)
    const end = new Date(2026, 10, 4, 1, 0)
    const model = buildTripActivityTimeline({checkpoints: [makePoint('a', start, 0), makePoint('b', middle, 10), makePoint('c', end, 15)]}, start.toISOString())
    expect(model.days).toHaveLength(2)
    expect(model.segments.map(segment => segment.day)).toEqual([model.days[0].key, model.days[1].key, model.days[1].key])
    expect(model.events.filter(event => event.day === model.days[1].key)).toHaveLength(2)
  })

  it('returns no fabricated events when checkpoint ETAs are missing', () => {
    expect(buildTripActivityTimeline({checkpoints: [{distance_miles: 0}]}, 'not-a-date')).toEqual({days: [], events: [], segments: []})
  })

  it('formats stop arrival times with their local date and time', () => {
    const value = new Date(2026, 10, 5, 15, 35)
    expect(formatTimelineDateTime(value)).toBe(value.toLocaleString([], {weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}))
    expect(formatTimelineDateTime('invalid')).toBe('Time unavailable')
  })

  it('plots scores against ETA in order and maps 0 and 100 to the chart bounds', () => {
    const events = [
      {id: 'later', time: new Date('2026-11-03T16:00:00Z'), riskScore: 100, risk: 'no_travel'},
      {id: 'earlier', time: new Date('2026-11-03T14:00:00Z'), riskScore: 0, risk: 'low'},
    ]
    const graph = buildRiskTimelineGraph(events)
    expect(graph.points.map(point => point.id)).toEqual(['earlier', 'later'])
    expect(graph.points[0].x).toBe(graph.plot.left)
    expect(graph.points[1].x).toBe(graph.width - graph.plot.right)
    expect(graph.points[0].y).toBe(graph.plot.top + graph.plot.height)
    expect(graph.points[1].y).toBe(graph.plot.top)
    expect(graph.segments).toHaveLength(1)
    expect(graph.ticks).toHaveLength(5)
  })

  it('leaves a visible gap when a checkpoint risk score is missing', () => {
    const graph = buildRiskTimelineGraph([
      {id: 'a', time: new Date('2026-11-03T14:00:00Z'), riskScore: 20, risk: 'low'},
      {id: 'b', time: new Date('2026-11-03T15:00:00Z'), riskScore: null, risk: 'unknown'},
      {id: 'c', time: new Date('2026-11-03T16:00:00Z'), riskScore: 40, risk: 'moderate'},
    ])
    expect(graph.points[1].y).toBeNull()
    expect(graph.segments).toHaveLength(0)
    expect(graph.points[1].score).toBeNull()
  })
})
