#!/usr/bin/env python3
"""Replay exported runtime weights in the approved, fixed Blender look.

Inspection (never renders):
  blender -b --python tools/render-facepath-replay.py -- --inspect
After the parent explicitly sends render ready:
  blender -b --python tools/render-facepath-replay.py -- --render --calibration-only
After reviewing the native-resolution calibration:
  blender -b --python tools/render-facepath-replay.py -- --render

This is an offline Blender replay of actual runtime morph weights. It is not a
WebGL capture. No semantic-to-weight mapping or temporal interpolation lives
here. Main movies consume only the regular 30 Hz frames. Exact diagnostic
samples must also come from the runtime exporter.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT.parent / "bubu-3d-a-expression-library-v1-20261017"
ASSET_SHA256 = "a9ae09635658ac15c55cf1571db53e284bd463eaab9a84ff24e7836270a1808e"
LOOK_SHA256 = "b85f9873b7829222510ea02a8acdaebcd5d97d67d3f26efb038a65d7d0a9388d"
ROSTER = ("A_eye_L", "A_eye_R", "A_eye_highlight_L", "A_eye_highlight_R",
          "A_mouth_ring", "A_brow_L", "A_brow_R", "A_tongue")
VIEWS = {"front": 0, "quarter": -52, "opposite": 52, "side": -85}
SCENARIOS = ("semantic_chain", "eye_change", "basis_brow_tongue", "interruption", "return_current")
SOURCE_SIZE = (414, 342)
NATIVE_SIZE = (141, 116)
REFERENCE_HEIGHT = 291
CALIBRATION = {
    "sourceResolution": list(SOURCE_SIZE), "sourceBasisAlphaThreshold": 128,
    "sourceBasisAlphaBounds": [13, 34, 401, 325],
    "sourceBasisHeight": REFERENCE_HEIGHT, "targetBasisHeight": 99,
    "fixedScale": 99 / REFERENCE_HEIGHT, "scaledFullFrame": [141, 116],
    "reference": "bubu-3d-a-face-coordinate-v2-20261016/candidate-a05-selected-faces-r6-review/face-01-0.00-front.png",
    "referenceSHA256": "17d3251704ffa023156e58e588402515e61d998d71e2859fa11aad8a891a5b3d",
    "policy": "One uniform full-frame resize, never per-pose crop or fit; all cameras retain source orthographic scale.",
}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, indent=2, allow_nan=False) + "\n")
    temporary.replace(path)


def owned_output(path):
    path = Path(path).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError("Output must stay inside this facepath05 workspace")
    return path


def finite_number(value, label, minimum=0, maximum=math.inf):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label} must be a finite number")
    if not minimum <= value <= maximum:
        raise ValueError(f"{label} outside [{minimum}, {maximum}]")
    return value


def glb_target_names(path):
    blob = path.read_bytes()
    if digest(path) != ASSET_SHA256:
        raise ValueError("GLB differs from the registered seven-slot slice")
    if struct.unpack_from("<4sII", blob) != (b"glTF", 2, len(blob)):
        raise ValueError("Invalid GLB header")
    length, kind = struct.unpack_from("<II", blob, 12)
    if kind != 0x4E4F534A:
        raise ValueError("Missing GLB JSON chunk")
    gltf = json.loads(blob[20:20 + length])
    target_sets = {}
    for node in gltf["nodes"]:
        if node.get("name") in ROSTER:
            mesh = gltf["meshes"][node["mesh"]]
            target_sets[node["name"]] = tuple(mesh.get("extras", {}).get("targetNames", []))
    if set(target_sets) != set(ROSTER):
        raise ValueError("GLB does not contain the exact eight-layer face roster")
    targets = target_sets[ROSTER[0]]
    if len(targets) != 56 or any(names != targets for names in target_sets.values()):
        raise ValueError("Slice target names/order diverge between face layers")
    return targets


def validate_sample(sample, targets, label):
    if not isinstance(sample, dict) or not isinstance(sample.get("state"), dict):
        raise ValueError(f"{label}: missing actual runtime state")
    time = finite_number(sample.get("time"), f"{label}.time")
    if abs(finite_number(sample["state"].get("time"), f"{label}.state.time") - time) > 1e-9:
        raise ValueError(f"{label}: state clock differs from sample clock")
    finite_number(sample["state"].get("value"), f"{label}.state.value", 0, 1)
    weights = sample.get("weights")
    if not isinstance(weights, dict):
        raise ValueError(f"{label}: missing actual runtime weights")
    for name, weight in weights.items():
        if name not in targets:
            raise ValueError(f"{label}: unknown or non-slice morph target {name}")
        finite_number(weight, f"{label}.weights.{name}", 0, 1)
    # A complete zero sample really is Basis, irrespective of the phase label.
    if sample["state"]["value"] == 0 and any(weights.values()):
        raise ValueError(f"{label}: zero scalar has nonzero morph weights")
    return sample


def read_replay(path, targets):
    replay = json.loads(path.read_text())
    if replay.get("format") != "bubu-facepath-replay" or replay.get("version") != "0.1.0":
        raise ValueError(f"Unsupported replay: {path}")
    replay_roster = replay.get("faceRoster", [])
    if (replay.get("assetSha256") != ASSET_SHA256 or len(replay_roster) != len(ROSTER)
            or set(replay_roster) != set(ROSTER)):
        raise ValueError(f"Replay asset/roster mismatch: {path}")
    if replay.get("fps") != 30:
        raise ValueError("Main movie requires original 30 Hz runtime sampling")
    duration = finite_number(replay.get("duration"), "duration", 0)
    frames = replay.get("frames")
    if not isinstance(frames, list) or len(frames) != round(duration * 30) + 1:
        raise ValueError("Expected inclusive-endpoint 30 Hz runtime frames")
    for index, frame in enumerate(frames):
        validate_sample(frame, targets, f"{path.name}.frames[{index}]")
        if frame.get("frame") != index or abs(frame["time"] - index / 30) > 1e-9:
            raise ValueError("Irregular movie sample grid; no interpolation is allowed")
    diagnostics = replay.get("diagnostics", replay.get("keyframes", []))
    if not isinstance(diagnostics, list):
        raise ValueError("Diagnostics must be full actual-runtime sample records")
    for index, sample in enumerate(diagnostics):
        validate_sample(sample, targets, f"{path.name}.diagnostics[{index}]")
        if sample["time"] > duration + 1e-9:
            raise ValueError("Diagnostic sample outside replay duration")
    replay["diagnostics"] = diagnostics
    return replay


def snapshot_fixed_scene(bpy):
    """Hash all non-camera transforms, body vertices, and pose bone matrices."""
    state = {}
    for obj in bpy.data.objects:
        if obj.type == "CAMERA":
            continue
        row = {"matrix": [float(x) for r in obj.matrix_world for x in r],
               "hideRender": obj.hide_render}
        if obj.type == "MESH" and obj.name not in ROSTER:
            row["vertices"] = [float(x) for vertex in obj.data.vertices for x in vertex.co]
        if obj.type == "ARMATURE":
            row["bones"] = {bone.name: [float(x) for r in bone.matrix_basis for x in r]
                            for bone in obj.pose.bones}
        state[obj.name] = row
    return canonical_hash(state)


def apply_weights(bpy, weights):
    """Clear every shape key on all eight layers, then apply exported values."""
    for name in ROSTER:
        keys = bpy.data.objects[name].data.shape_keys.key_blocks
        for key in keys:
            if key.name != "Basis":
                key.value = 0.0
        for target, value in weights.items():
            keys[target].value = value
    bpy.context.view_layer.update()
    error = 0.0
    for name in ROSTER:
        for key in bpy.data.objects[name].data.shape_keys.key_blocks:
            if key.name != "Basis":
                delta = abs(key.value - weights.get(key.name, 0.0))
                error = max(error, delta)
                if delta > 4e-8:
                    raise ValueError(f"Blender layer weight divergence: {name}/{key.name}")
    return error


def diagnostic_samples(replay):
    """Use runtime-exported diagnostics; never reconstruct their face values."""
    samples = replay["diagnostics"]
    if not samples:
        raise ValueError(f"{replay['name']}: exact runtime diagnostic samples are required")
    selected = []
    for index, sample in enumerate(samples):
        labels, state, time = sample.get("labels", []), sample["state"], sample["time"]
        arrived = state.get("actualArrival") is not None and abs(state["actualArrival"] - time) < 1e-9
        basis = state["value"] == 0 and state.get("neutralAt") is not None and abs(state["neutralAt"] - time) < 1e-9
        brake_end = ("brakeEndsAt" in labels and state.get("brakeEndsAt") is not None
                     and abs(state["brakeEndsAt"] - time) < 1e-9)
        if "event" in labels or "N3-half-crossing" in labels or arrived or basis or brake_end:
            selected.append(dict(sample, sourceDiagnosticIndex=index))
    if not selected:
        raise ValueError("No exact meaningful diagnostic samples; refusing reconstructed keyframes")
    return selected


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--inspect", action="store_true", help="Inspect/validate without rendering (default)")
    mode.add_argument("--render", action="store_true", help="Render only after parent explicitly sends render ready")
    parser.add_argument("--replay-dir", type=Path, default=ROOT / "evidence/facepath-replays")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "evidence/facepath-render")
    parser.add_argument("--blend", type=Path, default=LIBRARY / "bubu-expression-library-v1-look.blend")
    parser.add_argument("--asset", type=Path, default=LIBRARY / "bubu-expression-slice7.glb")
    parser.add_argument("--gate", type=Path, default=LIBRARY / "RENDER-PARITY.json")
    parser.add_argument("--only", choices=SCENARIOS, action="append")
    parser.add_argument("--main-view", choices=VIEWS, default="front")
    parser.add_argument("--main-resolution", choices=("native", "source"), default="source")
    parser.add_argument("--calibration-only", action="store_true", help="Render only actual Basis and N3-half samples at both resolutions")
    parser.add_argument("--samples", type=int, default=96, help="Cycles samples; approved parity renderer uses96")
    args = parser.parse_args(argv)
    if args.samples < 1:
        parser.error("--samples must be positive")
    if args.calibration_only and not args.render:
        parser.error("--calibration-only requires the explicitly authorized --render mode")
    out = owned_output(args.output_dir)
    if digest(args.blend) != LOOK_SHA256:
        raise ValueError("Look blend hash differs from the inspected approved authoring scene")
    targets = glb_target_names(args.asset)
    gate = json.loads(args.gate.read_text())
    gate_hash = digest(args.gate)
    gate_ready = (gate.get("complete") is True and gate.get("allPixelsExact") is True
                  and gate.get("expectedFrames") == 104 and gate.get("actualFrames") == 104)

    import bpy
    from mathutils import Vector
    bpy.ops.wm.open_mainfile(filepath=str(args.blend.resolve()))
    scene = bpy.context.scene
    if scene.camera.data.type != "ORTHO" or abs(scene.camera.data.ortho_scale - 2.54) > 1e-6:
        raise ValueError("Unexpected camera; changing fixed scale is forbidden")
    if (scene.render.resolution_x, scene.render.resolution_y) != SOURCE_SIZE:
        raise ValueError("Unexpected source resolution")
    if scene.view_settings.view_transform != "Standard" or scene.view_settings.look != "None":
        raise ValueError("Unexpected source look")
    for name in ROSTER:
        obj = bpy.data.objects.get(name)
        if not obj or obj.type != "MESH" or not obj.data.shape_keys:
            raise ValueError(f"Missing face layer: {name}")
        keys = obj.data.shape_keys
        if keys.animation_data or obj.animation_data:
            raise ValueError("Animated source face data could override runtime weights")
        if not set(targets).issubset({key.name for key in keys.key_blocks}):
            raise ValueError(f"Authoring layer lacks runtime targets: {name}")
    fixed_before = snapshot_fixed_scene(bpy)
    apply_weights(bpy, {})
    settings = {
        "assetSHA256": ASSET_SHA256, "lookSHA256": LOOK_SHA256,
        "engine": scene.render.engine, "cyclesSamples": args.samples, "cyclesSeed": 0,
        "sourceResolution": list(SOURCE_SIZE), "nativeResolution": list(NATIVE_SIZE),
        "orthographicScale": scene.camera.data.ortho_scale,
        "cameraRadius": 7, "cameraHeight": .95, "cameraTarget": [0, 0, .95],
        "viewsDegrees": VIEWS, "colorTransform": scene.view_settings.view_transform,
        "look": scene.view_settings.look, "filmTransparent": scene.render.film_transparent,
        "fixedBodyRigAndObjectFingerprint": fixed_before,
    }
    names = args.only or SCENARIOS
    replays = []
    for name in names:
        path = args.replay_dir / f"{name}.json"
        if path.exists():
            replay = read_replay(path, targets)
            if replay.get("name") != name:
                raise ValueError("Replay name/path mismatch")
            replays.append((path, replay))
        elif args.render:
            raise FileNotFoundError(f"Missing actual runtime export: {path}")
    inspection = {
        "format": "bubu-facepath-render-inspection", "settings": settings,
        "calibration": CALIBRATION, "staticVisualGateComplete": gate_ready,
        "staticVisualGateSHA256": gate_hash, "renderingRequested": args.render,
        "renderAuthorizationPolicy": "Parent must explicitly send render ready before --render is executed; pixel-exact static gate is informational, not an extra approval condition.",
        "faceLayers": {name: len(bpy.data.objects[name].data.shape_keys.key_blocks) - 1 for name in ROSTER},
        "validatedReplays": [{"name": replay["name"], "frames": len(replay["frames"]),
                              "diagnostics": len(replay["diagnostics"]), "sha256": digest(path)}
                             for path, replay in replays],
        "rendersProduced": False,
    }
    write_json(out / "inspection.json", inspection)
    if not args.render:
        print(json.dumps(inspection, indent=2))
        return
    # Check every diagnostic before producing even one image.
    for _, replay in replays:
        diagnostic_samples(replay)
    scene.cycles.samples = args.samples
    scene.cycles.seed = 0
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.use_file_extension = True
    settings_hash = canonical_hash(settings)
    cache = out / "cache"
    cache.mkdir(parents=True, exist_ok=True)
    max_weight_error = 0.0
    counts = {"rendered": 0, "cacheHits": 0}

    def render_sample(sample, view, destination, resolution=SOURCE_SIZE):
        nonlocal max_weight_error
        weights = sample["weights"]
        max_weight_error = max(max_weight_error, apply_weights(bpy, weights))
        angle = math.radians(VIEWS[view])
        camera = scene.camera
        camera.location = (math.sin(angle) * 7, -math.cos(angle) * 7, .95)
        camera.rotation_euler = (Vector((0, 0, .95)) - camera.location).to_track_quat("-Z", "Y").to_euler()
        bpy.context.view_layer.update()
        scene.render.resolution_x, scene.render.resolution_y = resolution
        key = canonical_hash({"settings": settings_hash, "weights": weights, "view": view,
                              "resolution": resolution})
        cached = cache / f"{key}.png"
        receipt = cache / f"{key}.json"
        valid_cache = False
        if cached.exists() and receipt.exists():
            record = json.loads(receipt.read_text())
            valid_cache = record.get("pngSHA256") == digest(cached) and record.get("settingsSHA256") == settings_hash
        if not valid_cache:
            scene.render.filepath = str(cached)
            bpy.ops.render.render(write_still=True)
            write_json(receipt, {"settingsSHA256": settings_hash, "pngSHA256": digest(cached),
                                 "weightsSHA256": canonical_hash(weights), "view": view,
                                 "resolution": list(resolution)})
            counts["rendered"] += 1
        else:
            counts["cacheHits"] += 1
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(cached, destination)
        return {"file": str(destination.relative_to(out)), "sha256": digest(destination),
                "weightsSHA256": canonical_hash(weights), "view": view,
                "resolution": list(resolution), "cacheReused": valid_cache, "cacheKey": key}

    if args.calibration_only:
        basis = next((sample for _, replay in replays for sample in replay["frames"]
                      if sample["state"]["value"] == 0 and not any(sample["weights"].values())), None)
        half = next((sample for _, replay in replays for sample in replay["diagnostics"]
                     if sample["state"].get("path") == "N3" and abs(sample["state"]["value"] - .5) < 1e-7), None)
        if basis is None or half is None:
            raise ValueError("Calibration requires actual exported Basis and exact N3-half samples")
        calibration_samples = []
        for name, sample in (("Basis", basis), ("N3-half", half)):
            row = {"name": name, "sample": sample, "images": {}}
            for label, resolution in (("source", SOURCE_SIZE), ("native", NATIVE_SIZE)):
                row["images"][label] = render_sample(sample, args.main_view, out / "calibration" / f"{name}-{label}.png", resolution)
            calibration_samples.append(row)
        if snapshot_fixed_scene(bpy) != fixed_before:
            raise ValueError("Body/rig/object data changed during calibration")
        write_json(out / "calibration" / "manifest.json", {
            "format": "bubu-facepath-native-calibration", "settings": settings,
            "calibration": CALIBRATION, "samples": calibration_samples,
            "maxBlenderFloatWeightError": max_weight_error, "counts": counts,
            "fixedBodyRigVerified": True, "parentVisualReviewRequiredBeforeMainFrames": True,
        })
        print("CALIBRATION COMPLETE; main replay frames were not rendered", flush=True)
        return

    reports = []
    for path, replay in replays:
        name = replay["name"]
        report = {
            "format": "bubu-facepath-render", "version": "0.1.0", "name": name,
            "scope": "Offline Blender replay of actual runtime-exported morph weights, not WebGL capture; body/rig fixed at source rest.",
            "replayFile": str(path.resolve()), "replaySHA256": digest(path),
            "timelineSHA256": replay.get("timelineSha256"), "assetSHA256": ASSET_SHA256,
            "lookSHA256": LOOK_SHA256, "staticVisualGateSHA256": gate_hash,
            "settings": settings, "settingsSHA256": settings_hash, "calibration": CALIBRATION,
            "fps": 30, "duration": replay["duration"], "timelineDuration": replay["duration"], "mainView": args.main_view,
            "mainResolution": list(NATIVE_SIZE if args.main_resolution == "native" else SOURCE_SIZE),
            "mainRasterMode": "direct_native" if args.main_resolution == "native" else "downsampled_source",
            "sourceDiagnosticCount": len(replay["diagnostics"]),
            "diagnosticSelectionPolicy": "Actual event samples, confirmed arrivals, actual Basis boundaries, N3-half crossings, brake endpoints. Event+/-1us near-duplicates and superseded forecast-only times remain in source JSON without redundant multiview images.",
            "frames": [], "diagnostics": [],
        }
        for frame in replay["frames"]:
            entry = dict(frame)
            entry["image"] = render_sample(frame, args.main_view, out / name / "frames" / f"{frame['frame']:06d}.png",
                                           NATIVE_SIZE if args.main_resolution == "native" else SOURCE_SIZE)
            report["frames"].append(entry)
            print(f"FRAME {name} {frame['frame']}/{len(replay['frames']) - 1} t={frame['time']:.9f}", flush=True)
        for index, sample in enumerate(diagnostic_samples(replay)):
            entry = dict(sample)
            entry["images"] = {view: render_sample(sample, view, out / name / "diagnostics" / f"{index:04d}-{view}.png") for view in VIEWS}
            report["diagnostics"].append(entry)
            print(f"DIAGNOSTIC {name} {index} t={sample['time']:.9f}", flush=True)
        if snapshot_fixed_scene(bpy) != fixed_before:
            raise ValueError("Body/rig/object data changed during face replay")
        report["maxBlenderFloatWeightError"] = max_weight_error
        report["fixedBodyRigVerified"] = True
        report["renderCountsSoFar"] = dict(counts)
        write_json(out / name / "manifest.json", report)
        reports.append({"name": name, "manifest": f"{name}/manifest.json",
                        "manifestSHA256": digest(out / name / "manifest.json"),
                        "frames": len(report["frames"]), "diagnostics": len(report["diagnostics"])})
        print(f"COMPLETE {name}", flush=True)
    write_json(out / "manifest.json", {"format": "bubu-facepath-render-index", "settings": settings,
               "calibration": CALIBRATION, "renders": reports, "counts": counts,
               "maxBlenderFloatWeightError": max_weight_error, "fixedBodyRigVerified": True})


if __name__ == "__main__":
    cli = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    main(cli)
