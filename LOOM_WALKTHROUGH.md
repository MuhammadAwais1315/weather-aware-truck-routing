# Loom walkthrough script — Weather-Aware Truck Routing

**Target recording length:** about 8 minutes.  
**Before recording:** start Django and Vite; use a valid ORS key if available; open browser DevTools Network/Console; do not show `.env` contents, keys, or account credentials. If recording against a public deployment, use the actual Vercel and Render URLs and verify them first. This repository has deployment configuration but no public deployment has been verified yet.

## 0:00–0:40 — Intro and scope

**Show:** dashboard at the top of the page.

**Say:** “This is WeatherRoute, a weather-aware freight route planning dashboard. It compares actual alternatives from openrouteservice, estimates checkpoint weather at trip arrival times, scores weather and load risk, and ranks routes. The routing profile can help with truck routing, but no routing API can guarantee every height, axle, weight, or road restriction; drivers still need to verify official restrictions.”

## 0:40–1:35 — Enter a journey and autocomplete

**Show:** origin and destination inputs, enter an origin and pause for suggestions, choose a suggestion, then choose a destination. Point out departure date/time, pounds load input, and checkpoint interval.

**Say:** “Autocomplete suggestions come from the routing provider, while the backend resolves selected location labels through Nominatim. Departure is sent as an ISO-8601 timestamp with a timezone. The UI accepts pounds and the API converts that to short tons. The checkpoint selector supports exactly 10, 25, and 50 miles.”

If live credentials are unavailable, show the user-facing configuration error without replacing it with sample routes. Say: “This environment has no ORS credential, so a live journey request is expected to be rejected. I’ll use the automated test suite results to explain route-dependent behavior; those tests use clearly identified mocked provider responses.”

## 1:35–2:25 — Actual route alternatives and comparison cards

**Show:** submit a real journey when credentials are available; show the cards. Confirm only routes returned by the provider appear. Point to distance, duration, ETA, severe/high miles, average risk, and safety status. Point to the recommendation and why it was chosen.

**Say:** “The backend asks for up to three alternatives and compares only the routes actually returned. Recommendation ordering is exact: fewest severe miles, then high miles, then lowest average risk, then shortest duration. A route containing a No Travel segment cannot be recommended; when all are unsafe, the interface says no safe route is available.”

**Fallback:** show the route card and recommendation Playwright tests in the test report, explicitly identifying fixtures as test data.

## 2:25–3:20 — Checkpoint geometry and timing

**Show:** select a 10-mile journey result if available. Point to start/destination and intermediate checkpoint positions; show checkpoint ETA and distance in the side list. If time permits, rerun with 25 and 50 miles.

**Say:** “Checkpoints are spaced along cumulative route distance and interpolated on the route geometry, rather than selected by coordinate index. Start and destination are included once. Provider segment durations are used when available; otherwise ETA uses documented proportional distance progress through total duration.”

## 3:20–4:20 — Weather units, risk rules and load

**Show:** checkpoint details / popup for wind, rain, snow, risk and load override. If possible, change load and rerun to show classification changing.

**Say:** “Open-Meteo hourly forecasts are matched to each checkpoint’s estimated arrival hour in UTC. Wind is converted from kilometers per hour to miles per hour; precipitation and rain from millimeters to inches; snowfall from centimeters to inches. Null or unavailable forecast values stay unknown. The risk engine takes the highest component risk and then applies the specified load rules. For example, 45 to under 55 mph with a load over 30,000 pounds becomes No Travel.”

## 4:20–5:25 — Map, route selection and checkpoint popup

**Show:** all routes on the map, recommended route highlight, alternatives, origin/destination markers, risk colors, and click a checkpoint popup. Toggle alternative routes and checkpoint layers.

**Say:** “The map uses GeoJSON coordinates in longitude, latitude order. It renders all available route geometries, highlights the recommended route, and colors checkpoint markers by final risk. Clicking a marker shows distance, ETA, the three weather intensities, classification and load override explanation. Layer controls update map visibility without creating a duplicate map instance.”

## 5:25–6:15 — Heatmap and exploratory forecast slider

**Show:** enable weather heatmap and scrub slider at 0, 12, 24, 36, 48 hours. Point out timestamp and available checkpoint count.

**Say:** “This slider is exploratory time relative to departure. It changes the displayed heatmap and checkpoint forecast selection; it does not alter the actual ETA used for trip risk. The heatmap weight is risk severity. When a forecast hour is missing, there is no fabricated zero-risk point; the UI reports that no checkpoint forecast is available for that selection.”

## 6:15–7:05 — Repeated submission, errors and responsiveness

**Show:** submit a second journey if provider credentials are available; briefly show loading. Optionally show a test/API error. Resize to mobile width and point out responsive form/cards/map.

**Say:** “Repeated submissions clear prior results before loading new ones, and the request gate prevents stale responses from overwriting the latest journey. Loading, validation and provider failures have visible error states. Browser automation covers a second submission and mobile, tablet and desktop widths.”

## 7:05–7:40 — Architecture and configuration

**Show:** README architecture diagram, then backend app folders and frontend components. Do not open `.env`.

**Say:** “The React/Vite client talks to modular DRF endpoints. Routing orchestration composes separate geocoding, routing, checkpoint, weather, risk and recommendation services. Provider keys remain server-side in environment variables. Vercel and Render configuration is prepared, with exact production CORS and the Vite API URL set at deployment time.”

## 7:40–8:10 — QA results and close

**Show:** `QA_TEST_REPORT.md` summary and deployment checklist.

**Say:** “The latest executed automated run passed 101 backend tests, 29 frontend tests and 4 Playwright tests. Live Nominatim and Open-Meteo smoke requests succeeded. Live route analysis and public deployment are not claimed as verified until an ORS key is configured and the Vercel/Render services are deployed and tested publicly. The test report separates live provider checks from mocked integration tests.”

**Close:** “That’s WeatherRoute: real route alternatives, ETA-aligned weather, transparent risk scoring, and an interactive map for planning review.”
