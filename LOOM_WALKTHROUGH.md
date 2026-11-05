# WeatherRoute demo walkthrough

**Target length:** 7–9 minutes (within the requested 5–10 minute range).

**Current frontend:** [weather-aware-truck-routing-psi.vercel.app](https://weather-aware-truck-routing-psi.vercel.app)

**Current API health:** [weather-aware-truck-routing-api-kappa.vercel.app/api/health/](https://weather-aware-truck-routing-api-kappa.vercel.app/api/health/)

**Companion checklist:** [SUBMISSION_GUIDE.md](SUBMISSION_GUIDE.md)

## Presenter preparation

- Open the live frontend and confirm it loads. Check the API health endpoint in another tab.
- Have a three-location trip ready. A previously verified live example is **New York, NY → Hartford, CT → Boston, MA**; use a departure time about one hour ahead of recording.
- A shorter journey may improve the chance that ORS returns alternatives. ORS may still return fewer than three; show only real provider routes.
- Forecasts depend on date, time, location, and provider availability. Do not promise a particular risk classification. To explain a high-risk or No Travel case, show it only if the current live response actually crosses the threshold. Otherwise explain the rule and identify any boundary example from the report as a test case, not live weather.
- Close secret-bearing tabs. Never show `.env`, API keys, or provider account settings. Keep browser DevTools closed unless intentionally showing request/response behavior.
- If a provider fails, show the visible error and state that the live call failed. Do not substitute test fixtures without labeling them.

## Script and screen actions

### 0:00–0:40 — Introduction

**Show:** dashboard header and planner.

**Say:** “This is WeatherRoute, a weather-aware freight route planner. It compares route options from a routing provider, matches hourly weather to estimated checkpoint arrival times, calculates load-aware risk, and displays the results on a map and timeline. It is decision support: the route profile does not guarantee compliance with every truck or road restriction.”

### 0:40–1:35 — Plan all three journey locations

**Show:** truck location, pickup location, final destination, departure date/time, load weight, and checkpoint interval. Use autocomplete and choose a suggestion for each location.

**Say:** “A journey has three distinct places: where the truck is now, where freight is picked up, and where it is delivered. The route goes from the truck to pickup, then continues from pickup to destination. I can choose a departure time, enter the load in pounds, and select 10, 25, or 50-mile checkpoint spacing.”

### 1:35–2:30 — Compare provider routes

**Show:** submit the plan, then scroll to the route cards and recommendation explanation.

**Say:** “The backend asks OpenRouteService for up to three alternatives. The app displays only the routes the provider actually returns. Each card summarizes distance, driving duration, arrival estimate, severe miles, high miles, average risk, and forecast coverage. A route with elevated exposure is labeled as caution, a route with incomplete data as unknown, and a No Travel route is not presented as a safe recommendation.”

Point out the exact ranking: “The comparison prioritizes fewest severe miles, then fewest high miles, then lowest distance-weighted average risk, then shortest duration.”

If only one route appears, say: “This provider request returned one route. ORS limits alternative-route calculations for trips over 100 km, so the application reports the actual result instead of manufacturing alternatives.”

### 2:30–3:25 — Checkpoint placement and itinerary timeline

**Show:** switch to Timeline. Scroll to the itinerary graph and its events, then to the checkpoint outlook list.

**Say:** “The timeline plots the journey over time and lists departure, pickup, weather checkpoints, and arrival. Checkpoints are located by cumulative distance along the actual route geometry, not by raw coordinate index. ETA uses provider segment duration when available, with a documented proportional estimate as a fallback. The displayed place name comes from the reverse-geocoded checkpoint location when one is available.”

### 3:25–4:20 — Weather details, units, and risk

**Show:** select or open a checkpoint from the map/timeline and point to wind, rain, snow, risk, and explanation. Use a live elevated-risk route if the current forecast provides one.

**Say:** “Open-Meteo hourly conditions are matched to each checkpoint's estimated arrival time. The service converts wind to miles per hour and rain and snow to inches per hour. Missing forecast values stay unknown; they are never silently changed to zero. The final checkpoint risk is the highest known weather risk, with the specified load overrides applied.”

Explain an example: “For instance, 42,000 pounds combined with wind in the 35-to-under-45 mph band raises that checkpoint to at least Severe. Rain above one inch per hour is No Travel under the assessment rules.”

### 4:20–5:20 — Map and checkpoint popup

**Show:** switch to Map. Point to colored route lines, recommendation highlight, origin/pickup/destination, checkpoint markers, and layer toggles. Click a checkpoint.

**Say:** “The map uses the returned GeoJSON route coordinates in longitude-latitude order. It can show the alternatives, checkpoints, and endpoints as separate layers. A checkpoint popup shows distance, ETA, weather values, risk classification, and any load-override explanation.”

### 5:20–6:05 — Weather heatmap and forecast slider

**Show:** enable the weather heatmap. Move the slider to 0, 12, 24, 36, and 48 hours, pausing to show the selected time and checkpoint display.

**Say:** “The slider explores forecast time from departure through 48 hours. Changing it requests current forecast data for each route checkpoint and updates the exploratory checkpoint weather and heatmap; it does not change the weather assessment at the actual ETA stored for the trip. If an hour is unavailable, the map reports missing forecast coverage rather than drawing a zero-risk value.”

### 6:05–6:50 — Loading, failures, repeat plans, and responsive layout

**Show:** if time and provider quota allow, submit a second journey and show the loading transition and replacement results. Resize to tablet or mobile width.

**Say:** “A new submission replaces old route and map state so stale markers do not remain. Validation, loading, and provider errors have visible states. The automated browser tests also cover repeated submissions and mobile, tablet, and desktop layouts.”

### 6:50–7:35 — Architecture and configuration

**Show:** README architecture diagram, then the `frontend/` and `backend/apps/` trees. Keep environment files closed.

**Say:** “The frontend is React and Vite, and the backend is Django REST Framework. Separate backend services handle geocoding, directions, checkpoint generation, weather, risk, and recommendations. Nominatim resolves places, OpenRouteService provides autocomplete and routes, and Open-Meteo provides hourly forecasts. Provider credentials stay in backend environment variables.”

### 7:35–8:10 — QA, limitations, close

**Show:** `TESTING.md` and `QA_TEST_REPORT.md`, then return to the dashboard.

**Say:** “The repository includes backend and frontend automated suites, with provider behavior mocked in tests. The reports distinguish automated coverage from live provider and production checks. Alternative availability and forecast conditions depend on external providers. Always verify truck restrictions and official advisories before dispatch.”

**Close:** “WeatherRoute brings real provider routes, ETA-based weather, transparent exposure metrics, and a map and timeline into one planning workflow.”

## Optional No Travel rule explanation

If live weather does not produce a No Travel checkpoint during recording, explain the rules without presenting invented conditions as observed data: “The risk engine marks wind at or above 55 mph as No Travel for every load; wind from 45 to under 55 mph is No Travel above 30,000 pounds; rain above 1 inch per hour and snow above 3 inches per hour are also No Travel. When all complete-coverage routes are unsafe, the recommendation reads ‘No safe route available.’ The boundary tests verify these cases.”

## Post-recording checklist

- Confirm the recording is 5–10 minutes and the audio is clear.
- Verify no credentials, `.env` contents, account details, or personal notifications appear.
- Check that every route shown was returned by the API; do not call mock fixtures live data.
- Keep the truck-restriction and ETA/HOS limitations in the closing narration.
