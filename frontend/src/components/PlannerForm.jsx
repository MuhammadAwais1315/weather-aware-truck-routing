import {useEffect, useRef, useState} from 'react'
import {autocompletePlaces} from '../api.js'

function initialDeparture(){
 const value=new Date(Date.now()+60*60*1000)
 value.setMinutes(value.getMinutes()-value.getTimezoneOffset())
 return {date:value.toISOString().slice(0,10),time:value.toISOString().slice(11,16)}
}

function AddressInput({label,name,value,onChange,placeholder}){
 const [suggestions,setSuggestions]=useState([]),[open,setOpen]=useState(false),[searching,setSearching]=useState(false)
 const selectedLabel=useRef(null)
 useEffect(()=>{
  if(selectedLabel.current===value){selectedLabel.current=null;setSuggestions([]);return}
  if(value.trim().length<3){setSuggestions([]);setSearching(false);return}
  const controller=new AbortController()
  const timer=setTimeout(async()=>{
   setSearching(true)
   try{setSuggestions(await autocompletePlaces(value,controller.signal));setOpen(true)}
   catch(error){if(error.name!=='CanceledError'&&error.name!=='AbortError')setSuggestions([])}
   finally{if(!controller.signal.aborted)setSearching(false)}
  },500)
  return()=>{clearTimeout(timer);controller.abort()}
 },[value])
 return <label className="dashboard-field address-field">{label}<span className="address-control"><span className="field-icon" aria-hidden="true">⌖</span><input aria-label={label} required name={name} autoComplete="off" value={value} onChange={onChange} onFocus={()=>setOpen(true)} onBlur={()=>setTimeout(()=>setOpen(false),120)} placeholder={placeholder}/>{searching&&<span className="input-spinner" aria-label="Searching"/>}</span>{open&&suggestions.length>0&&<div className="suggestion-list" role="listbox" aria-label={`${label} suggestions`}>{suggestions.map((item,index)=><button type="button" role="option" key={`${item.label}-${index}`} onMouseDown={event=>event.preventDefault()} onClick={()=>{selectedLabel.current=item.label;onChange({target:{name,value:item.label}});setSuggestions([]);setOpen(false)}}><span className="suggestion-pin" aria-hidden="true">⌖</span><span>{item.label}</span></button>)}</div>}</label>
}

export default function PlannerForm({onSubmit,loading}){
 const [form,setForm]=useState(()=>{const departure=initialDeparture();return {origin:'',pickup:'',destination:'',departure_date:departure.date,departure_time:departure.time,load_weight_lb:'',checkpoint_interval_miles:25}})
 const update=e=>setForm(previous=>({...previous,[e.target.name]:e.target.value}))
 function submit(event){
  event.preventDefault()
  const localDeparture=new Date(`${form.departure_date}T${form.departure_time}`)
  onSubmit({
   origin:form.origin.trim(),pickup:form.pickup.trim(),destination:form.destination.trim(),
   departure_time:localDeparture.toISOString(),
   load_weight_tons:Number(form.load_weight_lb)/2000,
   checkpoint_interval_miles:Number(form.checkpoint_interval_miles),
  })
 }
 return <form className="journey-form" onSubmit={submit}>
  <AddressInput label="Truck location" name="origin" value={form.origin} onChange={update} placeholder="Where is the truck now?"/>
  <AddressInput label="Pickup location" name="pickup" value={form.pickup} onChange={update} placeholder="Where will freight be picked up?"/>
  <AddressInput label="Final destination" name="destination" value={form.destination} onChange={update} placeholder="Where is the freight going?"/>
  <label className="dashboard-field">Departure date<input required type="date" name="departure_date" value={form.departure_date} onChange={update}/></label>
  <label className="dashboard-field">Departure time<input required type="time" name="departure_time" value={form.departure_time} onChange={update}/></label>
  <label className="dashboard-field"><span className="field-label-title">Load weight <span className="unit-label">(lb)</span></span><input required type="number" min="0" max="200000" step="1" name="load_weight_lb" value={form.load_weight_lb} onChange={update} placeholder="e.g. 42,000"/></label>
  <label className="dashboard-field">Checkpoint interval<select name="checkpoint_interval_miles" value={form.checkpoint_interval_miles} onChange={update}><option value="10">Every 10 miles</option><option value="25">Every 25 miles</option><option value="50">Every 50 miles</option></select></label>
  <button className="primary-button plan-button" disabled={loading}>{loading?<><span className="button-spinner"/>Analyzing routes…</>:'Analyze routes'}{!loading&&<span className="button-arrow">→</span>}</button>
 </form>
}
