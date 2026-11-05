import {test, expect} from 'vitest'
import {validatePlanResponse} from '../src/contracts.js'
import {createRequestGate} from '../src/requestGate.js'

const response = () => ({
  origin: {label: 'A', longitude: -73.9, latitude: 40.7},
  pickup: {label: 'P', longitude: -78, latitude: 41},
  destination: {label: 'B', longitude: -87.6, latitude: 41.9},
  departure_time: '2026-11-03T14:00:00+00:00',
  recommended_route_id: 'route-1',
  routes: [{
    id: 'route-1', distance_miles: 800.2, duration_hours: 12.5,
    legs: [
      {id: 'leg-1', distance_miles: 300, duration_hours: 5, departure_time: '2026-11-03T14:00:00Z', estimated_arrival_time: '2026-11-03T19:00:00Z'},
      {id: 'leg-2', distance_miles: 500, duration_hours: 7.5, departure_time: '2026-11-03T19:00:00Z', estimated_arrival_time: '2026-11-04T02:30:00Z'},
    ],
    geometry: {type: 'LineString', coordinates: [[-73.9, 40.7], [-87.6, 41.9]]},
    checkpoints: [{
      id: 'checkpoint-1', longitude: -73.9, latitude: 40.7,
      estimated_arrival_time: '2026-11-03T14:00:00+00:00',
      weather: {available: true, forecast_time: '2026-11-03T14:00:00+00:00'},
      risk: {level: 'low', risk_label: 'Low', score: 0},
    }],
  }],
})

test('accepts the backend plan response shape and permits fewer than three real routes', () => {
  const plan = response()
  expect(validatePlanResponse(plan)).toBe(plan)
  expect(validatePlanResponse({...plan, routes: [plan.routes[0]]}).routes).toHaveLength(1)
  expect(validatePlanResponse({...plan, routes: [], recommended_route_id: null}).routes).toHaveLength(0)
})

test('rejects timezone-naive departure and checkpoint timestamps', () => {
  expect(() => validatePlanResponse({...response(), departure_time: '2026-11-03T14:00:00'})).toThrow(/timezone-naive departure/)
  const plan = response()
  plan.routes[0].checkpoints[0].estimated_arrival_time = '2026-11-03T14:00:00'
  expect(() => validatePlanResponse(plan)).toThrow(/timezone-naive Route 1 checkpoint ETA/)
})

test('rejects coordinate order/range and missing backend data instead of rendering invalid results', () => {
  const badCoordinate = response()
  badCoordinate.routes[0].geometry.coordinates[0] = [200, 40]
  expect(() => validatePlanResponse(badCoordinate)).toThrow(/expected \[longitude, latitude\]/)
  expect(() => validatePlanResponse(null)).toThrow(/empty or invalid route analysis/)
  expect(() => validatePlanResponse({...response(), routes: undefined})).toThrow(/missing the routes array/)
})

test('repeated journey submissions abort the previous request and reject its stale response', () => {
  const gate = createRequestGate()
  const first = gate.start()
  const second = gate.start()
  expect(first.signal.aborted).toBe(true)
  expect(gate.isCurrent(first)).toBe(false)
  expect(gate.isCurrent(second)).toBe(true)
  expect(gate.finish(first)).toBe(false)
  expect(gate.isCurrent(second)).toBe(true)
  expect(gate.finish(second)).toBe(true)
  expect(gate.isCurrent(second)).toBe(false)
})
