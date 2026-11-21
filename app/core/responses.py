"""Response envelope kept identical to the old Express API so the dashboard needs no changes."""
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    def __init__(self, status: int, message: str, errors: list | None = None):
        self.status, self.message, self.errors = status, message, errors or []


def ok(message: str = "Success", data=None, meta=None, status: int = 200) -> JSONResponse:
    return JSONResponse(
        jsonable_encoder({"success": True, "statusCode": status, "message": message, "data": data, "meta": meta}),
        status_code=status,
    )


def fail(status: int, message: str, errors: list | None = None) -> JSONResponse:
    return JSONResponse(
        {"success": False, "statusCode": status, "message": message, "errors": errors or []},
        status_code=status,
    )


def register_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, e: ApiError):
        return fail(e.status, e.message, e.errors)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, e: StarletteHTTPException):
        return fail(e.status_code, str(e.detail))

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, e: RequestValidationError):
        errors = [f"{'.'.join(str(p) for p in x['loc'][1:])}: {x['msg']}" for x in e.errors()]
        return fail(422, "Validation failed", errors)
