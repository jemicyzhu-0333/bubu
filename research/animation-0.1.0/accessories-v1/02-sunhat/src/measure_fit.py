# Compatibility entry point: current actual-mesh fit audit, explicit --body required.
import runpy
from pathlib import Path
runpy.run_path(str(Path(__file__).with_name('audit_fit.py')),run_name='__main__')
