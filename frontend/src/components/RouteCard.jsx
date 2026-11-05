function number(value,digits=1){return value==null?'—':Number(value).toLocaleString(undefined,{maximumFractionDigits:digits})}
function duration(hours){if(hours==null)return '—';const minutes=Math.round(Number(hours)*60);const h=Math.floor(minutes/60),m=minutes%60;return h?`${h}h ${m}m`:`${m}m`}
function arrivalTime(departure,durationHours){if(!departure||durationHours==null)return '—';const eta=new Date(new Date(departure).getTime()+Number(durationHours)*3600000);return eta.toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}

export default function RouteCard({route,summary,departureTime,active,onClick}){
 const distance=summary?.total_distance_miles??route.distance_miles
 const hours=summary?.travel_duration_hours??route.duration_hours
 const metrics=route.metrics||{}
 const severe=summary?.severe_miles??metrics.severe_miles
 const high=summary?.high_miles??metrics.high_miles
 const average=summary?.average_risk??metrics.average_risk
 const noTravel=summary?.no_travel_segment_count??metrics.no_travel_segments??0
 const safe=noTravel===0
 return <button type="button" className={`comparison-card ${active?'selected':''} ${route.recommended?'recommended':''}`} onClick={onClick}>
  <div className="comparison-card-heading"><span className="route-index">{String(route.id||'').match(/\d+/)?.[0]||'•'}</span><div className="route-title-group"><span className="route-name">{route.name||'Route option'}</span><span className="route-subtitle">{safe?'No No Travel segments':'Contains No Travel segments'}</span></div>{route.recommended&&<span className="recommend-badge">BEST OPTION</span>}</div>
  <div className="route-primary-stats"><div><span>Distance</span><strong>{number(distance)}<small> mi</small></strong></div><div><span>Duration</span><strong>{duration(hours)}</strong></div></div>
  {route.legs?.length===2&&<div className="route-leg-summary"><span>Truck → pickup <b>{number(route.legs[0].distance_miles)} mi</b></span><span>Pickup → destination <b>{number(route.legs[1].distance_miles)} mi</b></span></div>}
  <div className="route-arrival"><span className="arrival-icon">◷</span><span><small>Estimated arrival</small><b>{arrivalTime(departureTime,hours)}</b></span></div>
  <div className="route-risk-grid"><div><span className="risk-bar severe-bar"/><small>Severe miles</small><b>{number(severe)} mi</b></div><div><span className="risk-bar high-bar"/><small>High miles</small><b>{number(high)} mi</b></div><div><span className="risk-bar average-bar"/><small>Average risk</small><b>{average==null?'Unavailable':`${number(average,0)} / 100`}</b></div></div>
  <div className={`route-safety ${safe?'safe':'unsafe'}`}><span className="safety-status-icon">{safe?'✓':'!'}</span><span>{safe?'No No Travel segments':`${noTravel} No Travel segment${noTravel===1?'':'s'}`}</span><span className="safety-state">{safe?'SAFE':'UNSAFE'}</span></div>
 </button>
}
