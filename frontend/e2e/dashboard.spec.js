import {test, expect} from '@playwright/test'
import {makeCheckpoint, makePlan, makeRoute} from '../tests/fixtures.js'

async function stubProviders(page, plans, {planDelay = 0} = {}) {
  const requests = []
  const forecastRequests = []
  await page.route('**/api/geocode/autocomplete/**', route => route.fulfill({json: {suggestions: [
    {label: 'New York, NY, USA', longitude: -74, latitude: 40.7},
    {label: 'Newark, NJ, USA', longitude: -74.17, latitude: 40.73},
  ]}}))
  await page.route('**/geocode/reverse**', route => route.fulfill({json: {label: 'Lewisville, Texas', display_name: 'Lewisville, Denton County, Texas, United States'}}))
  await page.route('**/api/plan/', async route => {
    const request = route.request().postDataJSON()
    requests.push(request)
    const planIndex = Math.min(requests.length - 1, plans.length - 1)
    if (planDelay) await new Promise(resolve => setTimeout(resolve, planDelay))
    await route.fulfill({status: 200, json: plans[planIndex]})
  })
  await page.route('**/api/weather/route-forecast/', async route => {
    const request = route.request().postDataJSON()
    forecastRequests.push(request)
    const later = new Date(request.forecast_time).getTime() - new Date('2026-11-03T14:00:00Z').getTime() >= 12 * 60 * 60 * 1000
    const risk = later
      ? {level: 'severe', risk_label: 'Severe', final_risk_score: 75, score: 75, load_override: {applied: false}, explanation: 'Fixture exploratory severe risk.'}
      : {level: 'low', risk_label: 'Low', final_risk_score: 0, score: 0, load_override: {applied: false}, explanation: 'Fixture exploratory low risk.'}
    await route.fulfill({status: 200, json: {forecast_time: request.forecast_time, forecasts: request.checkpoints.map(point => ({
      ...point,
      weather: {available: true, forecast_time: request.forecast_time, wind_speed_mph: later ? 46 : 10, rain_inches_per_hour: 0, snowfall_inches_per_hour: 0},
      risk,
    }))}})
  })
  await page.route('https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json', route => route.fulfill({
    status: 200,
    headers: {'access-control-allow-origin': '*'},
    json: {version: 8, name: 'Test map', sources: {}, layers: [{id: 'background', type: 'background', paint: {'background-color': '#eef2ef'}}]},
  }))
  requests.forecastRequests = forecastRequests
  return requests
}

async function fillJourney(page, {origin = 'New York, NY', pickup = 'Hartford, CT', destination = 'Boston, MA'} = {}) {
  await page.getByRole('textbox', {name: 'Truck location'}).fill(origin)
  await page.getByRole('textbox', {name: 'Pickup location'}).fill(pickup)
  await page.getByRole('textbox', {name: 'Final destination'}).fill(destination)
  await page.getByLabel('Departure date').fill('2026-11-03')
  await page.getByLabel('Departure time').fill('09:30')
  await page.getByLabel(/Load weight/).fill('42000')
  await page.getByLabel('Checkpoint interval').selectOption('25')
}

test('autocomplete, journey API integration, route recommendation, map, and forecast slider', async ({page}) => {
  const plans = [makePlan()]
  const requests = await stubProviders(page, plans, {planDelay: 350})
  await page.goto('/')
  await page.getByRole('textbox', {name: 'Truck location'}).fill('New York')
  const option = page.getByRole('option', {name: 'New York, NY, USA'})
  await expect(option).toBeVisible({timeout: 5000})
  await option.click()
  await page.getByLabel('Pickup location').fill('Hartford, CT')
  await page.getByLabel('Final destination').fill('Boston, MA')
  await page.getByLabel('Departure date').fill('2026-11-03')
  await page.getByLabel('Departure time').fill('09:30')
  await page.getByLabel(/Load weight/).fill('42000')
  await page.getByLabel('Checkpoint interval').selectOption('25')
  await page.getByRole('button', {name: 'Analyze routes'}).click()
  await expect(page.getByRole('status')).toContainText('Analyzing your journey')
  await expect(page.getByRole('heading', {name: 'Compare 2 routes'})).toBeVisible()
  await expect(page.getByText('BEST OPTION')).toBeVisible()
  await expect(page.getByText('Recommended route', {exact: true})).toBeVisible()
  await expect(page.locator('.map-wrap .map-canvas')).toHaveCount(1)
  await page.getByRole('tab', {name: 'Timeline'}).click()
  await expect(page.getByRole('heading', {name: 'Trip timeline & stops'})).toBeVisible()
  await expect(page.locator('.activity-event-list').getByText('Trip start', {exact: true})).toBeVisible()
  const itineraryBeforeRiskGraph = await page.locator('.activity-event-list').evaluate(list => list.compareDocumentPosition(document.querySelector('.risk-timeline')) & Node.DOCUMENT_POSITION_FOLLOWING)
  expect(itineraryBeforeRiskGraph).toBeTruthy()
  await expect(page.locator('.activity-event-time')).toHaveCount(3)
  await expect(page.getByRole('img', {name: /line graph of weather risk scores/i})).toBeVisible()
  await expect(page.locator('.risk-point')).toHaveCount(3)
  await page.getByRole('tab', {name: 'Map'}).click()
  await expect(page.locator('.map-wrap .map-canvas')).toHaveCount(1)
  await expect(page.locator('.maplibregl-canvas')).toBeVisible()
  const renderedMapSize = await page.locator('.maplibregl-canvas').evaluate(canvas => ({width: canvas.width, height: canvas.height}))
  expect(renderedMapSize.width).toBeGreaterThan(0)
  expect(renderedMapSize.height).toBeGreaterThan(0)
  await expect(page.getByRole('slider', {name: 'Forecast hour'})).toHaveAttribute('max', '48')
  await page.getByRole('slider', {name: 'Forecast hour'}).fill('12')
  await expect(page.getByText('+12')).toBeVisible()
  await expect.poll(() => requests.forecastRequests.at(-1)?.forecast_time).toBe('2026-11-04T02:00:00.000Z')
  expect(requests.forecastRequests.at(-1).checkpoints).toHaveLength(6)
  await expect.poll(() => page.locator('.selected-forecast-time span').innerText()).toBe('6 of 6 checkpoint forecasts available')
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({origin: 'New York, NY, USA', pickup: 'Hartford, CT', destination: 'Boston, MA', load_weight_tons: 21, checkpoint_interval_miles: 25})
  expect(requests[0].departure_time).toMatch(/Z$/)
})

test('error and loading messages are usable when the plan endpoint fails', async ({page}) => {
  await stubProviders(page, [makePlan()], {planDelay: 250})
  await page.route('**/api/plan/', async route => {
    await new Promise(resolve => setTimeout(resolve, 250))
    await route.fulfill({status: 502, json: {error: 'The routing service is unavailable.', code: 'routing_provider_error'}})
  })
  await page.goto('/')
  await fillJourney(page)
  await page.getByRole('button', {name: 'Analyze routes'}).click()
  await expect(page.getByRole('status')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('The routing service is unavailable.')
  await expect(page.getByRole('status')).toHaveCount(0)
})

test('a second journey submission removes old route cards and old map instance', async ({page}) => {
  const first = makePlan()
  const replacementRoute = makeRoute('route-9', 'Replacement provider route', {recommended: true, distance: 333})
  const second = makePlan({origin: 'Albany, NY', pickup: 'New York, NY', destination: 'Philadelphia, PA', routes: [replacementRoute], recommendedId: 'route-9'})
  const requests = await stubProviders(page, [first, second])
  await page.goto('/')
  await fillJourney(page)
  await page.getByRole('button', {name: 'Analyze routes'}).click()
  await expect(page.getByRole('heading', {name: 'Compare 2 routes'})).toBeVisible()
  await expect(page.locator('.map-wrap .map-canvas')).toHaveCount(1)
  await fillJourney(page, {origin: 'Albany, NY', pickup: 'New York, NY', destination: 'Philadelphia, PA'})
  await page.getByRole('button', {name: 'Analyze routes'}).click()
  await expect(page.getByRole('heading', {name: 'Compare 1 route'})).toBeVisible()
  await expect(page.getByText('Replacement provider route')).toBeVisible()
  await expect(page.getByText('Northern corridor')).toHaveCount(0)
  await expect(page.locator('.map-wrap .map-canvas')).toHaveCount(1)
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(1)
  expect(requests).toHaveLength(2)
  expect(requests[1]).toMatchObject({origin: 'Albany, NY', pickup: 'New York, NY', destination: 'Philadelphia, PA'})
})

test('weather checkpoints are labeled with their nearby place names', async ({page}) => {
  const route = makeRoute('route-1', 'Named checkpoint route')
  route.checkpoints.splice(2, 0, {
    ...makeCheckpoint('weather-denton', -96.9942, 33.0462, 25),
    checkpoint_type: 'weather', estimated_arrival_time: '2026-11-03T15:20:00Z',
  })
  const plan = makePlan({routes: [route], recommendedId: 'route-1'})
  await stubProviders(page, [plan])
  await page.goto('/')
  await fillJourney(page)
  await page.getByRole('button', {name: 'Analyze routes'}).click()
  await expect(page.getByRole('heading', {name: 'Compare 1 route'})).toBeVisible()
  await page.getByRole('tab', {name: 'Timeline'}).click()
  await expect(page.getByText('Lewisville, Texas')).toBeVisible()
  await expect(page.locator('.activity-stop-meta').filter({hasText: 'Lewisville, Texas'})).toContainText('25.0 mi from origin')
})

test('dashboard fits mobile, tablet, and desktop widths without horizontal overflow', async ({page}) => {
  await stubProviders(page, [makePlan()])
  await page.goto('/')
  await fillJourney(page)
  await page.getByRole('button', {name: 'Analyze routes'}).click()
  await expect(page.getByRole('heading', {name: 'Compare 2 routes'})).toBeVisible()
  for (const viewport of [{width: 390, height: 844}, {width: 768, height: 1024}, {width: 1440, height: 1000}]) {
    await page.setViewportSize(viewport)
    await expect(page.locator('.route-results')).toBeVisible()
    const dimensions = await page.evaluate(() => ({width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth}))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1)
    await expect(page.getByRole('slider', {name: 'Forecast hour'})).toBeVisible()
    await page.getByRole('tab', {name: 'Timeline'}).click()
    await expect(page.getByRole('heading', {name: 'Trip timeline & stops'})).toBeVisible()
    await expect(page.getByRole('img', {name: /line graph of weather risk scores/i})).toBeVisible()
    await expect(page.locator('.activity-event-list li')).toHaveCount(3)
    await expect(page.locator('.activity-event-time')).toHaveCount(3)
    await expect(page.locator('.activity-event-time').first()).toContainText('Nov')
    const timelineDimensions = await page.locator('.trip-activity-view').evaluate(element => ({width: element.clientWidth, scrollWidth: element.scrollWidth}))
    expect(timelineDimensions.scrollWidth).toBeLessThanOrEqual(timelineDimensions.width + 1)
    expect(await page.locator('.activity-event-list').evaluate(element => getComputedStyle(element).overflowY)).toBe('visible')
    await page.getByRole('tab', {name: 'Map'}).click()
  }
})
