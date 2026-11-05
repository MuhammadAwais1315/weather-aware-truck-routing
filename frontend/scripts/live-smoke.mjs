import {chromium} from '@playwright/test'

const baseURL = process.env.QA_FRONTEND_URL || 'http://127.0.0.1:5174'
const browser = await chromium.launch({channel: 'msedge', headless: true})
const page = await browser.newPage({viewport: {width: 1440, height: 1000}})
const pageErrors = []
const consoleErrors = []
const httpErrors = []
const failedRequests = []

page.on('pageerror', error => pageErrors.push(error.message))
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('response', response => {
  if (response.status() >= 400) httpErrors.push({status: response.status(), method: response.request().method(), url: response.url()})
})
page.on('requestfailed', request => failedRequests.push({url: request.url(), error: request.failure()?.errorText}))

function localDateTime(value) {
  const pad = number => String(number).padStart(2, '0')
  return {
    date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    time: `${pad(value.getHours())}:${pad(value.getMinutes())}`,
  }
}

try {
  await page.goto(baseURL)
  const departure = localDateTime(new Date(Date.now() + 60 * 60 * 1000))
  await page.getByRole('textbox', {name: 'Truck location'}).fill('New York, NY')
  await page.getByRole('textbox', {name: 'Pickup location'}).fill('Hartford, CT')
  await page.getByRole('textbox', {name: 'Final destination'}).fill('Boston, MA')
  await page.getByLabel('Departure date').fill(departure.date)
  await page.getByLabel('Departure time').fill(departure.time)
  await page.getByLabel(/Load weight/).fill('42000')
  await page.getByLabel('Checkpoint interval').selectOption('25')

  const planResponsePromise = page.waitForResponse(response => response.url().includes('/api/plan/'), {timeout: 60_000})
  await page.getByRole('button', {name: 'Analyze routes'}).click()
  const planResponse = await planResponsePromise
  const planBody = await planResponse.json().catch(() => ({}))
  await page.locator('.route-results,[role="alert"]').first().waitFor({timeout: 10_000})
  const visibleError = await page.getByRole('alert').textContent().catch(() => null)

  let forecastResponse = null
  let forecastBody = null
  if (planResponse.status() === 200 && planBody.routes?.length) {
    await page.getByRole('slider', {name: 'Forecast hour'}).fill('12')
    forecastResponse = await page.waitForResponse(response => response.url().includes('/api/weather/route-forecast/'), {timeout: 60_000})
    forecastBody = await forecastResponse.json().catch(() => ({}))
    await page.locator('.selected-forecast-time span').waitFor({timeout: 10_000})
  }

  const result = {
    frontendUrl: baseURL,
    journey: {
      httpStatus: planResponse.status(),
      routeCount: Array.isArray(planBody.routes) ? planBody.routes.length : null,
      checkpointCounts: Array.isArray(planBody.routes) ? planBody.routes.map(route => route.checkpoints?.length ?? 0) : [],
      visibleError,
    },
    selectedForecast: forecastResponse ? {
      httpStatus: forecastResponse.status(),
      requestedCheckpointCount: Array.isArray(forecastBody.forecasts) ? forecastBody.forecasts.length : null,
      availableCheckpointCount: Array.isArray(forecastBody.forecasts)
        ? forecastBody.forecasts.filter(item => item.weather?.available === true).length
        : null,
      selectedForecastTime: forecastBody.forecast_time || null,
    } : null,
    pageErrors,
    consoleErrors,
    httpErrors,
    failedRequests,
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (
    planResponse.status() !== 200 || !planBody.routes?.length
    || !forecastResponse || forecastResponse.status() !== 200
    || !Array.isArray(forecastBody.forecasts)
    || pageErrors.length || consoleErrors.length
  ) process.exitCode = 1
} finally {
  await browser.close()
}
