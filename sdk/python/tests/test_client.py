"""C-06 SDK tests (LOCAL ONLY): run against the locally served API.

    EH_API_URL=http://127.0.0.1:8787 python -m unittest discover -s sdk/python/tests

The suite is NOT skipped when the API is unreachable — a missing server is a
failure, because this suite exists to prove the SDK against the served API.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from electrohire import ElectroHireClient  # noqa: E402

BASE = os.environ.get("EH_API_URL", "http://127.0.0.1:8787")


class TestC1Coverage(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = ElectroHireClient(BASE)

    def test_health(self):
        self.assertEqual(self.client.health()["status"], "ok")

    def test_site_content_fees_and_entities(self):
        body = self.client.site_content()
        self.assertEqual(body["fees"]["clientFeePct"], 10)
        names = sorted(e["name"] for e in body["entities"])
        self.assertEqual(names, ["ElectroHire Inc", "ElectroHire Ltd"])

    def test_services_categories(self):
        self.assertEqual(len(self.client.services()["categories"]), 6)

    def test_faq_filter(self):
        self.assertEqual(self.client.faq("pods")["total"], 5)
        self.assertGreaterEqual(self.client.faq()["total"], 29)

    def test_pricing_has_no_pod_price(self):
        # Same assertion as the frozen C-01 battery: no price key and no
        # currency amount anywhere in the pod presentation. (The word
        # "price" itself appears in the honest sentence "publishes no fixed
        # price table" — that sentence is the absence, stated plainly.)
        import json as _json, re as _re
        pricing = self.client.pricing()
        pod_json = _json.dumps(pricing["pods"])
        self.assertIsNone(_re.search(r'"price"|"amount"|£|\$\s?\d', pod_json))
        self.assertTrue(any(t.get("name") == "Startup Pro" for t in pricing["ukHub"]["tiers"]))

    def test_estimate_is_range_with_assumptions(self):
        est = self.client.estimate_cost(["pcb", "firmware"], "sensor", "sketch", "proto")
        self.assertEqual((est["range"]["low"], est["range"]["high"]), (10000, 30000))
        self.assertGreaterEqual(len(est["assumptions"]), 2)

    def test_scoping_checklist(self):
        body = self.client.scoping_checklist(["pcb", "wireless"], "sensor")
        items = [i for g in body["groups"] for i in g["items"]]
        self.assertGreaterEqual(len(items), 5)

    def test_timeline(self):
        body = self.client.timeline(["pcb", "firmware", "compliance"], "idea")
        self.assertGreater(body["totalWeeks"]["high"], body["totalWeeks"]["low"])


if __name__ == "__main__":
    unittest.main()
