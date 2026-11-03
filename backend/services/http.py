import logging

import requests

from .exceptions import ServiceError

logger = logging.getLogger(__name__)
SESSION = requests.Session()
SESSION.headers.update({'User-Agent': 'WeatherAwareTruckRouting/1.0 (local planning application)'})


def get_json(url, **kwargs):
    try:
        response = SESSION.get(url, timeout=20, **kwargs)
        response.raise_for_status()
        return response.json()
    except (requests.RequestException, ValueError) as exc:
        logger.warning('GET %s failed: %s', url, exc)
        raise ServiceError(f'Upstream service request failed: {exc}') from exc
