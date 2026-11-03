import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import PlannerForm from '../src/components/PlannerForm.jsx'
import {autocompletePlaces} from '../src/api.js'

vi.mock('../src/api.js', () => ({autocompletePlaces: vi.fn(), planRoute: vi.fn()}))

describe('journey planning form', () => {
  beforeEach(() => autocompletePlaces.mockReset().mockResolvedValue([]))

  it('validates required fields and weight bounds and exposes only supported intervals', () => {
    render(<PlannerForm onSubmit={vi.fn()} loading={false}/>)
    const form = document.querySelector('form')
    expect(form.checkValidity()).toBe(false)
    expect(screen.getByLabelText('Origin')).toBeRequired()
    expect(screen.getByLabelText('Destination')).toBeRequired()
    expect(screen.getByLabelText('Departure date')).toHaveAttribute('type', 'date')
    expect(screen.getByLabelText('Departure time')).toHaveAttribute('type', 'time')
    expect(screen.getByLabelText(/Load weight/)).toHaveAttribute('max', '200000')
    expect([...screen.getByLabelText('Checkpoint interval').options].map(option => option.value)).toEqual(['10', '25', '50'])
    fireEvent.change(screen.getByLabelText('Origin'), {target: {value: 'New York'}})
    fireEvent.change(screen.getByLabelText('Destination'), {target: {value: 'Boston'}})
    fireEvent.change(screen.getByLabelText(/Load weight/), {target: {value: '42000'}})
    expect(form.checkValidity()).toBe(true)
    fireEvent.change(screen.getByLabelText(/Load weight/), {target: {value: '200001'}})
    expect(form.checkValidity()).toBe(false)
  })

  it('debounces autocomplete and fills a selected provider suggestion', async () => {
    autocompletePlaces.mockResolvedValue([{label: 'New York, New York, USA', longitude: -74, latitude: 40.7}])
    render(<PlannerForm onSubmit={vi.fn()} loading={false}/>)
    fireEvent.change(screen.getByLabelText('Origin'), {target: {value: 'New York'}})
    expect(autocompletePlaces).not.toHaveBeenCalled()
    await waitFor(() => expect(autocompletePlaces).toHaveBeenCalledWith('New York', expect.any(AbortSignal)), {timeout: 1500})
    const suggestion = await screen.findByRole('option', {name: /New York, New York, USA/})
    fireEvent.click(suggestion)
    expect(screen.getByLabelText('Origin')).toHaveValue('New York, New York, USA')
  })

  it('submits backend fields with local date-time converted to UTC and pounds converted to tons', () => {
    const onSubmit = vi.fn()
    render(<PlannerForm onSubmit={onSubmit} loading={false}/>)
    fireEvent.change(screen.getByLabelText('Origin'), {target: {value: 'New York'}})
    fireEvent.change(screen.getByLabelText('Destination'), {target: {value: 'Boston'}})
    fireEvent.change(screen.getByLabelText('Departure date'), {target: {value: '2026-11-03'}})
    fireEvent.change(screen.getByLabelText('Departure time'), {target: {value: '09:30'}})
    fireEvent.change(screen.getByLabelText(/Load weight/), {target: {value: '42000'}})
    fireEvent.change(screen.getByLabelText('Checkpoint interval'), {target: {value: '50'}})
    fireEvent.submit(document.querySelector('form'))
    expect(onSubmit).toHaveBeenCalledOnce()
    const payload = onSubmit.mock.calls[0][0]
    expect(payload.origin).toBe('New York')
    expect(payload.destination).toBe('Boston')
    expect(payload.departure_time).toMatch(/Z$/)
    expect(payload.load_weight_tons).toBe(21)
    expect(payload.checkpoint_interval_miles).toBe(50)
    expect(payload).not.toHaveProperty('load_weight_lb')
  })

  it('disables submission while the API request is loading', () => {
    render(<PlannerForm onSubmit={vi.fn()} loading/>)
    expect(screen.getByRole('button', {name: /Analyzing routes/})).toBeDisabled()
  })
})
