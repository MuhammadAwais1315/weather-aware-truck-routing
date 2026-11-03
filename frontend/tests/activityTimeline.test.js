import {describe, expect, it} from 'vitest'
import {buildTripActivityTimeline, getTimelineEventPosition} from '../src/activityTimeline.js'

function makePoint(id, date, miles, risk = 'low') {
  return {id, distance_from_origin_miles: miles, estimated_arrival_time: date.toISOString(), risk: {level: risk}, weather: {wind_speed_mph: 12, rain_inches_per_hour: 0.1, snowfall_inches_per_hour: 0}}
}

describe('estimated trip activity timeline', () => {
  it('builds departure, weather checkpoint, arrival, and driving segments from actual checkpoint ETAs', () => {
    const start = new Date(2026, 10, 3, 14, 0)
    const middle = new Date(2026, 10, 3, 15, 0)
    const end = new Date(2026, 10, 3, 16, 30)
    const route = {id: 'route-1', checkpoints: [makePoint('a', start, 0), makePoint('b', middle, 25, 'high'), makePoint('c', end, 52)]}
    const model = buildTripActivityTimeline(route, start.toISOString())
    expect(model.events.map(event => event.title)).toEqual(['Depart', 'Weather checkpoint', 'Arrive'])
    expect(model.events[1]).toMatchObject({distance: 25, risk: 'high', day: model.days[0].key})
    expect(model.segments).toHaveLength(2)
    expect(model.segments.map(segment => segment.start.getTime())).toEqual([start.getTime(), middle.getTime()])
    expect(model.segments.map(segment => segment.end.getTime())).toEqual([middle.getTime(), end.getTime()])
    expect(model.segments[0].width).toBeCloseTo(100 / 24, 4)
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

  it('calculates a local-time position in the 24-hour track', () => {
    expect(getTimelineEventPosition(new Date(2026, 10, 3, 6, 0))).toBeCloseTo(25)
    expect(getTimelineEventPosition('invalid')).toBeNull()
  })
})
