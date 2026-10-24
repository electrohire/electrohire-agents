"""Thin client over the ElectroHire REST API.

The ElectroHire runtimes are TypeScript on Cloudflare Workers; this package is
a client for agent developers working in Python. It uses only the standard
library, so it installs anywhere Python >= 3.10 runs.

Phase C1 coverage: the read endpoints (site content, service pages, FAQ,
pricing) and the three tool endpoints (cost estimator, scoping checklist,
timeline calculator). There is deliberately no blog method — the API has no
blog endpoint until Phase B data exists.
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
        base_url: API base URL. Defaults to the production API. For the
            beta, pass the beta API base URL explicitly (the production
            name is a cutover decision, not a default to change quietly).
        api_key: Optional API key for endpoints that require one. Public
            C1 read/tool endpoints do not. Sent as a Bearer header.
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

    # -- system ---------------------------------------------------------
    def health(self) -> dict:
        """Return the API health payload: ``{"status": "ok", "version": ...}``."""
        return self._get("/v1/health")

    # -- C1 read endpoints ------------------------------------------------
    def site_content(self) -> dict:
        """Site content mirrored from the website: fees, entity facts, categories."""
        return self._get("/v1/content")

    def services(self) -> dict:
        """Service categories and the service pages they belong to."""
        return self._get("/v1/content/services")

    def faq(self, page: str | None = None) -> dict:
        """FAQ entries, optionally for one page slug (e.g. ``"pods"``)."""
        return self._get("/v1/faq" + (f"?page={page}" if page else ""))

    def pricing(self) -> dict:
        """Fees, pod presentation (no pod price exists — deliberately
        unpublished, as on the site), and UK Contractors Hub tiers."""
        return self._get("/v1/pricing")

    # -- C1 tool endpoints --------------------------------------------------
    def estimate_cost(self, needs: list[str], product_type: str = "other",
                      stage: str = "sketch", units: str = "proto") -> dict:
        """Planning estimate. Always a range with assumptions — the API
        schema cannot return a bare number."""
        return self._post("/v1/tools/cost-estimator", {
            "needs": needs, "productType": product_type, "stage": stage, "units": units,
        })

    def scoping_checklist(self, needs: list[str], product_type: str = "other") -> dict:
        """Grouped scoping checklist (decisions + documents, each with a reason)."""
        return self._post("/v1/tools/scoping-checklist", {
            "needs": needs, "productType": product_type,
        })

    def timeline(self, needs: list[str], stage: str = "sketch") -> dict:
        """Stage-by-stage timeline ranges with waiting time counted."""
        return self._post("/v1/tools/timeline-calculator", {
            "needs": needs, "stage": stage,
        })

    # -- transport ------------------------------------------------------
    def _get(self, path: str) -> dict:
        return self._request("GET", path)

    def _post(self, path: str, payload: dict) -> dict:
        return self._request("POST", path, payload)

    def _request(self, method: str, path: str, payload: dict | None = None) -> dict:
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = self._headers()
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            f"{self.base_url}{path}", data=body, headers=headers, method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise ElectroHireError(
                f"{method} {path} failed for {self.base_url}: {exc}"
            ) from exc

    def _headers(self) -> dict[str, str]:
        headers = {
            "Accept": "application/json",
            "User-Agent": "electrohire-python/0.2.0",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers
