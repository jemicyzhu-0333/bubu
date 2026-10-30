"""Strict portable JSON for observations with explicit unbounded deadlines."""
import json
import math


def encode_evidence(value):
    def portable(item):
        if isinstance(item, float) and not math.isfinite(item):
            return "NaN" if math.isnan(item) else "Infinity" if item > 0 else "-Infinity"
        if isinstance(item, dict):
            return {key: portable(value) for key, value in item.items()}
        if isinstance(item, (list, tuple)):
            return [portable(value) for value in item]
        return item
    return json.dumps(portable(value), indent=2, allow_nan=False)
