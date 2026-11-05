import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import App from '../src/App.jsx'
import {autocompletePlaces, fetchRouteForecast, planRoute} from '../src/api.js'
import {makePlan, makeRoute} from './fixtures.js'

vi.mock('../src/api.js', () => ({planRoute: vi.fn(), fetchRouteForecast: vi.fn(), autocompletePlaces: vi.fn()}))
vi.mock('../src/components/MapView.jsx', () => import('./mocks/MapView.jsx'))

function fillRequiredFields(origin = 'New York, NY', pickup = 'Hartford, CT', destination = 'Boston, MA') {
  fireEvent.change(screen.getByLabelText('Truck location'), {target: {value: origin}})
  fireEvent.change(screen.getByLabelText('Pickup location'), {target: {value: pickup}})
  fireEvent.change(screen.getByLabelText('Final destination'), {target: {value: destination}})
  fireEvent.change(screen.getByLabelText(/Load weight/), {target: {value: '42000'}})
}

function submitForm() { fireEvent.submit(document.querySelector('form')) }

describe('journey dashboard integration', () => {
  beforeEach(() => {
    planRoute.mockReset()
    fetchRouteForecast.mockReset().mockResolvedValue({forecasts: []})
    autocompletePlaces.mockReset().mockResolvedValue([])
  })

  it('submits a journey and displays backend routes, recommendation, map and forecast controls', async () => {
    const plan = makePlan()
    planRoute.mockResolvedValue(plan)
    render(<App/>)
    fillRequiredFields()
    submitForm()

    expect(await screen.findByRole('heading', {name: 'Compare 2 routes'})).toBeInTheDocument()
    expect(screen.getByText('BEST OPTION')).toBeInTheDocument()
    expect(screen.getByText('Recommended route')).toBeInTheDocument()
    expect(await screen.findByTestId('map-view')).toHaveAttribute('data-routes', 'route-1,route-2')
    expect(screen.getByRole('slider', {name: 'Forecast hour'})).toHaveAttribute('max', '48')
    fireEvent.click(screen.getByRole('tab', {name: 'Timeline'}))
    expect(await screen.findByRole('heading', {name: 'Trip timeline & stops'})).toBeInTheDocument()
    expect(screen.queryByRole('slider', {name: 'Forecast hour'})).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', {name: 'Map'}))
    expect(screen.getByTestId('map-view')).toBeInTheDocument()
    expect(screen.getByRole('slider', {name: 'Forecast hour'})).toBeInTheDocument()
    const payload = planRoute.mock.calls[0][0]
    expect(payload).toMatchObject({origin: 'New York, NY', pickup: 'Hartford, CT', destination: 'Boston, MA', load_weight_tons: 21, checkpoint_interval_miles: 25})
    expect(payload.departure_time).toMatch(/Z$/)
  })

  it('shows loading feedback and clears it after an API response', async () => {
    let resolveRequest
    planRoute.mockImplementation(() => new Promise(resolve => {resolveRequest = resolve}))
    render(<App/>)
    fillRequiredFields()
    submitForm()
    expect(screen.getByRole('status')).toHaveTextContent('Analyzing your journey')
    expect(screen.getByRole('button', {name: /Analyzing routes/})).toBeDisabled()
    resolveRequest(makePlan())
    expect(await screen.findByRole('heading', {name: 'Compare 2 routes'})).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  })

  it('reports backend errors without leaving a loading state', async () => {
    planRoute.mockRejectedValue({response: {data: {error: 'OpenRouteService is unavailable.'}}})
    render(<App/>)
    fillRequiredFields()
    submitForm()
    expect(await screen.findByRole('alert')).toHaveTextContent('OpenRouteService is unavailable.')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('repeated journey submissions remove old route cards and map route data', async () => {
    const firstPlan = makePlan()
    const nextRoute = makeRoute('route-8', 'New provider alternative', {recommended: true, distance: 350})
    const secondPlan = makePlan({origin: 'Albany, NY', pickup: 'New York, NY', destination: 'Philadelphia, PA', routes: [nextRoute], recommendedId: 'route-8'})
    planRoute.mockResolvedValueOnce(firstPlan).mockResolvedValueOnce(secondPlan)
    render(<App/>)
    fillRequiredFields()
    submitForm()
    expect(await screen.findByRole('heading', {name: 'Compare 2 routes'})).toBeInTheDocument()
    expect(screen.getByTestId('map-view')).toHaveAttribute('data-routes', 'route-1,route-2')

    fillRequiredFields('Albany, NY', 'New York, NY', 'Philadelphia, PA')
    submitForm()
    expect(await screen.findByRole('heading', {name: 'Compare 1 route'})).toBeInTheDocument()
    expect(screen.queryByText('Northern corridor')).not.toBeInTheDocument()
    expect(screen.getByText('New provider alternative')).toBeInTheDocument()
    expect(screen.getByTestId('map-view')).toHaveAttribute('data-routes', 'route-8')
    expect(screen.getByTestId('map-view')).toHaveAttribute('data-selected', 'route-8')
    expect(planRoute).toHaveBeenCalledTimes(2)
  })

  it('removes duplicate provider routes before rendering cards and map layers', async () => {
    const recommended = makeRoute('route-1', 'Recommended corridor', {recommended: true})
    const duplicate = {...makeRoute('route-2', 'Repeated corridor'), geometry: structuredClone(recommended.geometry)}
    planRoute.mockResolvedValue(makePlan({routes: [recommended, duplicate], recommendedId: 'route-1'}))
    render(<App/>)
    fillRequiredFields()
    submitForm()
    expect(await screen.findByRole('heading', {name: 'Compare 1 route'})).toBeInTheDocument()
    expect(screen.getByText('Recommended corridor')).toBeInTheDocument()
    expect(screen.queryByText('Repeated corridor')).not.toBeInTheDocument()
    expect(screen.getByTestId('map-view')).toHaveAttribute('data-routes', 'route-1')
    expect(screen.getByText(/near-identical route was removed/i)).toBeInTheDocument()
  })

  it('shows three genuinely different provider route geometries when all are returned', async () => {
    const routes = [1, 2, 3].map(index => makeRoute(`route-${index}`, `Provider corridor ${index}`, {recommended: index === 2, distance: 100 + index}))
    const plan = makePlan({routes, recommendedId: 'route-2'})
    planRoute.mockResolvedValue(plan)
    render(<App/>)
    fillRequiredFields()
    submitForm()
    expect(await screen.findByRole('heading', {name: 'Compare 3 routes'})).toBeInTheDocument()
    expect(screen.getByTestId('map-view')).toHaveAttribute('data-routes', 'route-2,route-1,route-3')
    expect(screen.getByText('Provider corridor 1')).toBeInTheDocument()
    expect(screen.getByText('Provider corridor 2')).toBeInTheDocument()
    expect(screen.getByText('Provider corridor 3')).toBeInTheDocument()
    expect(screen.getByText('BEST OPTION')).toBeInTheDocument()
  })

  it('clearly marks every route unsafe when none has a safe recommendation', async () => {
    const routes = [1, 2].map(index => {
      const route = makeRoute(`route-${index}`, `Unsafe corridor ${index}`)
      route.recommended = false
      route.metrics = {...route.metrics, no_travel_segments: 1, average_risk: 100}
      return route
    })
    const plan = makePlan({routes, recommendedId: null})
    plan.recommendation_status = 'all_unsafe'
    plan.ranking_explanation = 'No safe route available: every route contains a No Travel segment.'
    plan.route_summaries = routes.map(route => ({
      route_id: route.id,
      safety_status: 'unsafe',
      no_travel_segment_count: 1,
      severe_miles: 0,
      high_miles: 0,
      average_risk: 100,
    }))
    planRoute.mockResolvedValue(plan)
    render(<App/>)
    fillRequiredFields()
    submitForm()

    expect(await screen.findByRole('heading', {name: 'Compare 2 routes'})).toBeInTheDocument()
    expect(screen.getByText('No safe route available')).toBeInTheDocument()
    expect(screen.getAllByText('NO TRAVEL')).toHaveLength(2)
    expect(screen.queryByText('BEST OPTION')).not.toBeInTheDocument()
  })

  it('forecast exploration updates timestamp and clearly handles unavailable forecast hours', async () => {
    planRoute.mockResolvedValue(makePlan())
    render(<App/>)
    fillRequiredFields()
    submitForm()
    await screen.findByRole('heading', {name: 'Compare 2 routes'})
    const slider = screen.getByRole('slider', {name: 'Forecast hour'})
    fireEvent.change(slider, {target: {value: '12'}})
    expect(screen.getByText('+12')).toBeInTheDocument()
    await waitFor(()=>expect(fetchRouteForecast).toHaveBeenCalled())
    expect(await screen.findByText('0 of 0 checkpoint forecasts available')).toBeInTheDocument()
    expect(fetchRouteForecast).toHaveBeenLastCalledWith(expect.objectContaining({
      forecast_time:'2026-11-04T02:00:00.000Z',
      checkpoints:expect.arrayContaining([expect.objectContaining({route_id:'route-1',checkpoint_id:'route-1-cp-1',latitude:40.7,longitude:-74})]),
    }))
    expect(fetchRouteForecast.mock.calls.at(-1)[0].checkpoints).toHaveLength(6)
    expect(planRoute).toHaveBeenCalledTimes(1)
  })

  it('renders available selected-hour weather for every route checkpoint', async () => {
    planRoute.mockResolvedValue(makePlan())
    fetchRouteForecast.mockImplementation(async ({checkpoints, forecast_time}) => ({
      forecast_time,
      forecasts: checkpoints.map(point => ({
        ...point,
        weather: {available: true, forecast_time, wind_speed_mph: 12, rain_inches_per_hour: 0, snowfall_inches_per_hour: 0},
        risk: {level: 'low', risk_label: 'Low', final_risk_score: 0, score: 0, load_override: {applied: false}},
      })),
    }))
    render(<App/>)
    fillRequiredFields()
    submitForm()

    expect(await screen.findByRole('heading', {name: 'Compare 2 routes'})).toBeInTheDocument()
    expect(await screen.findByText('6 of 6 checkpoint forecasts available')).toBeInTheDocument()
  })
})
