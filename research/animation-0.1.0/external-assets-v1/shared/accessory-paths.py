"""Explicit, fixture-verified inputs for portable accessory review utilities."""
import argparse,pathlib,json,hashlib

def paths(pointer=False,reference=True):
 p=argparse.ArgumentParser();p.add_argument('--reference-root',type=pathlib.Path,required=True);p.add_argument('--cache-root',type=pathlib.Path,required=True)
 if pointer:p.add_argument('--pointer-root',type=pathlib.Path,required=True)
 a=p.parse_args();a.reference_root=a.reference_root.resolve();a.cache_root=a.cache_root.resolve()
 for row in json.load(open(a.reference_root/'fixture-source-manifest.json'))['files']:
  f=a.reference_root/row['path'];assert hashlib.sha256(f.read_bytes()).hexdigest()==row['sha256'],f'Stale fixture source: {f}'
 a.package=pathlib.Path(__file__).resolve().parents[1];a.accessory=a.cache_root/'accessory'
 (a.accessory/'reports').mkdir(parents=True,exist_ok=True);(a.accessory/'review').mkdir(parents=True,exist_ok=True)
 if pointer:a.pointer_root=a.pointer_root.resolve()
 return a
