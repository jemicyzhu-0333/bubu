import json
import unittest
from json_evidence import encode_evidence


class EvidenceJSON(unittest.TestCase):
    def test_unbounded_nested_deadlines_are_explicit_strings_in_strict_json(self):
        def reject_constant(token):
            raise ValueError(token)
        text = encode_evidence({"state": {"deadline": float("inf")},
                                "observations": [float("-inf"), float("nan"), 0.5]})
        self.assertEqual(json.loads(text, parse_constant=reject_constant),
                         {"state": {"deadline": "Infinity"},
                          "observations": ["-Infinity", "NaN", 0.5]})

    def test_finite_metrics_and_null_remain_typed(self):
        value = {"frameMs": 16.667, "frames": 120, "accepted": False, "error": None}
        self.assertEqual(json.loads(encode_evidence(value)), value)


if __name__ == "__main__":
    unittest.main()
