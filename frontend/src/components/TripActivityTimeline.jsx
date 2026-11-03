import {useMemo, useState} from 'react'
import {buildTripActivityTimeline, formatTimelineTime, getTimelineEventPosition} from '../activityTimeline.js'

const weatherSummary = weather => {
  if (!weather || weather.available === false) return 'Forecast unavailable'
  const wind = weather.wind_speed_mph == null ? null : `${Number(weather.wind_speed_mph).toFixed(0)} mph wind`
  const rain = weather.rain_inches_per_hour == null ? null : `${Number(weather.rain_inches_per_hour).toFixed(2)} in/hr rain`
  const snow = weather.snowfall_inches_per_hour == null ? null : `${Number(weather.snowfall_inches_per_hour).toFixed(2)} in/hr snow`
  return [wind, rain, snow].filter(Boolean).join(' · ') || 'Weather values unavailable'
}

const riskName = risk => ({no_travel: 'No travel', severe: 'Severe', high: 'High', moderate: 'Moderate', low: 'Low', unknown: 'Unknown'})[risk] || 'Unknown'

export default function TripActivityTimeline({route, departureTime}) {
  const model = useMemo(() => buildTripActivityTimeline(route, departureTime), [route, departureTime])
  const [selectedDay, setSelectedDay] = useState('')
  const dayKey = model.days.some(day => day.key === selectedDay) ? selectedDay : model.days[0]?.key
  const dayEvents = model.events.filter(event => event.day === dayKey)
  const daySegments = model.segments.filter(segment => segment.day === dayKey)

  if (!model.events.length) {
    return <section className="trip-activity-view" aria-label="Trip activity timeline"><p className="activity-empty">Checkpoint arrival times are not available for this route.</p></section>
  }

  return (
    <section className="trip-activity-view" aria-label="Trip activity timeline">
      <div className="activity-heading">
        <div>
          <span className="section-kicker">TRIP ACTIVITIES</span>
          <h3>Estimated route timeline</h3>
          <p>Driving periods and weather checkpoints from this route’s estimated arrival times.</p>
        </div>
        {model.days.length > 1 && <label className="activity-day-select">Trip day
          <select aria-label="Trip day" value={dayKey} onChange={event => setSelectedDay(event.target.value)}>
            {model.days.map(day => <option key={day.key} value={day.key}>{day.label}</option>)}
          </select>
        </label>}
        {model.days.length === 1 && <span className="activity-day-badge">{model.days[0].label}</span>}
      </div>

      <div className="activity-chart" aria-label={`Route activities for ${model.days.find(day => day.key === dayKey)?.label}`}>
        <div className="activity-axis-label">LOCAL TIME</div>
        <div className="activity-hour-axis" aria-hidden="true">
          {[0, 6, 12, 18, 24].map(hour => <span key={hour} style={{left: `${hour / 24 * 100}%`}}>{hour === 0 ? '12 AM' : hour === 12 ? '12 PM' : hour === 24 ? '12 AM' : `${hour % 12} ${hour < 12 ? 'AM' : 'PM'}`}</span>)}
        </div>
        <div className="activity-track-row">
          <div className="activity-track-label"><b>Driving</b><small>Estimated</small></div>
          <div className="activity-track" role="img" aria-label={`${daySegments.length} estimated driving segments`}>
            {[0, 6, 12, 18, 24].map(hour => <i key={hour} className="activity-grid-line" style={{left: `${hour / 24 * 100}%`}}/>)}
            {daySegments.map(segment => <div key={segment.id} className="activity-drive-segment" style={{left: `${segment.left}%`, width: `${Math.max(segment.width, 0.3)}%`}} title={`Estimated driving ${formatTimelineTime(segment.start)}–${formatTimelineTime(segment.end)}`} />)}
            {dayEvents.map(event => {
              const position = getTimelineEventPosition(event.time)
              return <span key={event.id} className={`activity-marker ${event.endpoint ? `endpoint${event.title === 'Arrive' ? ' destination' : ''}` : ''} risk-${event.risk}`} style={{left: `${position}%`}} title={`${event.title} · ${formatTimelineTime(event.time)} · ${riskName(event.risk)}`}/>
            })}
          </div>
        </div>
      </div>

      <ol className="activity-event-list" aria-label="Route activity events">
        {dayEvents.map(event => <li key={event.id} className="activity-event">
          <span className={`activity-event-dot risk-${event.risk}${event.endpoint ? ' endpoint' : ''}`} aria-hidden="true"/>
          <div className="activity-event-main">
            <div className="activity-event-title"><b>{event.title}</b><span>{formatTimelineTime(event.time)}</span></div>
            <p>{event.distance.toFixed(1)} miles from origin · {weatherSummary(event.weather)}</p>
          </div>
          <span className={`activity-risk risk-${event.risk}`}>{riskName(event.risk)}</span>
        </li>)}
      </ol>
      <p className="activity-disclaimer">This is an estimated route and checkpoint timeline, not a driver duty-status log or Hours of Service compliance calculation.</p>
    </section>
  )
}

