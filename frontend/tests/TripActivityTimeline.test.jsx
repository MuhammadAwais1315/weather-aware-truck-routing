import {fireEvent, render, screen} from '@testing-library/react'
import {describe, expect, it, vi} from 'vitest'
import TripActivityTimeline from '../src/components/TripActivityTimeline.jsx'
import {makeCheckpoint, makeRoute} from './fixtures.js'

vi.mock('../src/api.js', () => ({reverseGeocode: vi.fn(async () => ({label: 'Lewisville, Texas'}))}))

describe('trip activity timeline UI', () => {
  it('shows the itinerary rail with actual arrival dates, risk and weather values', () => {
    const route = makeRoute('route-1', 'Test route', {risk: 'high'})
    render(<TripActivityTimeline route={route} departureTime="2026-11-03T14:00:00Z"/>)
    expect(screen.getByRole('heading', {name: 'Trip timeline & stops'})).toBeInTheDocument()
    expect(screen.getByText('Trip start')).toBeInTheDocument()
    expect(screen.getByText('Drop-off')).toBeInTheDocument()
    expect(screen.getAllByText('High risk').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Wind 19 mph/).length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.activity-event-time')).toHaveLength(3)
    expect(screen.getByText('3 events')).toBeInTheDocument()
    expect(screen.getByRole('img', {name: /line graph of weather risk scores/i})).toBeInTheDocument()
    expect(document.querySelectorAll('.risk-point')).toHaveLength(3)
    expect(screen.getByText(/not a driver duty-status log/)).toBeInTheDocument()
  })

  it('renders all stops in route order with trip mileage', () => {
    const route = makeRoute('route-1', 'Short trip')
    render(<TripActivityTimeline route={route} departureTime="2026-11-03T14:00:00Z"/> )
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    const mileage = [...document.querySelectorAll('.activity-stop-meta')].map(item => item.textContent)
    expect(mileage[0]).toContain('0.0 mi from origin')
    expect(mileage.at(-1)).toContain('100.0 mi from origin')
    expect([...document.querySelectorAll('.activity-event-title b')].map(item => item.textContent)).toEqual(['Trip start', 'Pickup', 'Drop-off'])
  })

  it('lets the user switch days for trips that span midnight', () => {
    const route = makeRoute()
    route.checkpoints = route.checkpoints.map((point, index) => ({
      ...point,
      estimated_arrival_time: new Date(2026, 10, 3, 23, 30 + index * 50).toISOString(),
    }))
    render(<TripActivityTimeline route={route} departureTime={route.checkpoints[0].estimated_arrival_time}/>)
    const select = screen.getByRole('combobox', {name: 'Trip day'})
    expect(select.options).toHaveLength(2)
    fireEvent.change(select, {target: {value: select.options[1].value}})
    expect(screen.getByText('Drop-off')).toBeInTheDocument()
  })

  it('explains when the route has no usable checkpoint ETAs', () => {
    render(<TripActivityTimeline route={{checkpoints: []}} departureTime="2026-11-03T14:00:00Z"/>)
    expect(screen.getByText('Checkpoint arrival times are not available for this route.')).toBeInTheDocument()
  })

  it('shows a clear empty graph message when all checkpoint risks are unknown', () => {
    const route = makeRoute('route-1', 'Unknown forecast')
    route.checkpoints = route.checkpoints.map(point => ({...point, risk: {level: 'unknown', score: null, final_risk_score: null}}))
    render(<TripActivityTimeline route={route} departureTime="2026-11-03T14:00:00Z"/>)
    expect(screen.getByText('Risk scores are unavailable for these forecast checkpoints.')).toBeInTheDocument()
    expect(document.querySelector('.risk-line')).not.toBeInTheDocument()
  })

  it('labels each weather checkpoint with the nearby place name from its coordinates', async () => {
    const route = makeRoute('route-1', 'Named checkpoints')
    route.checkpoints.splice(2, 0, {
      ...makeCheckpoint('named-weather-point', -96.9942, 33.0462, 25),
      checkpoint_type: 'weather', estimated_arrival_time: '2026-11-03T15:20:00Z',
    })
    render(<TripActivityTimeline route={route} departureTime="2026-11-03T14:00:00Z"/>)
    expect(await screen.findByText('Lewisville, Texas')).toBeInTheDocument()
    const locationLine = [...document.querySelectorAll('.activity-stop-meta')].find(element => element.textContent.includes('Lewisville, Texas'))
    expect(locationLine.textContent).toContain('25.0 mi from origin')
  })
})
