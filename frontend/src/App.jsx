import {lazy, Suspense, useEffect, useMemo, useRef, useState} from 'react'
import PlannerForm from './components/PlannerForm.jsx'
import TripActivityTimeline from './components/TripActivityTimeline.jsx'
import RouteCard from './components/RouteCard.jsx'
import RouteDirections from './components/RouteDirections.jsx'
import {fetchRouteForecast, planRoute} from './api.js'
import {buildExploratoryForecastGeoJSON, formatForecastTimestamp, getSelectedForecastTimestamp} from './forecast.js'
import {createRequestGate} from './requestGate.js'
import {deduplicateRoutes} from './routeDiversity.js'

const weatherValue=(value,digits=1)=>value==null?'—':Number(value).toFixed(digits)
const MapView=lazy(()=>import('./components/MapView.jsx'))

export default function App(){
 const [plan,setPlan]=useState(null)
 const [selected,setSelected]=useState(null)
 const [loading,setLoading]=useState(false)
 const [error,setError]=useState('')
 const [forecastHour,setForecastHour]=useState(0)
 const [exploratoryForecast,setExploratoryForecast]=useState(null)
 const [forecastLoading,setForecastLoading]=useState(false)
 const [forecastError,setForecastError]=useState('')
 const [activityView,setActivityView]=useState('map')
 const requestGate=useRef(null)
 const forecastRequestSequence=useRef(0)
 const forecastCache=useRef(new Map())
 if(!requestGate.current)requestGate.current=createRequestGate()
 useEffect(()=>()=>requestGate.current?.cancel(),[])
 const routes=plan?.routes||[]
 const selectedForecastTimestamp=plan?getSelectedForecastTimestamp(plan.departure_time,forecastHour):null
 const selectedForecastGeoJSON=buildExploratoryForecastGeoJSON(exploratoryForecast?.forecasts||[])
 const active=useMemo(()=>routes.find(route=>route.id===selected)||routes.find(route=>route.recommended)||routes[0],[routes,selected])
 const routeSummaries=new Map((plan?.route_summaries||[]).map(summary=>[summary.route_id,summary]))

 useEffect(()=>{
  if(!plan)return undefined
  const forecastTime=getSelectedForecastTimestamp(plan.departure_time,forecastHour)
  if(!forecastTime)return undefined
  const cached=forecastCache.current.get(forecastTime)
  if(cached){setExploratoryForecast(cached);setForecastLoading(false);setForecastError('');return undefined}
  const requestSequence=++forecastRequestSequence.current
  setExploratoryForecast(null);setForecastLoading(true);setForecastError('')
  const timer=setTimeout(async()=>{
   try{
    const checkpoints=routes.flatMap(route=>(route.checkpoints||[]).map(point=>({
     route_id:route.id,route_name:route.name||route.id,checkpoint_id:point.id||String(point.index??point.distance_miles),
     latitude:Number(point.latitude??point.coordinates?.[1]),longitude:Number(point.longitude??point.coordinates?.[0]),
    })))
    const result=await fetchRouteForecast({forecast_time:forecastTime,load_weight_tons:plan.load_weight_tons,checkpoints})
    if(requestSequence!==forecastRequestSequence.current)return
    forecastCache.current.set(forecastTime,result)
    while(forecastCache.current.size>8)forecastCache.current.delete(forecastCache.current.keys().next().value)
    setExploratoryForecast(result)
   }catch(error){
    if(requestSequence===forecastRequestSequence.current){setExploratoryForecast(null);setForecastError(error.response?.data?.error||error.message||'Exploratory forecast is unavailable.')}
  }finally{if(requestSequence===forecastRequestSequence.current)setForecastLoading(false)}
  },250)
  return()=>{clearTimeout(timer)}
 },[plan,forecastHour])

 async function submit(payload){
   const request=requestGate.current.start()
   setLoading(true);setError('');setPlan(null);setSelected(null);setForecastHour(0);setActivityView('map')
  try{
   const result=await planRoute(payload,request.signal)
   if(!requestGate.current.isCurrent(request))return
   const diversity=deduplicateRoutes(result.routes,result.recommended_route_id)
   const diversityNotice=diversity.removed?`${diversity.removed} near-identical route${diversity.removed===1?' was':'s were'} removed; only distinct provider routes are shown.`:''
   const availabilityNotice=diversity.routes.length<3?`OpenRouteService supplied ${diversity.routes.length} distinct route${diversity.routes.length===1?'':'s'} for this trip after duplicate paths were removed.`:''
   const routingNotice=[result.routing_notice,diversityNotice,availabilityNotice].filter(Boolean).join(' ')
   forecastCache.current.clear();setExploratoryForecast(null);setForecastError('')
   setPlan({...result,routes:diversity.routes,routing_notice:routingNotice})
   setSelected(result.recommended_route_id||result.routes?.[0]?.id||null)
  }catch(exception){
   if(!requestGate.current.isCurrent(request))return
   const data=exception.response?.data
   const details=data?.details?JSON.stringify(data.details):''
   setError(data?.error||details||exception.message||'Unable to analyze this journey. Please try again.')
  }finally{if(requestGate.current.finish(request))setLoading(false)}
 }

 return <main className="app-shell dashboard-shell">
  <header className="topbar">
   <a className="brand" href="#top" aria-label="WeatherRoute home"><span className="brand-mark">W</span><span>weather<span className="brand-accent">route</span></span></a>
   <div className="topbar-right"><span className="live-dot"/>Weather-aware freight planning</div>
  </header>

  <section className="hero dashboard-hero" id="top">
   <div><div className="eyebrow">JOURNEY PLANNING · WEATHER INTELLIGENCE</div><h1>Plan the route.<br/><em>Know the risk.</em></h1><p>Compare real driving alternatives with forecast conditions along each journey.</p></div>
   <div className="hero-promise"><span className="promise-mark">✳</span><div><b>Plan with confidence</b><small>Live routes · Arrival-time forecasts<br/>Risk-aware recommendations</small></div></div>
  </section>

  <section className="planner-panel">
   <div className="panel-heading"><div><span className="section-kicker">JOURNEY DETAILS</span><h2>Build your trip</h2></div><span className="step-tag">UP TO 3 ALTERNATIVES</span></div>
   <PlannerForm onSubmit={submit} loading={loading}/>
  </section>

  {error&&<div className="error-box dashboard-error" role="alert"><span className="error-symbol">!</span><div><b>We couldn't analyze this journey</b><p>{error}</p></div></div>}
  {loading&&<div className="loading-state" role="status"><span className="loading-orbit"/><div><b>Analyzing your journey</b><span>Finding alternatives and matching checkpoint forecasts to arrival times…</span></div></div>}

  {plan&&<>
   <section className="route-results">
    <div className="results-heading"><div><span className="section-kicker">ROUTE ANALYSIS</span><h2>{routes.length?`Compare ${routes.length} route${routes.length===1?'':'s'}`:'No route alternatives returned'}</h2><p>{routes.length?'Each route starts at the truck, visits the pickup, then continues to the destination.':'Try adjusting the locations or departure details and analyze again.'}</p></div><div className="results-total"><strong>{routes.length}</strong><span>available<br/>alternative{routes.length===1?'':'s'}</span></div></div>
    {routes.length>0&&<div className="comparison-grid">{routes.map(route=><RouteCard key={route.id} route={route} summary={routeSummaries.get(route.id)} departureTime={plan.departure_time} active={active?.id===route.id} onClick={()=>setSelected(route.id)}/>)}</div>}
    <div className={`recommendation result-recommendation ${plan.recommended_route_id?'':plan.recommendation_status==='incomplete_forecasts'?'incomplete':'unsafe'}`}><span className="rec-icon">{plan.recommended_route_id?'✦':'!'}</span><div><b>{plan.recommended_route_id?'Recommended route':plan.recommendation_status==='incomplete_forecasts'?'Forecast coverage incomplete':'No safe route available'}</b><p>{plan.ranking_explanation||plan.recommendation?.reason}</p></div></div>
   </section>

   {active&&<RouteDirections route={active}/>}

   {routes.length>0&&<section className="analysis-layout">
    <div className="map-panel"><div className="map-toolbar"><div className="map-label"><span className="map-pin">⌖</span><div><b>{active?`${plan.origin.label.split(',')[0]} → ${plan.pickup.label.split(',')[0]} → ${plan.destination.label.split(',')[0]}`:'Route overview'}</b><small>{active?`${active.distance_miles.toLocaleString()} miles · ${active.duration_hours} hours`:'Select a route to inspect its path and activities'}</small></div></div><div className="activity-toolbar-actions"><div className="legend"><span><i className="dot low"/>Low</span><span><i className="dot moderate"/>Moderate</span><span><i className="dot high"/>High</span><span><i className="dot severe"/>Severe</span><span><i className="dot no-travel"/>No travel</span></div><div className="activity-view-switch" role="tablist" aria-label="Trip view"><button type="button" role="tab" aria-selected={activityView==='map'} onClick={()=>setActivityView('map')}>Map</button><button type="button" role="tab" aria-selected={activityView==='timeline'} onClick={()=>setActivityView('timeline')}>Timeline</button></div></div></div>
     {plan.routing_notice&&<div className="routing-notice">ⓘ {plan.routing_notice}</div>}
     {activityView==='map'?<><div className="map-wrap"><Suspense fallback={<div className="map-loading" role="status">Loading interactive map…</div>}><MapView routes={routes} selectedRouteId={active?.id} recommendedRouteId={plan.recommended_route_id} exploratoryForecast={exploratoryForecast?.forecasts||[]} origin={plan.origin} pickup={plan.pickup} destination={plan.destination}/></Suspense></div>
     <div className="forecast-bar"><div className="forecast-title"><span className="forecast-icon">◷</span><div><b>Forecast exploration</b><small>Exploration time is separate from checkpoint ETA</small></div></div><div className="slider-wrap"><input aria-label="Forecast hour" type="range" min="0" max="48" step="1" value={forecastHour} onChange={event=>setForecastHour(Number(event.target.value))}/><div className="slider-ticks"><span>Depart</span><span>12h</span><span>24h</span><span>36h</span><span>48h</span></div><div className="selected-forecast-time"><b>{formatForecastTimestamp(selectedForecastTimestamp)}</b><span>{forecastLoading?'Loading forecast for route checkpoints…':forecastError||`${selectedForecastGeoJSON.features.filter(feature=>feature.properties.weatherAvailable).length} of ${selectedForecastGeoJSON.features.length} checkpoint forecasts available`}</span></div></div><div className="forecast-value">+{forecastHour}<small>hours</small></div></div></>:<TripActivityTimeline route={active} departureTime={plan.departure_time}/>}
    </div>
    <aside className="checkpoint-panel"><div className="checkpoint-panel-heading"><span className="section-kicker">ON THE WAY</span><h3>Checkpoint outlook</h3><p>{active?`${active.checkpoints.length} forecast checkpoints`:'Select a route'}</p></div>{active&&<div className="checkpoint-list dashboard-checkpoints">{active.checkpoints.map(point=><div className="checkpoint weather-checkpoint" key={point.id||point.index}><div className="checkpoint-top"><i className={`dot ${point.risk.level}`}/><span>{point.distance_miles} mi</span><b>{point.risk.score??'—'}</b></div><small>Wind {weatherValue(point.weather?.wind_speed_mph)} mph<br/>Rain {weatherValue(point.weather?.rain_inches_per_hour,3)} in/hr · Snow {weatherValue(point.weather?.snowfall_inches_per_hour,3)} in/hr</small></div>)}</div>}</aside>
   </section>}
  </>}

  {!plan&&!loading&&!error&&<section className="dashboard-empty"><div className="empty-orbit">⌖</div><span className="section-kicker">READY WHEN YOU ARE</span><h2>Your next journey starts here</h2><p>Enter the truck location, pickup, destination and departure details above to compare real routes and weather exposure.</p><div className="empty-features"><span>↗ Real route alternatives</span><span>◷ Arrival-time forecasts</span><span>✳ Checkpoint risk analysis</span></div></section>}

  <footer><span>WeatherRoute <i>·</i> Plan smarter. Drive safer.</span><span>Forecasts are estimates and do not replace official road advisories.</span></footer>
 </main>
}
