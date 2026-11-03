import {test, expect} from '@playwright/test'
import {makePlan, makeRoute} from '../tests/fixtures.js'

async function stubProviders(page, plans, {planDelay = 0} = {}) {
  const requests = []
  await page.route('**/api/geocode/autocomplete/**', route => route.fulfill({json: {suggestions: [
    {label: 'New York, NY, USA', longitude: -74, latitude: 40.7},
    {label: 'Newark, NJ, USA', longitude: -74.17, latitude: 40.73},
  ]}}))
  await page.route('**/api/plan/', async route => {
    const request = route.request().postDataJSON()
    requests.push(request)
    const planIndex = Math.min(requests.length - 1, plans.length - 1)
    if (planDelay) await new Promise(resolve => setTimeout(resolve, planDelay))
    await route.fulfill({status: 200, json: plans[planIndex]})
  })
  await page.route('https://demotiles.maplibre.org/style.json', route => route.fulfill({
    status: 200,
    headers: {'access-control-allow-origin': '*'},
    json: {version: 8, name: 'Test map', sources: {}, layers: [{id: 'background', type: 'background', paint: {'background-color': '#eef2ef'}}]},
  }))
  return requests
}

async function fillJourney(page, {origin = 'New York, NY', destination = 'Boston, MA'} = {}) {
  await page.getByRole('textbox', {name: 'Origin'}).fill(origin)
  await page.getByRole('textbox', {name: 'Destination'}).fill(destination)
  await page.getByLabel('Departure date').fill('2026-11-03')
  await page.getByLabel('Departure time').fill('09:30')
  await page.getByLabel(/Load weight/).fill('42000')
  await page.getByLabel('Checkpoint interval').selectOption('25')
}

test('autocomplete, journey API integration, route recommendation, map, and forecast slider', async ({page}) => {
  const plans = [makePlan()]
  const requests = await stubProviders(page, plans, {planDelay: 350})
  await page.goto('/')
  await page.getByRole('textbox', {name: 'Origin'}).fill('New York')
  const option = page.getByRole('option', {name: 'New York, NY, USA'})
  await expect(option).toBeVisible({timeout: 5000})
  await option.click()
  await page.getByLabel('Destination').fill('Boston, MA')
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
  await expect(page.getByRole('slider', {name: 'Forecast hour'})).toHaveAttribute('max', '48')
  await page.getByRole('slider', {name: 'Forecast hour'}).fill('12')
  await expect(page.getByText('+12')).toBeVisible()
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({origin: 'New York, NY, USA', destination: 'Boston, MA', load_weight_tons: 21, checkpoint_interval_miles: 25})
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
  const second = makePlan({origin: 'Albany, NY', destination: 'Philadelphia, PA', routes: [replacementRoute], recommendedId: 'route-9'})
  const requests = await stubProviders(page, [first, second])
  await page.goto('/')
  await fillJourney(page)
  await page.getByRole('button', {name: 'Analyze routes'}).click()
  await expect(page.getByRole('heading', {name: 'Compare 2 routes'})).toBeVisible()
  await expect(page.locator('.map-wrap .map-canvas')).toHaveCount(1)
  await fillJourney(page, {origin: 'Albany, NY', destination: 'Philadelphia, PA'})
  await page.getByRole('button', {name: 'Analyze routes'}).click()
  await expect(page.getByRole('heading', {name: 'Compare 1 route'})).toBeVisible()
  await expect(page.getByText('Replacement provider route')).toBeVisible()
  await expect(page.getByText('Northern corridor')).toHaveCount(0)
  await expect(page.locator('.map-wrap .map-canvas')).toHaveCount(1)
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(1)
  expect(requests).toHaveLength(2)
  expect(requests[1]).toMatchObject({origin: 'Albany, NY', destination: 'Philadelphia, PA'})
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
  }
})
