# electrohire (Python SDK)

Python client for the [ElectroHire](https://electrohire.com) API — the
AI-powered electronics engineering marketplace. Built for agent developers
working in Python; the API itself runs as TypeScript on Cloudflare Workers.

> **0.3.0.** `health()`, the read endpoints (site content, services,
> FAQ, pricing, blog, events), and the three tool endpoints (cost
> estimator, scoping checklist, timeline calculator) are implemented. The package is
> not yet published to PyPI; install it from this repository. Its test
> suite runs against a served API: `EH_API_URL=http://127.0.0.1:8787
> python -m unittest discover -s sdk/python/tests`.

## Install

```bash
pip install -e sdk/python          # from a clone of electrohire-agents
```

Requires Python >= 3.10. No third-party dependencies — standard library only.

## Use

```python
from electrohire import ElectroHireClient

client = ElectroHireClient()                    # https://api-beta.electrohire.com (the live beta API)
print(client.health())                          # {"status": "ok", "version": "0.7.0"}

# Against a local or staging API:
local = ElectroHireClient("http://localhost:8787")
print(local.health())
```

## Versioning

The SDK is semantically versioned independently and tracks the API's `/v1`
surface. See `../../docs/architecture.md` for the versioning policy.
