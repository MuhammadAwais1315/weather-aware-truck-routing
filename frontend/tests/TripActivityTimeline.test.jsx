import {fireEvent, render, screen} from '@testing-library/react'
import {describe, expect, it} from 'vitest'
import TripActivityTimeline from '../src/components/TripActivityTimeline.jsx'
import {makeRoute} from './fixtures.js'

describe('trip activity timeline UI', () => {
  it('shows real route checkpoints, local ETAs, risk and weather values', () => {
    const route = makeRoute('route-1', 'Test route', {risk: 'high'})
    render(<TripActivityTimeline route={route} departureTime="2026-11-03T14:00:00Z"/>)
    expect(screen.getByRole('heading', {name: 'Estimated route timeline'})).toBeInTheDocument()
    expect(screen.getByText('Depart')).toBeInTheDocument()
    expect(screen.getByText('Arrive')).toBeInTheDocument()
    expect(screen.getAllByText('High').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/mph wind/).length).toBeGreaterThan(0)
    expect(screen.getByText(/not a driver duty-status log/)).toBeInTheDocument()
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
    expect(screen.getByText('Arrive')).toBeInTheDocument()
  })

  it('explains when the route has no usable checkpoint ETAs', () => {
    render(<TripActivityTimeline route={{checkpoints: []}} departureTime="2026-11-03T14:00:00Z"/>)
    expect(screen.getByText('Checkpoint arrival times are not available for this route.')).toBeInTheDocument()
  })
})
