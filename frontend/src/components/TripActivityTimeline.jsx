import {useMemo, useState} from 'react'
import {buildRiskTimelineGraph, buildTripActivityTimeline, formatTimelineDateTime} from '../activityTimeline.js'

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
const GRAPH_RISK_LABELS = {no_travel: 'No travel', severe: 'Severe', high: 'High', moderate: 'Moderate', low: 'Low'}

function RiskTimelineGraph({events}) {
  const graph = buildRiskTimelineGraph(events)
  return <section className="risk-timeline" aria-label="Weather risk over estimated arrival time">
    <div className="risk-timeline-heading"><div><b>Weather risk over time</b><span>Checkpoint risk score at estimated arrival</span></div><div className="risk-axis-label">Risk score <strong>0–100</strong></div></div>
    {graph.points.some(point => point.score != null) ? <div className="risk-chart-scroll">
      <svg className="risk-chart" viewBox={`0 0 ${graph.width} ${graph.height}`} role="img" aria-label="Line graph of weather risk scores by checkpoint arrival time">
        {[{from: 75, color: '#dc26260a'}, {from: 50, color: '#f973160a'}, {from: 25, color: '#d2a0000a'}, {from: 0, color: '#22a06b0a'}].map(({from, color}) => {
          const y = graph.plot.top + (100 - (from + 25)) / 100 * graph.plot.height
          return <rect key={from} x={graph.plot.left} y={y} width={graph.plot.width} height={graph.plot.height / 4} fill={color}/>
        })}
        {[0, 25, 50, 75, 100].map(score => {
          const y = graph.plot.top + (100 - score) / 100 * graph.plot.height
          return <g key={score}><line className="risk-gridline" x1={graph.plot.left} x2={graph.width - graph.plot.right} y1={y} y2={y}/><text className="risk-y-tick" x={graph.plot.left - 9} y={y + 4} textAnchor="end">{score}</text></g>
        })}
        {graph.ticks.map((tick, index) => <g key={tick.time}><line className="risk-x-tick" x1={tick.x} x2={tick.x} y1={graph.plot.top} y2={graph.height - graph.plot.bottom}/><text className="risk-x-label" x={tick.x} y={graph.height - 12} textAnchor={index===0?'start':index===graph.ticks.length-1?'end':'middle'}>{tick.label}</text></g>)}
        {graph.segments.map(segment => <line key={segment.id} className="risk-line" x1={segment.x1} y1={segment.y1} x2={segment.x2} y2={segment.y2}/ >)}
        {graph.points.map(point => point.score == null ? <g key={point.id} className="risk-unknown-point"><circle cx={point.x} cy={graph.plot.top + graph.plot.height + 8} r="4"/><title>{formatTimelineDateTime(point.time)} · Forecast risk unknown</title></g> : <g key={point.id}><circle className="risk-point" cx={point.x} cy={point.y} r="5" style={{fill: point.color}}><title>{formatTimelineDateTime(point.time)} · {GRAPH_RISK_LABELS[point.risk] || 'Unknown'} risk · {point.score}/100</title></circle><text className="risk-point-value" x={point.x} y={point.y - 10} textAnchor="middle">{point.score}</text></g>)}
      </svg>
      <div className="risk-chart-legend"><span><i className="risk-legend-line"/>Checkpoint risk</span><span><i className="risk-legend-unknown"/>Forecast unknown</span></div>
    </div> : <p className="risk-chart-empty">Risk scores are unavailable for these forecast checkpoints.</p>}
  </section>
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
          <span className="section-kicker">ESTIMATED JOURNEY</span>
          <h3>Trip timeline &amp; stops</h3>
          <p>Follow each stop in order. Times are estimated from the selected route.</p>
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
      <RiskTimelineGraph events={dayEvents}/>
      <p className="activity-disclaimer">Estimated routing and forecast only; this is not a driver duty-status log or Hours of Service compliance calculation.</p>
    </section>
  )
}
