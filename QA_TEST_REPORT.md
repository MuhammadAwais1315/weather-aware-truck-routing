# Weather-Aware Truck Routing — QA Test Report

**Date:** 2026-11-05
**Environment:** Windows PowerShell, Python 3.12.10, Django, Vite, Playwright, and public Vercel production frontend/API.
**Scope:** Complete user journey, real provider connectivity where configured, automated backend/frontend suites, browser behavior, application logs, and production frontend build.

**Publishing status:** Private GitHub repo [MuhammadAwais1315/weather-aware-truck-routing](https://github.com/MuhammadAwais1315/weather-aware-truck-routing), `main` includes current deployment changes. Vercel production frontend: [weather-aware-truck-routing-psi.vercel.app](https://weather-aware-truck-routing-psi.vercel.app/). Vercel production API: [weather-aware-truck-routing-api-kappa.vercel.app](https://weather-aware-truck-routing-api-kappa.vercel.app/api/health/).

## Summary

| Area | Result |
|---|---|
| Django tests | **121 passed**, 0 failed, 0 skipped |
| React/Vitest tests | **53 passed**, 0 failed, 0 skipped |
| Playwright browser tests | **5 passed**, 0 failed, 0 skipped |
| Total automated tests | **179 passed**, 0 failed, 0 skipped |
| Backend statement/branch coverage | **83.0%** (1,266 statements, 424 branches) |
| Production frontend build | Passed; Vite reports a large JavaScript chunk warning |
| Public Vercel frontend | Page and React form returned HTTP 200; live journey succeeded; Edge smoke had 0 page errors, console errors or failed HTTP responses |
| Public Vercel backend | Django deployed; `/api/health/` returned HTTP 200 JSON with status `ok` and version `1.0.0` |
| Production CORS | Preflight from the deployed frontend origin returned HTTP 200 and `Access-Control-Allow-Origin` matched exactly |
| Public frontend-to-backend request | Edge browser fetched backend health successfully from the production dashboard; no uncaught page errors |
| Public journey submission | New York → Hartford → Boston returned HTTP 200 with three distinct provider routes and 34 checkpoints total (12/11/11) |
| Public full route workflow | Verified with live Nominatim, ORS, and Open-Meteo: all 34 checkpoints had ETA-matched weather; selected-hour forecast returned 34/34. Zero page, console, HTTP, or failed-request errors |
| Road map readability | Road network, city labels, attribution and route overlays render clearly | Replaced the sparse MapLibre demo basemap with CARTO Voyager. Live St. Louis County-to-Dallas map loaded its road labels/tiles, the route and checkpoints, and CARTO/OSM attribution; 0 HTTP or console errors |
| Live Nominatim geocoding | Passed |
| Live Open-Meteo hourly forecast | Passed, including requested units and UTC timestamp matching |
| Live complete plan request | Passed with configured production key; the 50-mile checkpoint interval returned 6/6 checkpoints with forecast weather |

Automated test counts above are actual executed results. Provider unit tests mock external APIs; the production smoke used live Nominatim, ORS, and Open-Meteo. The public backend health endpoint returned HTTP 200 with version `1.0.0`.

Frontend tests do not currently have a coverage provider, so a frontend coverage percentage is unavailable. See [TESTING.md](TESTING.md).

## Follow-up verification — 2026-11-05

After the QA run above, the route card status was clarified so routes with nonzero high/severe exposure are labeled **CAUTION** instead of appearing safe solely because they have no No Travel segments. Frontend verification for this follow-up completed with **48 Vitest tests passed**, **5 Playwright tests passed**, and a successful Vite production build. The built production asset served at [weather-aware-truck-routing-psi.vercel.app](https://weather-aware-truck-routing-psi.vercel.app/) was checked for the updated `CAUTION` and `LOW RISK` labels. This follow-up did not rerun the Django test suite or recalculate backend coverage.

The original `weather-aware-truck-routing.vercel.app` alias remained assigned to an existing deployment and rejected reassignment. The updated frontend is available at the `-psi` URL above; the API remains at [weather-aware-truck-routing-api-kappa.vercel.app/api/health/](https://weather-aware-truck-routing-api-kappa.vercel.app/api/health/).

### Current quality improvements — 2026-11-05

- Added `POST /api/weather/route-forecast/` so the 0–48-hour slider requests weather for all displayed route checkpoints at the selected timestamp. The exploratory response is held separately from trip ETA weather. The frontend debounces requests, cancels stale requests, caches selected hours in memory, and draws selected-time heatmap/checkpoint layers without changing trip risk results.
- Batched checkpoint coordinates into Open-Meteo multi-location calls (up to 100 coordinates/request), bounded the in-process weather cache, and added DRF scoped throttles configurable through environment variables.
- Added API, batching/cache, UI data flow, and all-unsafe recommendation regression coverage. The latest Vitest run passed **53/53**. The Django suite, checks, and coverage were subsequently run with Python 3.12.10 and pass (121 tests; 83.0% coverage).
- The first Playwright run exposed a map integration defect: `App` passed a GeoJSON object where `MapView` expected the raw forecast array, causing an uncaught `flatMap is not a function` error. The map crashed and the forecast status stayed on “Loading.” The data contract is fixed; the targeted slider workflow passed, then the complete Playwright suite passed **5/5**. The selected-hour checkpoint count now reaches `6 of 6` in the browser test.
- `npm run build` succeeded. Initial app JS is 324 KB (104 KB gzip); the lazy-loaded MapLibre view is 1,090 KB (299 KB gzip) and still triggers Vite's >500 KB advisory. Map code is deferred until needed, but further chunk analysis can improve map-first loading.
- These changes have been deployed to Vercel and verified with the live three-location workflow documented below.

## Scenario results

### Current public production smoke — 2026-11-05

| Scenario | Expected | Actual | Result |
|---|---|---|---|
| Public backend health | Healthy API and version response | HTTP 200; status `ok`, version `1.0.0` | **PASS** |
| Three-location journey | Geocode truck, pickup, and destination; return provider routes | Live plan returned HTTP 200 with 3 distinct route geometries | **PASS** |
| Route checkpoints and ETA weather | Generate actual route checkpoints and find hourly weather at each ETA | 34 checkpoints across routes (12/11/11); weather available and ETA-matched for all 34 | **PASS** |
| Selected forecast hour | Return actual weather at the slider's selected timestamp for all route checkpoints | HTTP 200; 34 checkpoints requested, 34 available | **PASS** |
| Public browser health | No runtime, console, network, or page failures during journey and slider workflow | 0 page errors, 0 console errors, 0 HTTP errors, 0 failed requests | **PASS** |

The live smoke selected an exploratory time 12 hours after departure. The returned live conditions happened to classify as Low; severe and No Travel behavior is verified by threshold and load-boundary backend tests, not claimed from this particular weather sample.

## Assessment requirements audit — 2026-11-05

| Assessment requirement | QA result | Evidence / remaining qualification |
|---|---|---|
| Origin, departure date/time, load weight; three routing locations in current product | **Implemented** | Current product extends the PDF's origin/destination form with truck location → pickup → destination; frontend tests cover the request payload and unit conversion. |
| Three provider route options; real alternatives only | **Implemented with provider limitation** | ORS is asked for real alternatives for both pickup legs and real leg alternatives are combined. Public live journey returned three distinct route geometries; longer trips can return fewer due to provider constraints. |
| 10/25/50-mile checkpoints, coordinates, distance, progress, ETA | **Implemented; backend suite passes** | Current 121-test run covers cumulative route geometry, interpolation, provider segment durations, endpoints, and ETAs. |
| ETA-specific hourly wind/rain/snow and conversions | **Implemented; backend suite passes** | Current suite covers UTC matching, unit conversions, nulls, missing hours, batching, caching, and API failures. |
| Weather thresholds and load rules | **Implemented; backend suite passes** | Boundary tests cover all bands and load cutoffs. |
| Severe/high miles and exact recommendation priority; unsafe handling | **Implemented; backend suite passes** | Segment-distance aggregation, ranking priorities, incomplete forecasts, and all-unsafe routes are covered. |
| Map, routes, checkpoints, ETA/risk popups, route summary | **Implemented; browser suite passes** | Current Playwright map and timeline workflows passed using deterministic mocked API responses. They do not establish current live provider behavior. |
| Weather heatmap and 0–48-hour slider | **Implemented; automated and live checks pass** | Browser suite verifies slider behavior; public selected-hour endpoint returned weather for all 34 route checkpoints in the live run. |
| README, screenshots, architecture, limitations, testing guide, walkthrough script | **Implemented** | Screenshots and demo script are present. The PDF specifically asks for a 5–10 minute Loom walkthrough: an actual recorded Loom video is not present in the repository. |
| GitHub and hosted application | **Published and current production verified** | Latest application revision is deployed on Vercel; public health, live planning, selected-hour forecast and browser errors were checked. |

### Findings requiring attention

1. **Medium — Shared rate limits need a Redis service URL.** Code supports `REDIS_URL`; without a provisioned value, the application uses local memory and counters are per process. Add managed Redis/Upstash in deployment if global throttling is required.
2. **Assessment deliverable — The Loom video is not recorded.** The 7–9 minute script exists, but the PDF asks for a recorded 5–10 minute walkthrough.
3. **Low — The MapLibre chunk remains large.** Build passes, and the map bundle is lazy-loaded, but the map chunk is 1,090 KB (299 KB gzip) and Vite emits the 500 KB advisory.

### Latest local execution

`npm run test:all`: Vitest **53 passed, 0 failed**; Playwright **5 passed, 0 failed**. `npm run build`: passed with the MapLibre chunk advisory above. `python manage.py check`: passed. Django suite: **121 passed, 0 failed**. Coverage.py: **83.0%** line/branch coverage. Live public plan and forecast passed: 3 distinct routes, 34 ETA-matched forecasts, 34/34 exploratory forecasts, and no browser/HTTP errors. Frontend source coverage: **not measured**.

### Remediation and backend verification — 2026-11-05

- Changed Django's default to `DEBUG=False`; the local environment example opts into `DEBUG=True`. Django still requires an explicit signing secret whenever debug is off.
- Added configurable Django Redis cache support via `REDIS_URL` and added the Redis client dependency. This shares throttle counters when configured; the current deployment still needs an actual Redis URL to enforce aggregate limits.
- Reworked the live smoke script for the current truck/pickup/destination fields, a near-future departure time, and selected-hour forecast request. Node syntax validation passed. It has not yet been exercised against live APIs.
- The first current backend run found three stale tests: expected route-provider request count ignored preference retries, expected the old 40-location batch size, and the throttle test changed DRF settings without updating the cached class attribute. The tests now model the implementation correctly. Full `manage.py check` and all **121 backend tests pass**.
- Current coverage is **83.0%** across 1,266 statements and 424 branches. The frontend suites also pass (**53 Vitest + 5 Playwright**).

| Scenario | Expected | Actual | Pass/Fail |
|---|---|---|---|
| Start Django backend | Server starts and health endpoint reports status/version | Development server started; `GET /api/health/` returned HTTP 200 with `{"status":"ok","version":"1.0.0"}` | **PASS** |
| Start React frontend | Dashboard served by Vite | `http://127.0.0.1:5174/` returned HTTP 200 and dashboard title | **PASS** |
| Frontend-to-backend CORS | Browser origin can call API | Preflight from port 5174 returned CORS allow-origin after adding that local origin to defaults/examples | **PASS** |
| Enter and submit journey | Form accepts origin, destination, departure, weight, interval and sends analysis request | Browser live smoke filled and submitted the journey; backend received `POST /api/plan/` | **PASS** (submission); analysis below is blocked |
| Live origin/destination geocoding | Nominatim returns real coordinates for valid address | Live New York query returned label `New York, United States`, latitude `40.7127281`, longitude `-74.0060152` | **PASS** |
| Invalid geocoding input | Invalid/short input returns a structured client error | Covered by Django geocoding/API tests; discovered error formatting defect was fixed and regression tested | **PASS** (automated) |
| Request up to three route alternatives | ORS request asks for up to three alternatives and returns provider results only | Mocked tests cover 1/2/3 results. Live 219.2-mile plan returned one actual provider route; API notice explains the 100 km alternatives limit | **PASS** (tests and live fallback) |
| Display returned route geometry | Actual returned geometry appears in comparison UI/map | Production Edge journey displayed one actual route, route summary/recommendation, map canvas and emitted MapLibre worker. No HTTP, console, or failed-request errors | **PASS** |
| Checkpoints at 10, 25 and 50 miles | Checkpoints follow cumulative route distance and contain start/destination once | Each interval, short/long routes, interpolation, distance, ETA and endpoint uniqueness covered by backend tests; intervals also exercised through browser fixtures | **PASS** (automated) |
| Checkpoint weather uses ETA | Weather lookup time corresponds to each checkpoint’s estimated arrival | Backend tests cover forecast-hour matching/timezones; production plan returned six checkpoints and weather for all six | **PASS** |
| Live weather retrieval and units | Open-Meteo hourly data matches requested hour and is converted to mph and inches/hour | Live query at New York coordinates matched requested `2026-11-03T10:00Z`; wind `4.722421 mph`, rain `0.0 in/hour`, snow `0.0 in/hour`; provider returned forecast available | **PASS** |
| Missing/null/unavailable forecast | Missing data remains missing and does not become zero | Null values, unavailable hours, API failures, timeouts and cache behavior covered with mocked responses | **PASS** (automated) |
| Risk thresholds and load overrides | Wind/rain/snow boundaries and heavy-load overrides follow configured rules | Boundary tests cover every listed cutoff and load override; missing weather handled explicitly | **PASS** (automated) |
| Severe/high risk miles | Miles are weighted by actual route segment distances | Segment-distance aggregation and risk classifications covered by backend tests | **PASS** (automated) |
| Recommendation priorities | Sort by severe miles, high miles, average risk, then duration | Independent unit tests exercise each priority; fewer alternatives and all-unsafe cases included | **PASS** (automated) |
| Unsafe route handling | Never recommend a No Travel route as safe; return “No safe route available” if all unsafe | Recommendation engine tests verify unsafe exclusion/all unsafe behavior; UI test verifies recommendation display | **PASS** (automated) |
| Map route rendering | Display returned routes and highlight recommended route | Playwright map integration test validates rendered route layers and recommendation highlighting using API fixtures | **PASS** (automated) |
| Trip activity timeline | Switch between Map and Timeline, inspect estimated driving spans and actual checkpoint ETA/risk per day | Vitest and Playwright verify view switching, checkpoint events, weather labels, multi-day selector, and day-boundary segment clipping. Timeline clearly states it is not an HOS log | **PASS** (automated) |
| Checkpoint markers and popups | Marker risk color and popup show checkpoint weather/ETA/risk/load details | Browser test exercises checkpoint popup content using fixture response | **PASS** (automated) |
| Heatmap and 0–48-hour slider | Slider updates exploratory forecast time, heatmap and checkpoint visualization without changing trip ETA | Browser and frontend tests cover slider calculations, forecast timestamp selection, GeoJSON updates and missing hours | **PASS** (automated) |
| API failure/loading states | Clear loading and error behavior; stale results removed after failed/repeated submission | Playwright tests cover failure/loading UI and second submission removing old cards/map state | **PASS** (automated) |
| Responsive layout | Dashboard fits mobile, tablet and desktop | Playwright viewport checks passed at mobile, tablet and desktop sizes without horizontal overflow | **PASS** (automated) |
| Browser console and failed requests | No uncaught page errors, missing assets, or unexpected failed requests | Production initially revealed a missing MapLibre worker asset and invalid demo glyph stack. The worker is now emitted by Vite, the font stack matches the style; latest live smoke had 0 console errors and 0 HTTP failures | **PASS** |
| Backend logs / Django checks | No startup/system-check errors; requests logged with useful status | Django system check reported no issues. Production health, autocomplete and plan requests succeeded; test logs contain expected mocked timeout and exception-handler cases | **PASS** |

## Fixes made during QA

- Added `127.0.0.1:5174` to default CORS origins and the environment examples so the actual Vite origin can call Django.
- Fixed central exception handling for non-field DRF validation errors so the API returns a readable message instead of a Python `ErrorDetail` representation. Added a regression test.
- Removed a remote Google Fonts import that produced a browser network error in this environment, and added a local SVG favicon to eliminate the `/favicon.ico` 404.
- Added `frontend/scripts/live-smoke.mjs` and the `npm run qa:live` command to fill and submit the real dashboard against the running API while capturing browser and HTTP errors.
- Bundled MapLibre's module worker with Vite and set the emitted URL explicitly; fixed the map label font to use a font stack provided by the selected map style.
- Replaced the pale MapLibre demo style with CARTO Voyager for clearer road detail, city labels and map context. The style supplies CARTO and OpenStreetMap attribution through MapLibre's attribution control.

## Build and operational notes

- `npm run build` completed successfully. Vite emitted a warning that the minified JavaScript bundle is about 1.39 MB (397 KB gzip), above its 500 KB advisory threshold. This does not fail the build, but code splitting would improve load performance.
- Django logs report 14 unapplied built-in `auth` and `contenttypes` migrations. Current endpoints and tests work without database-backed models, but run migrations before adding database-dependent behavior.
- The local backend uses Django’s development server; it is suitable for this QA session only.
- The long public trip is not eligible for ORS alternative-route calculations, so one actual route is expected. For trips under 100 km, provider availability and request limits determine whether ORS returns additional alternatives.

## Remaining live checks

The public 50-mile interval journey is verified. To validate all intervals with provider data, repeat the public journey at 10 and 25 miles. A short route under 100 km is needed to exercise multiple live ORS alternatives. Forecast slider interaction and heatmap data updates are covered by the automated UI suite; all API secrets remain in Vercel environment configuration and are not included in this report.
