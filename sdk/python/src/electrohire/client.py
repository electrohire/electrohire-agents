"""Thin client over the ElectroHire REST API.

The ElectroHire runtimes are TypeScript on Cloudflare Workers; this package is
a client for agent developers working in Python. It uses only the standard
library, so it installs anywhere Python >= 3.10 runs.

Scaffold status: only ``health()`` is implemented. Content, tools, and Ellie
intake methods land with the API endpoints they wrap.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

DEFAULT_BASE_URL = "https://api.electrohire.com"

__all__ = ["ElectroHireClient", "ElectroHireError"]


class ElectroHireError(RuntimeError):
    """Raised when an ElectroHire API call fails."""


class ElectroHireClient:
    """Client for the ElectroHire public API (URL-versioned under ``/v1``).

    Args:
        base_url: API base URL. Defaults to the production API.
        api_key: Optional bearer token. Read endpoints are public; action
            endpoints require a user-granted token.
        timeout: Per-request timeout in seconds.
    """

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        *,
        api_key: str | None = None,
        timeout: float = 10.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def __repr__(self) -> str:
        return f"ElectroHireClient(base_url={self.base_url!r})"

    def health(self) -> dict:
        """Return the API health payload: ``{"status": "ok", "version": ...}``.

        Raises:
            ElectroHireError: if the API cannot be reached or does not
                respond with valid JSON.
        """
        request = urllib.request.Request(
            f"{self.base_url}/v1/health",
            headers=self._headers(),
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise ElectroHireError(
                f"Health check failed for {self.base_url}: {exc}"
            ) from exc

    def _headers(self) -> dict[str, str]:
        headers = {
            "Accept": "application/json",
            "User-Agent": "electrohire-python/0.1.0",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers
