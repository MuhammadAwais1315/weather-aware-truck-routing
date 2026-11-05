import axios from 'axios'
import {validatePlanResponse} from './contracts.js'
const api = axios.create({baseURL: import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api', timeout: 180000})
const reversePlaceCache = new Map()
export async function planRoute(payload,signal){const {data}=await api.post('/plan/',payload,{signal});return validatePlanResponse(data)}
export async function fetchRouteForecast(payload,signal){const {data}=await api.post('/weather/route-forecast/',payload,{signal});return data}
export async function searchPlace(q){const {data}=await api.get('/geocode/',{params:{q}});return data}
export async function autocompletePlaces(q,signal){const {data}=await api.get('/geocode/autocomplete/',{params:{q},signal});return data.suggestions||[]}
export async function reverseGeocode(latitude,longitude,signal){const key=`${Number(latitude).toFixed(4)},${Number(longitude).toFixed(4)}`;if(reversePlaceCache.has(key))return reversePlaceCache.get(key);const request=api.get('/geocode/reverse/',{params:{lat:latitude,lon:longitude},signal}).then(({data})=>data).catch(error=>{reversePlaceCache.delete(key);throw error});reversePlaceCache.set(key,request);return request}
