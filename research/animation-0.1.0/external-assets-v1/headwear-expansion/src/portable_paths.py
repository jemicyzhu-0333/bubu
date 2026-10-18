"""Explicit cache-only evidence outputs; packaged sources remain immutable."""
import argparse
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--repo-root',type=Path)
parser.add_argument('--reference-root',type=Path,required=True)
parser.add_argument('--cache-root',type=Path,required=True)
args,remaining=parser.parse_known_args()
ASSET=Path(__file__).resolve().parents[1]
P=args.cache_root.resolve()/ASSET.name
R=args.reference_root.resolve()
REPO=args.repo_root.resolve() if args.repo_root else None
COLLISION=ASSET.parent/'shared/tea/triangle-collision.py'
for d in ['review','reports']:(P/d).mkdir(parents=True,exist_ok=True)
