# React QA test report

**Run date:** 2026-11-03  
**Command:** `npm run test:all`  
**Browser:** Microsoft Edge, headless

## Results

| Suite | Tests | Passed | Failed | Skipped |
|---|---:|---:|---:|---:|
| Vitest + React Testing Library | 29 | 29 | 0 | 0 |
| Playwright browser tests | 4 | 4 | 0 | 0 |
| **Total** | **33** | **33** | **0** | **0** |

## Coverage exercised

- Journey form fields, required validation, load bounds, supported intervals, local date/time to ISO request conversion, and pounds-to-tons conversion.
- Debounced autocomplete and selecting provider suggestions.
- Django plan endpoint URL, request payload, response validation, loading, and provider errors.
- Route cards, recommendation highlighting, risk summaries, and unsafe status.
- MapLibre route/checkpoint GeoJSON, severity heatmap weights, layer controls, checkpoint popup details, map cleanup, and replacement of old route data.
- Forecast slider values, selected timestamp, and unavailable forecast hours.
- Repeated journey submissions and replacement of old cards/map canvas.
- Desktop (1440 px), tablet (768 px), and mobile (390 px) responsive layouts without horizontal overflow.

Playwright network routes return deterministic test responses for geocoding and `/api/plan/`; these browser tests verify UI-to-client behavior without depending on external providers or a live Django server. The separate API client contract test verifies the frontend request path and validates the backend response schema.

The production Vite build also completed successfully. Vite emitted its existing advisory that the minified JavaScript chunk exceeds 500 kB.
