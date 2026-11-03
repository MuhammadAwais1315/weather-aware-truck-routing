import {beforeEach, describe, expect, it, vi} from 'vitest'

const axiosMock = vi.hoisted(() => ({post: vi.fn(), createOptions: null}))
vi.mock('axios', () => ({default: {create: options => {axiosMock.createOptions = options; return {post: axiosMock.post}}}}))

import {planRoute} from '../src/api.js'
import {makePlan} from './fixtures.js'

describe('Django route analysis API client', () => {
  beforeEach(() => axiosMock.post.mockReset())

  it('posts the exact plan payload to the Django route endpoint and validates its response', async () => {
    const payload = {
      origin: 'New York, NY', destination: 'Boston, MA', departure_time: '2026-11-03T14:00:00.000Z',
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
})
