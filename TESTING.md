# Testing and coverage

## Recorded executed results

The QA report includes historical live checks and the latest local run. Current suite counts below were executed on 2026-11-05. Provider calls in automated tests are mocked; the live smoke script exercises real providers when configured. See [QA_TEST_REPORT.md](QA_TEST_REPORT.md) for verified versus historical results.

| Suite | Tests | Passed | Failed | Skipped | Coverage |
|---|---:|---:|---:|---:|---|
| Django backend (2026-11-05) | 121 | 121 | 0 | 0 | Current run; Django system check clean |
| Vitest + React Testing Library (2026-11-05) | 53 | 53 | 0 | 0 | Not instrumented; no frontend coverage provider configured |
| Playwright browser (2026-11-05) | 5 | 5 | 0 | 0 | Selected-hour forecast request/map update and responsive viewports pass |
| Backend coverage (2026-11-05) | — | — | — | — | **83.0%** Coverage.py total; line and branch measurement (1,266 statements, 424 branches) |

The suites cover geocoding/routing provider behavior, route counts, checkpoint geometry and ETA, hourly weather matching/conversions, risk thresholds/load overrides, distance-weighted recommendations, API validation/errors, form/API integration, map/popups, forecast slider, repeat submission and mobile/tablet/desktop widths. The selected-hour browser workflow and 5-test browser suite pass after fixing a map forecast data-shape error. Provider tests use mocks; the live script requires configured API credentials and running services. For deployment and live smoke outcomes, use the dated scenario report.

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

The live smoke submits truck, pickup, and destination locations, checks the planning response, moves the forecast slider, and reports selected-hour forecast availability plus HTTP, request, console, and page errors. It returns a nonzero exit code if planning or the selected-hour forecast endpoint fails; do not relabel missing credentials or provider errors as a passed workflow.

## Coverage interpretation and follow-up

The latest backend Coverage.py aggregate is 83.0% with branch measurement enabled. Lowest-coverage modules are shared HTTP handling (50.0%), recommendations (77.3%), route-provider integration (77.3%) and weather (79.8%). Add targeted cases for currently uncovered provider error parsing and unusual checkpoint geometry/validation branches if increasing coverage is a submission goal.

The React suite reports test counts only. To report frontend line/branch coverage, add a Vitest-compatible coverage provider (such as the V8 provider), configure include/exclude paths in `vitest.config.js`, run it, and record the resulting report. Do not infer a coverage percentage from the number of passing tests.
