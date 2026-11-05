import {test, expect} from 'vitest'
import {
  buildCheckpointGeoJSON,
  buildExploratoryForecastGeoJSON,
  clampForecastHour,
  getSelectedForecastTimestamp,
  getVisibleForecastCheckpoints,
} from '../src/forecast.js'

const departure = '2026-11-03T10:20:00Z'
const route = {
  id: 'ors-1',
  name: 'Provider route one',
  checkpoints: [
    {
      id: 'cp-1', latitude: 41.2, longitude: -73.8,
      estimated_arrival_time: '2026-11-03T16:15:00Z',
      weather: { available: true, forecast_time: '2026-11-03T12:00:00Z', wind_speed_mph: 36 },
      risk: { level: 'high', risk_label: 'High', score: 50 },
    },
    {
      id: 'cp-2', coordinates: [-73.5, 41.5],
      estimated_arrival_time: '2026-11-03T13:30:00Z',
      weather: { available: true, forecast_time: '2026-11-03T13:00:00Z' },
      risk: { level: 'no_travel', risk_label: 'No Travel', final_risk_score: 100, load_override: { applied: true } },
    },
    {
      id: 'cp-missing', coordinates: [-73.2, 41.8],
      estimated_arrival_time: '2026-11-03T12:20:00Z',
      weather: { available: false, forecast_time: null },
      risk: { level: 'unknown', risk_label: 'Unknown', score: null },
    },
  ],
}

test('forecast slider is clamped to whole hours from 0 to 48', () => {
  expect(clampForecastHour(-5)).toBe(0)
  expect(clampForecastHour(12.4)).toBe(12)
  expect(clampForecastHour(47.7)).toBe(48)
  expect(clampForecastHour(Number.NaN)).toBe(0)
})

test('selected forecast timestamp is calculated from departure plus slider offset', () => {
  expect(getSelectedForecastTimestamp('2026-11-03T10:20:00-05:00', 2)).toBe('2026-11-03T17:20:00.000Z')
  expect(getSelectedForecastTimestamp(departure, 48)).toBe('2026-11-05T10:20:00.000Z')
  expect(getSelectedForecastTimestamp('invalid', 12)).toBeNull()
})

test('forecast matching uses weather forecast_time and never overwrites actual trip ETA', () => {
  const matching = getVisibleForecastCheckpoints([route], departure, 2)
  expect(matching.map(item => item.checkpoint.id)).toEqual(['cp-1'])
  expect(matching[0].checkpoint.estimated_arrival_time).toBe('2026-11-03T16:15:00Z')
})

test('GeoJSON uses actual checkpoint coordinates in longitude/latitude order and severity weights', () => {
  const geojson = buildCheckpointGeoJSON([route], departure, 2)
  expect(geojson.type).toBe('FeatureCollection')
  expect(geojson.features).toHaveLength(1)
  expect(geojson.features[0].geometry.coordinates).toEqual([-73.8, 41.2])
  expect(geojson.features[0].properties.riskWeight).toBe(0.5)
  expect(geojson.features[0].properties.forecastTime).toBe('2026-11-03T12:00:00Z')
  expect(geojson.features[0].properties.tripEta).toBe('2026-11-03T16:15:00Z')
})

test('changing selected forecast time replaces features with matching forecast observations', () => {
  const atTwo = buildCheckpointGeoJSON([route], departure, 2)
  const atThree = buildCheckpointGeoJSON([route], departure, 3)
  expect(atTwo.features.map(feature => feature.properties.checkpointId)).toEqual(['cp-1'])
  expect(atThree.features.map(feature => feature.properties.checkpointId)).toEqual(['cp-2'])
  expect(atThree.features[0].properties.riskWeight).toBe(1)
})

test('missing forecast hours and unknown risk are omitted rather than shown as zero risk', () => {
  const geojson = buildCheckpointGeoJSON([route], departure, 2)
  expect(geojson.features.some(feature => feature.properties.checkpointId === 'cp-missing')).toBe(false)
  expect(buildCheckpointGeoJSON([route], departure, 24).features).toHaveLength(0)
})

test('exploratory forecast GeoJSON updates every checkpoint independently of trip ETA risk', () => {
  const forecasts = [
    {route_id: 'route-1', checkpoint_id: 'cp-1', longitude: -73.8, latitude: 41.2,
      weather: {available: true, forecast_time: '2026-11-03T16:00:00Z', wind_speed_mph: 36, rain_inches_per_hour: 0, snowfall_inches_per_hour: 0},
      risk: {risk_label: 'High', level: 'high', final_risk_score: 50}},
    {route_id: 'route-1', checkpoint_id: 'cp-2', longitude: -73.5, latitude: 41.5,
      weather: {available: true, forecast_time: '2026-11-03T16:00:00Z', wind_speed_mph: 58, rain_inches_per_hour: 0, snowfall_inches_per_hour: 0},
      risk: {risk_label: 'No Travel', level: 'no_travel', final_risk_score: 100, load_override: {applied: true, rule: 'Wind override'}}},
    {route_id: 'route-2', checkpoint_id: 'cp-3', longitude: -73.2, latitude: 41.8,
      weather: {available: false, forecast_time: null, wind_speed_mph: null},
      risk: {risk_label: 'Unknown', level: 'unknown', final_risk_score: null}},
  ]
  const geojson = buildExploratoryForecastGeoJSON(forecasts)
  expect(geojson.features).toHaveLength(3)
  expect(geojson.features[0].geometry.coordinates).toEqual([-73.8, 41.2])
  expect(geojson.features.map(feature => feature.properties.riskWeight)).toEqual([0.5, 1, null])
  expect(geojson.features[1].properties.loadOverrideRule).toBe('Wind override')
  expect(geojson.features[2].properties.weatherAvailable).toBe(false)
  expect(buildExploratoryForecastGeoJSON(forecasts, {selectedRouteId: 'route-1', includeAlternatives: false}).features).toHaveLength(2)
})
