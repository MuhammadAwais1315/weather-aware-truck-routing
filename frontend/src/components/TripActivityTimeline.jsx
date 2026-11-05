import {useMemo, useState} from 'react'
import {buildTripActivityTimeline, formatTimelineDateTime} from '../activityTimeline.js'

const weatherSummary = weather => {
  if (!weather || weather.available === false) return 'Forecast unavailable'
  const wind = weather.wind_speed_mph == null ? null : `Wind ${Number(weather.wind_speed_mph).toFixed(0)} mph`
  const rain = weather.rain_inches_per_hour == null ? null : `Rain ${Number(weather.rain_inches_per_hour).toFixed(2)} in/hr`
  const snow = weather.snowfall_inches_per_hour == null ? null : `Snow ${Number(weather.snowfall_inches_per_hour).toFixed(2)} in/hr`
  return [wind, rain, snow].filter(Boolean).join(' · ') || 'Weather values unavailable'
}

const RISK_LABELS = {no_travel: 'No travel', severe: 'Severe', high: 'High', moderate: 'Moderate', low: 'Low', unknown: 'Unknown'}
const STOP_META = {
  start: {icon: '▶', title: 'Trip start'},
  pickup: {icon: '⬆', title: 'Pickup'},
  dropoff: {icon: '⬇', title: 'Drop-off'},
  weather: {icon: '☁', title: 'Weather checkpoint'},
}

export default function TripActivityTimeline({route, departureTime}) {
  const model = useMemo(() => buildTripActivityTimeline(route, departureTime), [route, departureTime])
  const [selectedDay, setSelectedDay] = useState('')
  const dayKey = model.days.some(day => day.key === selectedDay) ? selectedDay : model.days[0]?.key
  const dayEvents = model.events.filter(event => event.day === dayKey)

  if (!model.events.length) {
    return <section className="trip-activity-view" aria-label="Trip activity timeline"><p className="activity-empty">Checkpoint arrival times are not available for this route.</p></section>
  }

  return (
    <section className="trip-activity-view" aria-label="Trip activity timeline">
      <div className="activity-heading">
        <div>
          <span className="section-kicker">TRIP ITINERARY</span>
          <h3>Itinerary &amp; stops</h3>
          <p>Arrival times and weather outlook along the selected route.</p>
        </div>
        <div className="activity-heading-trailing">
          {model.days.length > 1
            ? <label className="activity-day-select">Trip day
              <select aria-label="Trip day" value={dayKey} onChange={event => setSelectedDay(event.target.value)}>
                {model.days.map(day => <option key={day.key} value={day.key}>{day.label}</option>)}
              </select>
            </label>
            : <span className="activity-day-badge">{model.days[0].label}</span>}
          <span className="activity-event-count">{dayEvents.length} events</span>
        </div>
      </div>

      <ol className="activity-event-list" aria-label="Route itinerary">
        {dayEvents.map(event => {
          const meta = STOP_META[event.kind] || STOP_META.weather
          const risk = RISK_LABELS[event.risk] || 'Unknown'
          return <li key={event.id} className={`activity-event event-${event.kind}`}>
            <span className={`activity-stop-icon stop-${event.kind} risk-${event.risk}`} aria-hidden="true">{meta.icon}</span>
            <div className="activity-event-main">
              <div className="activity-event-title"><b>{meta.title}</b></div>
              <p className="activity-stop-meta">{event.location ? `${event.location} · ` : ''}{event.distance.toFixed(1)} mi from origin</p>
              <p className="activity-stop-weather">{weatherSummary(event.weather)}</p>
            </div>
            <div className="activity-stop-trailing">
              <time className="activity-event-time" dateTime={event.time.toISOString()}>{formatTimelineDateTime(event.time)}</time>
              <span className={`activity-risk risk-${event.risk}`}>{risk} risk</span>
            </div>
          </li>
        })}
      </ol>
      <p className="activity-disclaimer">Estimated routing and forecast only; this is not a driver duty-status log or Hours of Service compliance calculation.</p>
    </section>
  )
}
