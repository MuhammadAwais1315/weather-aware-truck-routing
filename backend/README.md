# Django API

This backend uses modular Django apps under `apps/`: routing API, geocoding, weather, checkpoint generation, risk scoring, and recommendations. Shared HTTP and exception handling live under `services/`.

## Run on Windows PowerShell

From the repository root, configure `backend/.env` by copying `backend/.env.example`, then:

```powershell
cd backend
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements-dev.txt
python manage.py check
python manage.py test tests
coverage run manage.py test tests
coverage report -m
python manage.py runserver 127.0.0.1:8000
```

Health endpoint: `GET http://127.0.0.1:8000/api/health/`.

## Geocoding and routes

- `GET /api/geocode/autocomplete/?q=...` returns address suggestions from openrouteservice Pelias. It needs `OPENROUTESERVICE_API_KEY`; the React form debounces input.
- `GET /api/geocode/?q=...` resolves a selected address through Nominatim.
- `POST /api/plan/` resolves the truck location, pickup and final destination, then requests each route with coordinates in that order. It returns actual openrouteservice alternatives, normalized GeoJSON geometry, separate truck-to-pickup and pickup-to-destination leg summaries, distance and duration totals, and checkpoint weather/risk data including the pickup. If the provider returns one or two alternatives, the API returns one or two. It never fabricates routes.

Configure `OPENROUTESERVICE_API_KEY`, `OPENROUTESERVICE_PROFILE` and `NOMINATIM_BASE_URL` in `backend/.env`. The default profile is `driving-hgv`. The public Nominatim endpoint prohibits autocomplete; this app uses openrouteservice for suggestions and calls Nominatim only for explicit location resolution. Respect the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/). Its public service is limited to one request per second; the in-process geocoder serializes and caches lookups.

Routing results are not guaranteed to satisfy truck-specific height, axle-weight or road restrictions, including when the HGV profile is selected. Verify all restrictions before dispatch.

## Weather integration

`OpenMeteoWeatherService` requests hourly `wind_speed_10m`, `wind_gusts_10m`, `precipitation`, `rain`, `snowfall`, `visibility` and `weather_code` for each checkpoint location. The request explicitly uses UTC Unix timestamps and source units: wind km/h, precipitation/rain mm, snowfall cm. The service converts with `1 km/h = 0.621371192237334 mph`, `1 mm = 1/25.4 inches`, and `1 cm = 1/2.54 inches`. Open-Meteo defines wind speed as instantaneous at the hour; precipitation/rain and snowfall are sums for the preceding hour. The output's inches/hour labels mean inches accumulated during that preceding one-hour period. See [Open-Meteo hourly definitions](https://open-meteo.com/en/docs).

Arrival datetimes must be timezone-aware; the service converts them to UTC before selecting the nearest hourly timestamp, choosing the earlier hour for an exact tie. A match more than 30 minutes away is unavailable. Forecast payloads are cached per rounded coordinate for 15 minutes. Missing arrays, null values, and unavailable forecast hours stay null and carry an availability reason; they are never replaced with zero.

The risk engine uses centralized assessment bands in `apps/risk_engine/thresholds.py`. It classifies wind in mph, rain and snow in inches/hour, and assigns scores Low 0, Moderate 25, High 50, Severe 75, and No Travel 100. The current planner's load field is in short tons; load rules stated in pounds are applied after multiplying by 2,000 lb/ton, with strict `>` comparisons. Missing weather components are `Unknown` and do not become low risk; if every weather component is missing the final score is `null`.

Recommendation summaries are calculated in `apps/recommendations/services.py`. Each checkpoint risk applies over the actual distance to the next checkpoint; the destination contributes no extra segment. Average risk is distance-weighted over segments with known risk. Routes are ranked by severe miles, high miles, average risk, then duration. No Travel segment details are returned and those routes are excluded from recommendation; when none are safe, `recommended_route_id` is null and the explanation says `No safe route available`.
