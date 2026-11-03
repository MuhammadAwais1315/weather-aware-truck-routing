import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import App from '../src/App.jsx'
import {autocompletePlaces, planRoute} from '../src/api.js'
import {makePlan, makeRoute} from './fixtures.js'

vi.mock('../src/api.js', () => ({planRoute: vi.fn(), autocompletePlaces: vi.fn()}))
vi.mock('../src/components/MapView.jsx', () => import('./mocks/MapView.jsx'))

function fillRequiredFields(origin = 'New York, NY', destination = 'Boston, MA') {
  fireEvent.change(screen.getByLabelText('Origin'), {target: {value: origin}})
  fireEvent.change(screen.getByLabelText('Destination'), {target: {value: destination}})
  fireEvent.change(screen.getByLabelText(/Load weight/), {target: {value: '42000'}})
}

function submitForm() { fireEvent.submit(document.querySelector('form')) }

describe('journey dashboard integration', () => {
  beforeEach(() => {
    planRoute.mockReset()
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
    expect(screen.getByTestId('map-view')).toHaveAttribute('data-routes', 'route-1,route-2')
    expect(screen.getByRole('slider', {name: 'Forecast hour'})).toHaveAttribute('max', '48')
    const payload = planRoute.mock.calls[0][0]
    expect(payload).toMatchObject({origin: 'New York, NY', destination: 'Boston, MA', load_weight_tons: 21, checkpoint_interval_miles: 25})
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
    const secondPlan = makePlan({origin: 'Albany, NY', destination: 'Philadelphia, PA', routes: [nextRoute], recommendedId: 'route-8'})
    planRoute.mockResolvedValueOnce(firstPlan).mockResolvedValueOnce(secondPlan)
    render(<App/>)
    fillRequiredFields()
    submitForm()
    expect(await screen.findByRole('heading', {name: 'Compare 2 routes'})).toBeInTheDocument()
    expect(screen.getByTestId('map-view')).toHaveAttribute('data-routes', 'route-1,route-2')

    fillRequiredFields('Albany, NY', 'Philadelphia, PA')
    submitForm()
    expect(await screen.findByRole('heading', {name: 'Compare 1 route'})).toBeInTheDocument()
    expect(screen.queryByText('Northern corridor')).not.toBeInTheDocument()
    expect(screen.getByText('New provider alternative')).toBeInTheDocument()
    expect(screen.getByTestId('map-view')).toHaveAttribute('data-routes', 'route-8')
    expect(screen.getByTestId('map-view')).toHaveAttribute('data-selected', 'route-8')
    expect(planRoute).toHaveBeenCalledTimes(2)
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
    expect(screen.getByText('No checkpoint forecasts available for this time')).toBeInTheDocument()
    expect(screen.getByTestId('map-view')).toHaveAttribute('data-forecast-hour', '12')
  })
})
