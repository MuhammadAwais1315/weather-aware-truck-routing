# Testing and coverage

## Latest executed results

These are real runs in the local QA environment on 2026-11-03. Provider calls are mocked in automated tests; only the separate smoke checks documented in [QA_TEST_REPORT.md](QA_TEST_REPORT.md) used live Nominatim/Open-Meteo services.

| Suite | Tests | Passed | Failed | Skipped | Coverage |
|---|---:|---:|---:|---:|---|
| Django backend | 101 | 101 | 0 | 0 | **85.0%** Coverage.py total (line and branch measurement; 856 statements, 274 branches) |
| Vitest + React Testing Library | 29 | 29 | 0 | 0 | Not instrumented; no frontend coverage provider configured |
| Playwright browser | 4 | 4 | 0 | 0 | Browser behavior tests, not source coverage |
| **Total** | **134** | **134** | **0** | **0** | Backend measured; frontend coverage percentage unavailable |

The suite covers geocoding/routing provider behavior, route counts, checkpoint geometry and ETA, hourly weather matching/conversions, risk thresholds/load overrides, distance-weighted recommendations, API validation/errors, form/API integration, map/popups, forecast slider, repeat submission and mobile/tablet/desktop widths. It is not a substitute for live route testing; a valid ORS key is required for that.

## Windows PowerShell commands

Install backend development requirements in the active virtual environment:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
```

Run backend checks and tests:

```powershell
python manage.py check
python manage.py test tests --verbosity 1
coverage run --data-file=.coverage manage.py test tests
coverage report --data-file=.coverage -m
```

From a separate terminal:

```powershell
cd frontend
npm ci
npm run test
npm run test:e2e
npm run test:all
npm run build
```

For the live browser smoke, start Django and Vite first, set an ORS key in `backend/.env`, then:

```powershell
cd frontend
npm run qa:live
```

The live smoke performs a real UI submission and reports HTTP, request, console and page errors. It returns a nonzero exit code if planning fails; do not relabel a missing credential or provider failure as a passed full workflow.

## Coverage interpretation and follow-up

The backend's latest Coverage.py aggregate is 85.0% with branch measurement enabled. The lowest-coverage modules in that run were shared HTTP handling (50.0%), recommendations (80.0%), weather (80.8%) and route-provider integration (80.6%). Add targeted cases for currently uncovered provider error parsing and unusual checkpoint geometry/validation branches if increasing coverage is a submission goal.

The React suite reports test counts only. To report frontend line/branch coverage, add a Vitest-compatible coverage provider (such as the V8 provider), configure include/exclude paths in `vitest.config.js`, run it, and record the resulting report. Do not infer a coverage percentage from the number of passing tests.
