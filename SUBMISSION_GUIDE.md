# WeatherRoute — Assessment Submission Guide

This guide gathers the submission links, rubric coverage, setup and test commands, and the remaining presenter task in one place. Feature details and API schemas are in [README.md](README.md); actual QA evidence and limitations are in [QA_TEST_REPORT.md](QA_TEST_REPORT.md) and [TESTING.md](TESTING.md).

## Submission links

- **Private GitHub repository:** [MuhammadAwais1315/weather-aware-truck-routing](https://github.com/MuhammadAwais1315/weather-aware-truck-routing)
- **Deployed frontend:** [WeatherRoute on Vercel](https://weather-aware-truck-routing-psi.vercel.app/)
- **Backend health:** [Django API health check](https://weather-aware-truck-routing-api-kappa.vercel.app/api/health/)
- **Demo script:** [LOOM_WALKTHROUGH.md](LOOM_WALKTHROUGH.md)
- **Automated and live QA:** [QA_TEST_REPORT.md](QA_TEST_REPORT.md)

The app and API are deployed on Vercel. Render configuration is included as an optional alternative, but Render deployment is not claimed. The frontend production alias currently ends in `-psi`; the README explains why the shorter alias was unavailable.

## Assessment rubric coverage

| Rubric weight | Assessment area | Project evidence |
|---:|---|---|
| 40% | Routes, weather, risk, and recommendation logic | Three-stop planning; provider-returned routes; 10/25/50-mile checkpoints; ETA-based Open-Meteo weather; unit conversion; threshold and load rules; distance-weighted risk miles; deterministic recommendation ordering. See QA report for unit coverage and live API evidence. |
| 40% | UI, map, heatmap, smoothness, and performance | Responsive React dashboard; route comparison; MapLibre route/checkpoint layers and popups; timeline; exploratory forecast slider and heatmap; loading/error handling and stale-state cleanup. Vitest and Playwright results are recorded in the QA report. |
| 15% | Code quality | Modular Django REST Framework services and React components; environment-based configuration; centralized API errors; logging; backend and frontend automated suites. Known security and performance qualifications are documented below and in the QA report. |
| 5% | Documentation and walkthrough | README with screenshots, architecture, API and setup docs; test guide; QA report; this checklist; narrated demo script. The Loom recording itself must be made by the presenter before final hand-in. |

## Verified quality results

Latest recorded automated runs:

- Backend: **121 passed**, 0 failed; Django system check clean.
- Frontend: **53 Vitest and 5 Playwright tests passed**.
- Backend coverage: **83.0%** (Coverage.py with branch measurement).
- Production build: succeeded; Vite reports an advisory for the lazy-loaded MapLibre bundle size.
- Live public API: health returned HTTP 200; a three-location trip returned 3 distinct routes and weather for 34/34 route checkpoints; the selected-hour forecast endpoint returned 34/34 forecasts.

The current automated live browser smoke could not access Vercel from the QA environment (`ERR_NETWORK_ACCESS_DENIED`). The public frontend and API health URLs returned HTTP 200, direct live plan and forecast API calls passed, and the local Playwright UI suite passed. See the latest run notes in [QA_TEST_REPORT.md](QA_TEST_REPORT.md); do not describe the current browser retest as a pass.

## Run locally on Windows PowerShell

Create `backend/.env` from `backend/.env.example` and add a valid `OPENROUTESERVICE_API_KEY`. The ORS key is needed for autocomplete and routing; Open-Meteo does not require a key. Keep all secrets in backend environment configuration.

**PowerShell window 1 — backend:**

```powershell
cd backend
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements-dev.txt
Copy-Item .env.example .env
# Edit .env and set OPENROUTESERVICE_API_KEY
python manage.py check
python manage.py runserver 127.0.0.1:8000
```

**PowerShell window 2 — frontend:**

```powershell
cd frontend
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Open the URL printed by Vite. Health check: `http://127.0.0.1:8000/api/health/`. Configure `VITE_API_BASE_URL` in `frontend/.env.local` if the API is running at a different address; it must end in `/api`.

## Run automated tests

```powershell
# Backend, from backend/ with its virtual environment active
python manage.py check
python manage.py test tests --verbosity 1
coverage run --data-file=.coverage manage.py test tests
coverage report --data-file=.coverage -m
```

```powershell
# Frontend, from frontend/
npm run test
npm run test:e2e
npm run test:all
npm run build
```

Provider calls in automated tests are mocked. The optional `npm run qa:live` script exercises public or local services when the browser can access them and the ORS key is configured. A blocked network is a blocked live-browser check, not a pass.

## Final hand-in checklist

- [ ] Open the public frontend and confirm the dashboard loads.
- [ ] Confirm the backend health endpoint responds.
- [ ] Record a **5–10 minute Loom walkthrough** using [LOOM_WALKTHROUGH.md](LOOM_WALKTHROUGH.md).
- [ ] Verify the recording shows truck location → pickup → destination, departure/load/checkpoint settings, route comparison, map, timeline, checkpoint weather/risk, and the forecast slider.
- [ ] If live conditions do not produce high or No Travel risk, explain the threshold rules and label test cases as tests. Never claim test fixtures are live forecasts.
- [ ] Keep `.env` files, API keys, account pages, private notifications, and personal browser information out of the recording.
- [ ] Add the Loom URL to the application/submission form. The repository intentionally contains a script, not a fabricated recording link.
- [ ] Submit the GitHub repository, Vercel frontend URL, backend health URL, and Loom recording URL together.

## Disclose these limitations

- ORS can return fewer than three alternatives, especially for journeys over its alternative-calculation distance limit. WeatherRoute displays only provider-returned routes.
- Ordinary routing profiles do not guarantee truck height, axle-weight, hazmat, seasonal, or road restriction compliance. Verify official restrictions before dispatch.
- Forecasts and estimated times can be unavailable or change. Unknown weather remains unknown; route ETAs are not HOS or driver-duty calculations.
- Shared rate limiting requires a configured production `REDIS_URL`; without it, cache-backed counters are process-local.
- Django's production `check --deploy` retains HSTS subdomain and preload warnings. Do not enable those settings without confirming the domain hierarchy and preload requirements.
- The production Vite build succeeds with a large MapLibre chunk advisory. Frontend coverage is not currently instrumented.

## Walkthrough file map

- [README.md](README.md) — product overview, screenshots, architecture, installation, API, risk rules, deployment, limitations.
- [TESTING.md](TESTING.md) — test commands, latest recorded counts, coverage interpretation.
- [QA_TEST_REPORT.md](QA_TEST_REPORT.md) — assessment crosswalk, test evidence, live integration results, findings.
- [LOOM_WALKTHROUGH.md](LOOM_WALKTHROUGH.md) — timed spoken script, suggested screens, presenter safeguards.
- [docs/screenshots/](docs/screenshots/) — product screenshots embedded in README.
