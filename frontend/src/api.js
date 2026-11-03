import axios from 'axios'
import {validatePlanResponse} from './contracts.js'
const api = axios.create({baseURL: import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api', timeout: 180000})
export async function planRoute(payload,signal){const {data}=await api.post('/plan/',payload,{signal});return validatePlanResponse(data)}
export async function searchPlace(q){const {data}=await api.get('/geocode/',{params:{q}});return data}
export async function autocompletePlaces(q,signal){const {data}=await api.get('/geocode/autocomplete/',{params:{q},signal});return data.suggestions||[]}
