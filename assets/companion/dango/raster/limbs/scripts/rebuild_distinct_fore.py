#!/usr/bin/env python3
"""Rebuild only distinct fore outputs and dependent joints from retained master.

Run from any directory: python PACKAGE/scripts/rebuild_distinct_fore.py --output EMPTY_DIR
Requires Python 3.10+ and the package scripts/requirements.txt (Pillow).
Never modifies the source package or promotes runtime readiness.
"""
from pathlib import Path
from PIL import Image
import argparse, hashlib, importlib.util, json, shutil, subprocess, sys

ROOT = Path(__file__).resolve().parents[1]
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path):
    return json.loads(path.read_text())
def main(output):
    if output.is_relative_to(ROOT):
        raise ValueError('Output must be outside the source package')
    if output.exists() and any(output.iterdir()):
        raise ValueError('Output must be empty')
    output.mkdir(parents=True, exist_ok=True)
    source_recipe = read(ROOT / 'sources/evidence/distinct-fore-v3/source-recipe.json')
    master = ROOT / source_recipe['master']
    assert sha(master) == source_recipe['masterSha256']
    crop = Image.open(master).convert('RGBA').crop(source_recipe['crop'])
    for y in range(crop.height):
        for x in range(crop.width):
            pixel = crop.getpixel((x, y))
            crop.putpixel((x, y), (*pixel[:3], 255) if pixel[3] >= 240 else (0, 0, 0, 0))
    frames = read(ROOT / 'fore-frames.json')
    source = output / frames[0]['source']
    source.parent.mkdir(parents=True, exist_ok=True)
    crop.save(source)
    assert sha(source) == frames[0]['sourceSha256']
    assert crop.tobytes() == Image.open(ROOT / frames[0]['source']).convert('RGBA').tobytes()
    spec = importlib.util.spec_from_file_location('asset_rebuild', ROOT / 'scripts/rebuild.py')
    compiler = importlib.util.module_from_spec(spec)
    previous_bytecode = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(compiler)
    finally:
        sys.dont_write_bytecode = previous_bytecode
    compiler.ROOT = output
    palette = read(ROOT / 'sources/rebuild-recipe.json')['palette']
    for frame in frames:
        image = compiler.sample(frame, palette)
        compiler.save(image, output / frame['src'])
        compiler.save(image.resize((image.width * 8, image.height * 8), Image.Resampling.NEAREST), output / frame['productionSrc'])
        pivot = Image.new('RGBA', image.size)
        for key in ['root', 'tip']:
            pivot.putpixel(tuple(int(v) for v in frame[key]), compiler.COLORS[key])
        compiler.save(pivot, output / frame['pivot'])
        for key in ['src', 'productionSrc', 'pivot']:
            assert sha(output / frame[key]) == sha(ROOT / frame[key]), frame[key]
    manifest = read(ROOT / 'limbs.json')
    for frame in manifest['segments']['arm-upper-l']['frames']:
        target = output / frame['src']
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / frame['src'], target)
    (output / 'limbs.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (output / 'scripts').mkdir(exist_ok=True)
    shutil.copyfile(ROOT / 'scripts/build_joint_pairs.py', output / 'scripts/build_joint_pairs.py')
    subprocess.run([sys.executable, str(output / 'scripts/build_joint_pairs.py')], check=True)
    joints = read(ROOT / 'joints/elbow.json')
    generated = read(output / 'joints/elbow.json')
    assert generated == joints
    verified = 0
    for frame in joints['frames']:
        for key in ['mask', 'patch', 'maskProduction', 'patchProduction', 'pivot']:
            assert sha(output / frame[key]) == sha(ROOT / frame[key]), frame[key]
            verified += 1
    assert sha(output / 'joints/contact-sheet.png') == sha(ROOT / 'joints/contact-sheet.png')
    print(json.dumps({'masterCropExact': True, 'foreOutputsExact': 48, 'jointOutputsExact': verified,
                      'jointRecordsExact': 256, 'contactSheetExact': True, 'runtimeReady': False}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    main(parser.parse_args().output.resolve())
