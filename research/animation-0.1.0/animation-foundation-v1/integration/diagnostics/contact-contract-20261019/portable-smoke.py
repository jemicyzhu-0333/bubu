#!/usr/bin/env python3
"""Replay a renamed, isolated copy; never rewrite the frozen measurement bundle."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent
REPORTS = ("contact-report.json", "pin-depth-report.json",
           "displacement-report.json", "runtime-provenance.json")
SCRIPTS = ("audit.py", "pin-depth.py", "displacement.py", "verify-provenance.py")


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def equal(actual, expected, location="$"):
    """Exact structures/integers; tight cross-platform floating point tolerance."""
    if isinstance(expected, bool) or expected is None or isinstance(expected, str):
        if actual != expected or type(actual) is not type(expected):
            raise AssertionError(f"{location}: value/type changed")
    elif isinstance(expected, (int, float)):
        import math
        if isinstance(actual, bool) or not isinstance(actual, (int, float)):
            raise AssertionError(f"{location}: numeric type changed")
        if not math.isfinite(actual) or not math.isfinite(expected):
            raise AssertionError(f"{location}: nonfinite number")
        if isinstance(expected, int):
            if actual != expected:
                raise AssertionError(f"{location}: integer changed")
        elif not math.isclose(actual, expected, rel_tol=1e-10, abs_tol=1e-12):
            raise AssertionError(f"{location}: numeric result changed")
    elif isinstance(expected, list):
        if not isinstance(actual, list) or len(actual) != len(expected):
            raise AssertionError(f"{location}: array changed")
        for i, (a, b) in enumerate(zip(actual, expected)):
            equal(a, b, f"{location}[{i}]")
    elif isinstance(expected, dict):
        if not isinstance(actual, dict) or actual.keys() != expected.keys():
            raise AssertionError(f"{location}: fields changed")
        for key in expected:
            equal(actual[key], expected[key], f"{location}.{key}")
    else:
        raise TypeError(location)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--timeout", type=float, default=600)
    args = parser.parse_args()
    output = args.output.resolve()
    if output.is_relative_to(ROOT):
        parser.error("Output must be outside the frozen audit bundle")
    if output.exists():
        parser.error("Use a new output file")
    import numpy
    import scipy
    files = [p for p in ROOT.rglob("*")
             if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc"]
    before = {str(p.relative_to(ROOT)): sha(p) for p in files}
    result = {
        "status": "running", "scope": "sampled-data replay only",
        "compatibilityAccepted": False, "python": sys.version.split()[0],
        "numpy": numpy.__version__, "scipy": scipy.__version__,
        "inputHashes": before, "runs": [], "comparison": "exact structure; float rtol=1e-10 atol=1e-12",
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2))
    try:
        with tempfile.TemporaryDirectory(prefix="bubu-contact-") as tmp:
            base = Path(tmp)
            copy = base / "异地 恢复" / "contact renamed"
            copy.mkdir(parents=True)
            for name in before:
                destination = copy / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / name, destination)
            unrelated = base / "unrelated-cwd"
            unrelated.mkdir()
            for script in SCRIPTS:
                start = time.monotonic()
                run = subprocess.run(
                    [sys.executable, str(copy / script)], cwd=unrelated,
                    env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
                    capture_output=True, text=True, timeout=args.timeout)
                result["runs"].append({
                    "script": script, "exitCode": run.returncode,
                    "elapsedSec": time.monotonic() - start,
                })
                if run.returncode:
                    raise RuntimeError(f"{script}: {run.stderr[-4000:]}")
                print(f"{script}: passed", flush=True)
            for report in REPORTS:
                equal(json.loads((copy / report).read_text()),
                      json.loads((ROOT / report).read_text()))
            result["reports"] = {name: sha(copy / name) for name in REPORTS}
            if any(sha(ROOT / name) != value for name, value in before.items()):
                raise AssertionError("Frozen bundle changed during replay")
            result["status"] = "passed"
            result["frozenBundleUnchanged"] = True
    except BaseException as error:
        result["status"] = "failed"
        result["failure"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        output.write_text(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
