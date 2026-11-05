import {describe, expect, it} from 'vitest'
import {deduplicateRoutes, routesAreNearDuplicates} from '../src/routeDiversity.js'
import {makeRoute} from './fixtures.js'

describe('route geometry diversity', () => {
  it('recognizes exact and near-identical paths without discarding a different corridor', () => {
    const primary = makeRoute('route-1', 'Primary')
    const exact = {...makeRoute('route-2', 'Exact copy'), geometry: structuredClone(primary.geometry)}
    const near = {...makeRoute('route-3', 'Near copy'), geometry: {type: 'LineString', coordinates: primary.geometry.coordinates.map(([lon, lat]) => [lon + 0.0002, lat])}}
    const distinct = makeRoute('route-4', 'Alternative corridor')
    distinct.geometry.coordinates[1][0] += 0.12
    expect(routesAreNearDuplicates(primary, exact)).toBe(true)
    expect(routesAreNearDuplicates(primary, near)).toBe(true)
    expect(routesAreNearDuplicates(primary, distinct)).toBe(false)
  })

  it('keeps the recommended provider route first and returns only actual distinct routes', () => {
    const primary = makeRoute('route-1', 'Recommended')
    const duplicate = {...makeRoute('route-2', 'Duplicate'), geometry: structuredClone(primary.geometry)}
    const alternative = makeRoute('route-3', 'Distinct alternative')
    const result = deduplicateRoutes([duplicate, alternative, primary], 'route-1')
    expect(result.routes.map(route => route.id)).toEqual(['route-1', 'route-3'])
    expect(result.removed).toBe(1)
    expect(result.routes[0]).toBe(primary)
  })

  it('does not fabricate alternatives when fewer distinct provider routes exist', () => {
    const onlyRoute = makeRoute('route-1', 'Only route')
    const result = deduplicateRoutes([onlyRoute, {...onlyRoute, id: 'route-2'}], 'route-1')
    expect(result.routes).toEqual([onlyRoute])
    expect(result.removed).toBe(1)
  })
})
