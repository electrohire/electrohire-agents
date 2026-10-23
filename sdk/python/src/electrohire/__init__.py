"""Python client for the ElectroHire API.

Scaffold package: only :meth:`ElectroHireClient.health` is implemented.
See https://github.com/electrohire/electrohire-agents for the roadmap.
"""

from .client import ElectroHireClient, ElectroHireError

__all__ = ["ElectroHireClient", "ElectroHireError"]
__version__ = "0.1.0"
