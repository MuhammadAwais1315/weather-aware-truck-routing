import logging

from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.response import Response
from rest_framework.views import exception_handler

logger = logging.getLogger(__name__)


class ServiceError(APIException):
    """Expected upstream/service failure with an appropriate HTTP status."""

    status_code = status.HTTP_502_BAD_GATEWAY
    default_detail = 'An upstream service request failed.'
    default_code = 'upstream_service_error'

    def __init__(self, detail=None, status_code=None, code=None):
        if status_code is not None:
            self.status_code = status_code
        if code is not None:
            self.default_code = code
        super().__init__(detail=detail, code=code)


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None:
        logger.error('Unhandled API exception', exc_info=(type(exc), exc, exc.__traceback__))
        return Response({'error': 'Internal server error', 'code': 'internal_error'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    if isinstance(response.data, dict):
        detail = response.data.get('detail')
    elif isinstance(response.data, (list, tuple)) and len(response.data) == 1:
        # DRF represents ValidationError('message') as a one-item ErrorDetail list.
        # str(list) leaks its Python representation into the API response.
        detail = response.data[0]
    else:
        detail = response.data
    code = getattr(exc, 'default_code', 'request_error')
    if detail is None:
        response.data = {'error': 'Request validation failed', 'code': str(code), 'details': response.data}
    else:
        response.data = {'error': str(detail), 'code': str(code)}
    return response
