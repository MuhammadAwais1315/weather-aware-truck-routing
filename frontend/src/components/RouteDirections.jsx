function formatDistance(miles) {
  return `${Number(miles || 0).toFixed(2)} mi`
}

function formatDuration(minutes) {
  const value = Math.max(0, Number(minutes) || 0)
  if (value < 1) return '<1 min'
  if (value < 60) return `${value} min`
  const hours = Math.floor(value / 60)
  const remainder = value % 60
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`
}

export default function RouteDirections({ route }) {
  const legs = (route?.legs || []).filter(leg => Array.isArray(leg.steps) && leg.steps.length)
  if (!legs.length) return null

  return (
    <section className="directions-panel" aria-label="Turn-by-turn directions">
      <details>
        <summary>
          <span>Turn-by-turn directions</span>
          <small>{route.name} · {legs.reduce((count, leg) => count + leg.steps.length, 0)} steps</small>
        </summary>
        <div className="directions-legs">
          {legs.map((leg, legIndex) => (
            <section className="directions-leg" key={leg.id || legIndex}>
              <h3>{leg.from?.label?.split(',')[0] || `Leg ${legIndex + 1}`} <span>to</span> {leg.to?.label?.split(',')[0] || `Leg ${legIndex + 1}`}</h3>
              <ol>
                {leg.steps.map((step, stepIndex) => (
                  <li key={`${leg.id || legIndex}-${stepIndex}`}>
                    <span className="direction-step-number">{stepIndex + 1}</span>
                    <div>
                      <p>{step.instruction}</p>
                      {step.road_name && <small className="direction-road">{step.road_name}</small>}
                      <small>{formatDistance(step.distance_miles)} · {formatDuration(step.duration_minutes)}</small>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </details>
    </section>
  )
}
