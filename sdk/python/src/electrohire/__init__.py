"""Python client for the ElectroHire API.

Phase C1: health, read endpoints (content, services, FAQ, pricing), and the three tool endpoints are implemented.
See https://github.com/electrohire/electrohire-agents for the roadmap.
"""

from .client import ElectroHireClient, ElectroHireError

__all__ = ["ElectroHireClient", "ElectroHireError"]
__version__ = "0.3.0"
