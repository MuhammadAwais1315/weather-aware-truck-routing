import {beforeEach, describe, expect, it, vi} from 'vitest'

const axiosMock = vi.hoisted(() => ({post: vi.fn(), createOptions: null}))
vi.mock('axios', () => ({default: {create: options => {axiosMock.createOptions = options; return {post: axiosMock.post}}}}))

import {fetchRouteForecast, planRoute} from '../src/api.js'
import {makePlan} from './fixtures.js'

describe('Django route analysis API client', () => {
  beforeEach(() => axiosMock.post.mockReset())

  it('posts the exact plan payload to the Django route endpoint and validates its response', async () => {
    const payload = {
      origin: 'New York, NY', pickup: 'Hartford, CT', destination: 'Boston, MA', departure_time: '2026-11-03T14:00:00.000Z',
      load_weight_tons: 21, checkpoint_interval_miles: 25,
    }
    const response = makePlan()
    const signal = new AbortController().signal
    axiosMock.post.mockResolvedValue({data: response})
    await expect(planRoute(payload, signal)).resolves.toBe(response)
    expect(axiosMock.createOptions).toMatchObject({baseURL: expect.stringContaining('/api'), timeout: expect.any(Number)})
    expect(axiosMock.post).toHaveBeenCalledWith('/plan/', payload, {signal})
  })

  it('rejects incomplete Django responses instead of showing empty or stale results', async () => {
    axiosMock.post.mockResolvedValue({data: {routes: []}})
    await expect(planRoute({})).rejects.toThrow(/missing valid origin geocoding data/)
  })

  it('posts the exploratory forecast timestamp and every checkpoint to the forecast endpoint', async () => {
    const payload = {
      forecast_time: '2026-11-03T16:00:00.000Z', load_weight_tons: 21,
      checkpoints: [{route_id: 'route-1', route_name: 'Route 1', checkpoint_id: 'cp-1', latitude: 40.7, longitude: -74}],
    }
    const response = {forecast_time: payload.forecast_time, forecasts: []}
    const signal = new AbortController().signal
    axiosMock.post.mockResolvedValue({data: response})
    await expect(fetchRouteForecast(payload, signal)).resolves.toBe(response)
    expect(axiosMock.post).toHaveBeenCalledWith('/weather/route-forecast/', payload, {signal})
  })
})
