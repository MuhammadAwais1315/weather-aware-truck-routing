import {fireEvent, render, screen} from '@testing-library/react'
import {describe, expect, it, vi} from 'vitest'
import RouteCard from '../src/components/RouteCard.jsx'
import {makeRoute} from './fixtures.js'

describe('route comparison card', () => {
  it('shows backend distance, duration, arrival, risk miles, risk average, and safety status', () => {
    const route = makeRoute('route-7', 'Actual provider route', {distance: 425.6, risk: 'high'})
    const summary = {total_distance_miles: 425.6, travel_duration_hours: 5.5, severe_miles: 12.5, high_miles: 20, average_risk: 42, no_travel_segment_count: 0}
    render(<RouteCard route={route} summary={summary} departureTime="2026-11-03T14:00:00Z" active={false} onClick={vi.fn()}/> )
    expect(screen.getByText('Actual provider route')).toBeInTheDocument()
    expect(screen.getByText('425.6')).toBeInTheDocument()
    expect(screen.getByText('5h 30m')).toBeInTheDocument()
    expect(screen.getByText('12.5 mi')).toBeInTheDocument()
    expect(screen.getByText('20 mi')).toBeInTheDocument()
    expect(screen.getByText('42 / 100')).toBeInTheDocument()
    expect(screen.getByText('SAFE')).toBeInTheDocument()
    const eta = new Date(new Date('2026-11-03T14:00:00Z').getTime() + 5.5 * 3600000)
    expect(screen.getByText(eta.toLocaleString(undefined, {weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}))).toBeInTheDocument()
  })

  it('highlights the recommended route and marks No Travel routes unsafe', () => {
    const route = {...makeRoute('route-2', 'Risky provider route', {risk: 'no_travel'}), recommended: true}
    const {container} = render(<RouteCard route={route} summary={{no_travel_segment_count: 2}} departureTime="2026-11-03T14:00:00Z" active onClick={vi.fn()}/> )
    expect(container.querySelector('.comparison-card')).toHaveClass('selected', 'recommended')
    expect(screen.getByText('BEST OPTION')).toBeInTheDocument()
    expect(screen.getByText('UNSAFE')).toBeInTheDocument()
    expect(screen.getByText('2 No Travel segments')).toBeInTheDocument()
  })

  it('fires selection with no hardcoded data behavior', () => {
    const route = makeRoute('provider-id', 'Provider route')
    const onClick = vi.fn()
    render(<RouteCard route={route} summary={{}} departureTime="2026-11-03T14:00:00Z" active={false} onClick={onClick}/> )
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })
})
