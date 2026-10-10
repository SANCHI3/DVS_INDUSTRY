"""Authenticated client for the dashboard API."""

from __future__ import annotations

import json
import os
import urllib.request
from http.cookies import SimpleCookie
from urllib.error import HTTPError, URLError
from typing import Any, Optional


class DashboardClientError(RuntimeError):
    """Sanitized dashboard client failure."""

    def __init__(
        self,
        message: str,
        status_code: Optional[int] = None,
        retryable: bool = False,
    ):
        super().__init__(message)
        self.status_code = status_code
        # True for transient failures (network errors, 5xx, 429) that are
        # worth retrying later; False for configuration or request errors.
        self.retryable = retryable


class _DashboardHttpError(DashboardClientError):
    """Internal HTTP error that retains only the response status."""


class DashboardClient:
    """Authenticate and make finite-timeout dashboard API requests."""

    refresh_cookie_name = "dvs_rt"

    def __init__(self, timeout: float = 15.0):
        self.base_url = (os.getenv("DASHBOARD_BACKEND_URL") or "").rstrip("/")
        self.service_email = os.getenv("DASHBOARD_SERVICE_EMAIL")
        self.service_password = os.getenv("DASHBOARD_SERVICE_PASSWORD")
        override = os.getenv("DASHBOARD_API_TOKEN")
        self._access_token = override.strip() if override and override.strip() else None
        self._refresh_token: Optional[str] = None
        self.timeout = timeout

    def request(
        self,
        path: str,
        payload: Optional[dict[str, Any]] = None,
        method: str = "GET",
    ) -> Any:
        """Make one authenticated request, retrying one 401 exactly once."""

        self._validate_configuration()
        if self._access_token is None:
            self._login()

        try:
            return self._send_api_request(path, payload, method)
        except _DashboardHttpError as exc:
            if exc.status_code != 401:
                raise
            self._reauthenticate()
            try:
                return self._send_api_request(path, payload, method)
            except _DashboardHttpError as retry_error:
                if retry_error.status_code == 401:
                    raise DashboardClientError(
                        "Dashboard request unauthorized after one retry.",
                        status_code=401,
                    ) from None
                raise

    def _validate_configuration(self) -> None:
        if not self.base_url:
            raise DashboardClientError("DASHBOARD_BACKEND_URL is not configured.")
        if self._access_token is None and (
            not self.service_email or not self.service_email.strip()
            or not self.service_password or not self.service_password.strip()
        ):
            raise DashboardClientError(
                "DASHBOARD_SERVICE_EMAIL and DASHBOARD_SERVICE_PASSWORD "
                "are required when DASHBOARD_API_TOKEN is not set."
            )

    def _login(self) -> None:
        response, raw_response = self._send_public_request(
            "/api/v1/auth/login",
            {
                "email": self.service_email,
                "password": self.service_password,
            },
        )
        self._set_access_token(response)
        self._refresh_token = self._extract_refresh_token(raw_response)

    def _refresh(self) -> None:
        if not self._refresh_token:
            raise DashboardClientError("Dashboard refresh token is unavailable.")

        body = None
        request = urllib.request.Request(
            f"{self.base_url}/api/v1/auth/refresh",
            data=body,
            method="POST",
            headers={
                "Accept": "application/json",
                "Cookie": f"{self.refresh_cookie_name}={self._refresh_token}",
            },
        )
        response = self._open(request)
        data = self._decode_json(response)
        self._set_access_token(data)
        refreshed_token = self._extract_refresh_token(response)
        if refreshed_token:
            self._refresh_token = refreshed_token

    def _reauthenticate(self) -> None:
        if self._refresh_token:
            try:
                self._refresh()
                return
            except DashboardClientError:
                pass
        if not self.service_email or not self.service_password:
            raise DashboardClientError(
                "Dashboard request unauthorized and no refresh credentials are available.",
                status_code=401,
            )
        self._access_token = None
        self._refresh_token = None
        self._login()

    def _send_api_request(
        self,
        path: str,
        payload: Optional[dict[str, Any]],
        method: str,
    ) -> Any:
        body = (
            json.dumps(payload, ensure_ascii=False).encode("utf-8")
            if payload is not None
            else None
        )
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self._access_token}",
        }
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=body,
            method=method,
            headers=headers,
        )
        return self._decode_json(self._open(request))

    def _send_public_request(self, path: str, payload: dict[str, Any]) -> tuple[Any, Any]:
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            method="POST",
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )
        response = self._open(request)
        return self._decode_json(response), response

    def _open(self, request: urllib.request.Request):
        try:
            return urllib.request.urlopen(request, timeout=self.timeout)
        except HTTPError as exc:
            raise _DashboardHttpError(
                f"Dashboard request failed with HTTP {exc.code}.",
                status_code=exc.code,
                retryable=exc.code >= 500 or exc.code == 429,
            ) from None
        except URLError as exc:
            raise DashboardClientError(
                f"Dashboard request failed: {type(exc).__name__}.",
                retryable=True,
            ) from None
        except Exception as exc:
            raise DashboardClientError(
                f"Dashboard request failed: {type(exc).__name__}.",
                retryable=True,
            ) from None

    @staticmethod
    def _decode_json(response) -> Any:
        try:
            with response:
                return json.loads(response.read().decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise DashboardClientError(
                f"Dashboard response was invalid: {type(exc).__name__}.",
            ) from None

    def _set_access_token(self, response: Any) -> None:
        if not isinstance(response, dict):
            raise DashboardClientError("Dashboard authentication response was invalid.")
        data = response.get("data")
        token = data.get("accessToken") if isinstance(data, dict) else None
        if not isinstance(token, str) or not token.strip():
            raise DashboardClientError("Dashboard authentication response lacked an access token.")
        self._access_token = token

    def _extract_refresh_token(self, response) -> Optional[str]:
        headers = getattr(response, "headers", None)
        if headers is None:
            return None
        set_cookies = headers.get_all("Set-Cookie", [])
        if isinstance(set_cookies, str):
            set_cookies = [set_cookies]
        cookie = SimpleCookie()
        for header in set_cookies:
            cookie.load(header)
        morsel = cookie.get(self.refresh_cookie_name)
        return morsel.value if morsel is not None and morsel.value else None
