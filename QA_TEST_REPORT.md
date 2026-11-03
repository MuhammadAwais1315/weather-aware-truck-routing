# Weather-Aware Truck Routing — QA Test Report

**Date:** 2026-11-03  
**Environment:** Local Django development server (`127.0.0.1:8000`), Vite (`127.0.0.1:5174`), Edge browser, Docker Python 3.12.  
**Scope:** Complete user journey, real provider connectivity where configured, automated backend/frontend suites, browser behavior, application logs, and production frontend build.

**Publishing status:** Private GitHub repo [MuhammadAwais1315/weather-aware-truck-routing](https://github.com/MuhammadAwais1315/weather-aware-truck-routing), `main` includes current deployment changes. Vercel production frontend: [weather-aware-truck-routing-psi.vercel.app](https://weather-aware-truck-routing-psi.vercel.app/). Vercel production API: [weather-aware-truck-routing-api-kappa.vercel.app](https://weather-aware-truck-routing-api-kappa.vercel.app/api/health/).

## Summary

| Area | Result |
|---|---|
| Django tests | **101 passed**, 0 failed, 0 skipped |
| React/Vitest tests | **29 passed**, 0 failed, 0 skipped |
| Playwright browser tests | **4 passed**, 0 failed, 0 skipped |
| Total automated tests | **134 passed**, 0 failed, 0 skipped |
| Production frontend build | Passed; Vite reports a large JavaScript chunk warning |
| Public Vercel frontend | Page and React form returned HTTP 200; JavaScript bundle returned HTTP 200; Edge smoke had 0 page/console errors |
| Public Vercel backend | Django deployed; `/api/health/` returned HTTP 200 JSON with status `ok` and version `1.0.0` |
| Production CORS | Preflight from the deployed frontend origin returned HTTP 200 and `Access-Control-Allow-Origin` matched exactly |
| Public frontend-to-backend request | Edge browser fetched backend health successfully from the production dashboard; no uncaught page errors |
| Public journey submission | Form submitted to production API and displayed its actual HTTP 503 error: `OPENROUTESERVICE_API_KEY is not configured.` Route analysis is blocked until the key is added |
| Public full route workflow | **Not verified**: API URL and CORS are configured, but ORS credentials are absent, so no real alternatives/checkpoints/map workflow is available publicly |
| Live Nominatim geocoding | Passed |
| Live Open-Meteo hourly forecast | Passed, including requested units and UTC timestamp matching |
| Live complete plan request | **Blocked**: `OPENROUTESERVICE_API_KEY` is not configured; backend correctly returned HTTP 503 |

Automated test counts above are actual executed results. The 134 tests use mocked provider responses where necessary. Provider-specific smoke requests for Nominatim and Open-Meteo were live. The route dependent workflow cannot be proven end-to-end against providers until a valid routing key is supplied; no route data was fabricated.

After the deployment-preparation changes, the backend suite was rerun under Coverage.py: 101 tests passed and aggregate measured coverage was **85.0% with branch measurement** (856 statements, 274 branches). Frontend tests do not currently have a coverage provider, so a frontend coverage percentage is unavailable. See [TESTING.md](TESTING.md).

## Scenario results

| Scenario | Expected | Actual | Pass/Fail |
|---|---|---|---|
| Start Django backend | Server starts and health endpoint reports status/version | Development server started; `GET /api/health/` returned HTTP 200 with `{"status":"ok","version":"1.0.0"}` | **PASS** |
| Start React frontend | Dashboard served by Vite | `http://127.0.0.1:5174/` returned HTTP 200 and dashboard title | **PASS** |
| Frontend-to-backend CORS | Browser origin can call API | Preflight from port 5174 returned CORS allow-origin after adding that local origin to defaults/examples | **PASS** |
| Enter and submit journey | Form accepts origin, destination, departure, weight, interval and sends analysis request | Browser live smoke filled and submitted the journey; backend received `POST /api/plan/` | **PASS** (submission); analysis below is blocked |
| Live origin/destination geocoding | Nominatim returns real coordinates for valid address | Live New York query returned label `New York, United States`, latitude `40.7127281`, longitude `-74.0060152` | **PASS** |
| Invalid geocoding input | Invalid/short input returns a structured client error | Covered by Django geocoding/API tests; discovered error formatting defect was fixed and regression tested | **PASS** (automated) |
| Request three route alternatives | ORS request asks for up to three alternatives and returns provider results only | Request behavior and 1-, 2-, and 3-route response cases verified with mocked ORS responses. Live route request could not execute because key is absent | **PASS** (mocked); **BLOCKED** (live) |
| Display actual route alternatives | Actual returned geometries appear in comparison UI/map | Playwright validates route cards/map from API fixtures. Live plan returned HTTP 503, so no actual provider route geometry was available | **PASS** (mocked UI); **BLOCKED** (live) |
| Checkpoints at 10, 25 and 50 miles | Checkpoints follow cumulative route distance and contain start/destination once | Each interval, short/long routes, interpolation, distance, ETA and endpoint uniqueness covered by backend tests; intervals also exercised through browser fixtures | **PASS** (automated) |
| Checkpoint weather uses ETA | Weather lookup time corresponds to each checkpoint’s estimated arrival | Weather timestamp matching, timezone behavior and trip-analysis integration are covered by mocked backend tests. No live route meant no live checkpoint ETA to query | **PASS** (automated); **BLOCKED** (live route flow) |
| Live weather retrieval and units | Open-Meteo hourly data matches requested hour and is converted to mph and inches/hour | Live query at New York coordinates matched requested `2026-11-03T10:00Z`; wind `4.722421 mph`, rain `0.0 in/hour`, snow `0.0 in/hour`; provider returned forecast available | **PASS** |
| Missing/null/unavailable forecast | Missing data remains missing and does not become zero | Null values, unavailable hours, API failures, timeouts and cache behavior covered with mocked responses | **PASS** (automated) |
| Risk thresholds and load overrides | Wind/rain/snow boundaries and heavy-load overrides follow configured rules | Boundary tests cover every listed cutoff and load override; missing weather handled explicitly | **PASS** (automated) |
| Severe/high risk miles | Miles are weighted by actual route segment distances | Segment-distance aggregation and risk classifications covered by backend tests | **PASS** (automated) |
| Recommendation priorities | Sort by severe miles, high miles, average risk, then duration | Independent unit tests exercise each priority; fewer alternatives and all-unsafe cases included | **PASS** (automated) |
| Unsafe route handling | Never recommend a No Travel route as safe; return “No safe route available” if all unsafe | Recommendation engine tests verify unsafe exclusion/all unsafe behavior; UI test verifies recommendation display | **PASS** (automated) |
| Map route rendering | Display returned routes and highlight recommended route | Playwright map integration test validates rendered route layers and recommendation highlighting using API fixtures | **PASS** (automated) |
| Checkpoint markers and popups | Marker risk color and popup show checkpoint weather/ETA/risk/load details | Browser test exercises checkpoint popup content using fixture response | **PASS** (automated) |
| Heatmap and 0–48-hour slider | Slider updates exploratory forecast time, heatmap and checkpoint visualization without changing trip ETA | Browser and frontend tests cover slider calculations, forecast timestamp selection, GeoJSON updates and missing hours | **PASS** (automated) |
| API failure/loading states | Clear loading and error behavior; stale results removed after failed/repeated submission | Playwright tests cover failure/loading UI and second submission removing old cards/map state | **PASS** (automated) |
| Responsive layout | Dashboard fits mobile, tablet and desktop | Playwright viewport checks passed at mobile, tablet and desktop sizes without horizontal overflow | **PASS** (automated) |
| Live plan endpoint with missing routing key | Useful failure response and visible user-facing error; no fabricated routes | `POST /api/plan/` returned HTTP 503, code `routing_not_configured`; UI showed the error, and route count remained zero | **PASS** (failure handling); live analysis **BLOCKED** |
| Browser console and failed requests | No uncaught page errors, missing assets, or unexpected failed requests | After removing blocked external font import and adding favicon, live smoke had 0 page errors and 0 failed requests; only expected plan HTTP 503 was logged as a console network error | **PASS** with expected API failure |
| Backend logs / Django checks | No startup/system-check errors; requests logged with useful status | Django system check reported no issues. Health/geocode/CORS were 200; missing ORS configuration was logged as 503. Test logs contain expected mocked timeout and exception-handler cases | **PASS** |

## Fixes made during QA

- Added `127.0.0.1:5174` to default CORS origins and the environment examples so the actual Vite origin can call Django.
- Fixed central exception handling for non-field DRF validation errors so the API returns a readable message instead of a Python `ErrorDetail` representation. Added a regression test.
- Removed a remote Google Fonts import that produced a browser network error in this environment, and added a local SVG favicon to eliminate the `/favicon.ico` 404.
- Added `frontend/scripts/live-smoke.mjs` and the `npm run qa:live` command to fill and submit the real dashboard against the running API while capturing browser and HTTP errors.

## Build and operational notes

- `npm run build` completed successfully. Vite emitted a warning that the minified JavaScript bundle is about 1.39 MB (397 KB gzip), above its 500 KB advisory threshold. This does not fail the build, but code splitting would improve load performance.
- Django logs report 14 unapplied built-in `auth` and `contenttypes` migrations. Current endpoints and tests work without database-backed models, but run migrations before adding database-dependent behavior.
- The local backend uses Django’s development server; it is suitable for this QA session only.
- The live smoke command intentionally exits nonzero when a planning request fails. Here that accurately exposed the missing routing credential rather than treating the blocked integration as success.

## Live test prerequisite to complete the blocked scenarios

Set a valid `OPENROUTESERVICE_API_KEY` in `backend/.env`, restart/reload Django, then rerun `npm run qa:live` and submit journeys for each checkpoint interval. This is required to validate real ORS geometries, live-route checkpoint/weather association, and the resulting actual-data map/heatmap workflow. No credentials are included in this report.
