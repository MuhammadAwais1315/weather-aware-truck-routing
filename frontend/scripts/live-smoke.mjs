import {chromium} from '@playwright/test'

const baseURL = process.env.QA_FRONTEND_URL || 'http://127.0.0.1:5174'
const browser = await chromium.launch({channel: 'msedge', headless: true})
const page = await browser.newPage({viewport: {width: 1440, height: 1000}})
const pageErrors = []
const consoleErrors = []
const httpErrors = []
const failedRequests = []
let planResponse

page.on('pageerror', error => pageErrors.push(error.message))
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('response', response => {
  if (response.url().includes('/api/plan/')) planResponse = response
  if (response.status() >= 400) httpErrors.push({status: response.status(), method: response.request().method(), url: response.url()})
})
page.on('requestfailed', request => failedRequests.push({url: request.url(), error: request.failure()?.errorText}))

try {
  await page.goto(baseURL)
  await page.getByRole('textbox', {name: 'Origin'}).fill('New York, NY')
  await page.getByRole('textbox', {name: 'Destination'}).fill('Boston, MA')
  await page.getByLabel('Departure date').fill('2026-11-03')
  await page.getByLabel('Departure time').fill('18:00')
  await page.getByLabel(/Load weight/).fill('42000')
  await page.getByLabel('Checkpoint interval').selectOption('25')
  await page.getByRole('button', {name: 'Analyze routes'}).click()
  await page.waitForResponse(response => response.url().includes('/api/plan/'), {timeout: 60_000})
  const responseBody = await planResponse.json().catch(() => ({}))
  await page.locator('.route-results,[role="alert"]').first().waitFor({timeout: 10_000})
  const alert = await page.getByRole('alert').textContent().catch(() => null)
  const result = {
    frontendUrl: baseURL,
    planStatus: planResponse.status(),
    responseBody,
    visibleError: alert,
    pageErrors,
    consoleErrors,
    httpErrors,
    failedRequests,
    liveRoutesReturned: Array.isArray(responseBody.routes) ? responseBody.routes.length : null,
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (planResponse.status() !== 200 || !responseBody.routes?.length || pageErrors.length || consoleErrors.length) process.exitCode = 1
} finally {
  await browser.close()
}
