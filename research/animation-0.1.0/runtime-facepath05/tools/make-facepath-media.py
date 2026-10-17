#!/usr/bin/env python3
"""Compose fixed-scale 99 px movies and timestamped runtime contact sheets.

Only uniform scaling/compositing of offline Blender output is performed.
No artwork edits, expression remapping, retiming, or intermediate frames.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BACKGROUND = (239, 236, 232)
SOURCE_SIZE = (414, 342)
SCALED_SIZE = (141, 116)
MOVIE_SIZE = (256, 160)
VIEWS = ("front", "quarter", "opposite", "side")
SCENARIOS = ("semantic_chain", "eye_change", "basis_brow_tongue", "interruption", "return_current")


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")
    temporary.replace(path)


def font(size):
    path = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
    return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.load_default()


def source_image(root, record):
    path = root / record["file"]
    if digest(path) != record["sha256"]:
        raise ValueError(f"Rendered image hash mismatch: {path}")
    image = Image.open(path).convert("RGBA")
    if image.size not in (SOURCE_SIZE, SCALED_SIZE):
        raise ValueError("Unexpected source resolution; refusing variable scale")
    if list(image.size) != record.get("resolution", list(SOURCE_SIZE)):
        raise ValueError("Image dimensions disagree with render provenance")
    return image


def fixed_scaled(image):
    if image.size == SCALED_SIZE:
        return image
    return image.resize(SCALED_SIZE, Image.Resampling.LANCZOS)


def place(image, canvas, x, y):
    canvas.paste(image, (x, y), image)


def frame_canvas(image):
    canvas = Image.new("RGB", MOVIE_SIZE, BACKGROUND)
    scaled = fixed_scaled(image)
    place(scaled, canvas, (MOVIE_SIZE[0] - scaled.width) // 2, (MOVIE_SIZE[1] - scaled.height) // 2)
    return canvas


def sample_label(sample):
    state = sample["state"]
    labels = sample.get("labels", sample.get("reasons", sample.get("label", sample.get("reason", []))))
    if isinstance(labels, str):
        labels = [labels]
    if not isinstance(labels, list):
        labels = [str(labels)]
    return [f"t={sample['time']:.6f}s", f"{state.get('path') or 'Basis'}  {state['value']:.6f}  {state.get('phase', '')}"] + labels


def wrap_text(draw, lines, width, text_font):
    result = []
    for line in lines:
        words = str(line).split()
        current = ""
        for word in words:
            candidate = f"{current} {word}".strip()
            if current and draw.textlength(candidate, font=text_font) > width:
                result.append(current)
                current = word
            else:
                current = candidate
        result.append(current)
    return result


def contact_sheets(root, report, out, page_rows=5):
    diagnostics = report["diagnostics"]
    if not diagnostics:
        raise ValueError("Exact runtime diagnostic samples required for contact sheets")
    results = []
    small, title = font(11), font(15)
    cell_w = 186
    for offset in range(0, len(diagnostics), page_rows):
        samples = diagnostics[offset:offset + page_rows]
        # Variable label area expands rows, never the artwork or its scale.
        probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
        wrapped = [wrap_text(probe, sample_label(sample), cell_w - 16, small) for sample in samples]
        row_h = [SCALED_SIZE[1] + 32 + 14 * len(lines) for lines in wrapped]
        sheet = Image.new("RGB", (cell_w * 4, 44 + sum(row_h)), BACKGROUND)
        draw = ImageDraw.Draw(sheet)
        draw.text((12, 10), f"{report['name']} | actual runtime samples | fixed99px | offline Blender", fill=(50, 48, 46), font=title)
        y = 44
        for sample, lines, height in zip(samples, wrapped, row_h):
            for column, view in enumerate(VIEWS):
                x = cell_w * column
                draw.text((x + 10, y), view, fill=(65, 62, 59), font=small)
                image = fixed_scaled(source_image(root, sample["images"][view]))
                place(image, sheet, x + (cell_w - image.width) // 2, y + 17)
                for index, line in enumerate(lines):
                    draw.text((x + 8, y + 19 + SCALED_SIZE[1] + 14 * index), line, fill=(50, 48, 46), font=small)
            y += height
        path = out / f"{report['name']}-keyframes-{offset // page_rows + 1:02d}.png"
        sheet.save(path)
        results.append({"file": path.name, "sha256": digest(path), "firstDiagnostic": offset,
                        "count": len(samples), "dimensions": list(sheet.size)})
    return results


def encode_movie(frame_folder, path, frame_count, fps=30):
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-framerate", str(fps),
               "-start_number", "0", "-i", str(frame_folder / "%06d.png"), "-frames:v", str(frame_count),
               "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p",
               "-movflags", "+faststart", "-r", str(fps), str(path)]
    subprocess.run(command, check=True)
    probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0",
                   "-show_entries", "stream=width,height,r_frame_rate,nb_frames,duration", "-of", "json", str(path)]))
    stream = probe["streams"][0]
    if (stream["width"], stream["height"]) != MOVIE_SIZE or stream["r_frame_rate"] != "30/1":
        raise ValueError("Unexpected encoded movie size/frame rate")
    if int(stream["nb_frames"]) != frame_count or abs(float(stream["duration"]) - frame_count / fps) > 1e-5:
        raise ValueError("Movie timing differs from actual runtime sampling")
    return {"file": path.name, "sha256": digest(path), "frames": frame_count, "fps": fps,
            "mediaDuration": frame_count / fps, "dimensions": list(MOVIE_SIZE), "labels": False,
            "probe": stream}


def native_calibration(root, out):
    """Produce direct-native/downsampled-source comparison without retouching."""
    manifest = root / "calibration/manifest.json"
    report = json.loads(manifest.read_text())
    rows = []
    sheet = Image.new("RGB", (640, 208 * len(report["samples"]) + 38), BACKGROUND)
    draw = ImageDraw.Draw(sheet)
    title, label = font(15), font(12)
    draw.text((12, 9), "Same actual runtime sample | fixed camera/scale | direct native vs source reduced", fill=(50, 48, 46), font=title)
    for index, row in enumerate(report["samples"]):
        source = source_image(root, row["images"]["source"])
        reduced = fixed_scaled(source)
        native = source_image(root, row["images"]["native"])
        # Compare the final presented pixels without changing either artwork.
        from PIL import ImageChops, ImageStat
        difference = ImageChops.difference(reduced, native)
        stats = ImageStat.Stat(difference)
        record = {"name": row["name"], "time": row["sample"]["time"],
                  "sourceAlphaBounds128": source.getchannel("A").point(lambda v: 255 if v > 128 else 0).getbbox(),
                  "reducedAlphaBounds128": reduced.getchannel("A").point(lambda v: 255 if v > 128 else 0).getbbox(),
                  "nativeAlphaBounds128": native.getchannel("A").point(lambda v: 255 if v > 128 else 0).getbbox(),
                  "meanAbsRGBA": stats.mean, "maximumAbsRGBA": [extreme[1] for extreme in stats.extrema],
                  "pixelExact": all(extreme[1] == 0 for extreme in stats.extrema)}
        rows.append(record)
        y = 38 + index * 208
        draw.text((12, y), f"{row['name']}  t={row['sample']['time']:.6f}s", fill=(50, 48, 46), font=title)
        for column, (image, caption) in enumerate(((reduced, "414x342 source, reduced to141x116"), (native, "Direct141x116, same orthographic scale"))):
            place(image, sheet, column * 320 + (320 - image.width) // 2, y + 30)
            draw.text((column * 320 + 12, y + 155), caption, fill=(50, 48, 46), font=label)
    path = out / "native-vs-source-calibration.png"
    sheet.save(path)
    write_json(out / "native-calibration.json", {"format": "bubu-facepath-native-calibration-comparison",
               "renderManifestSHA256": digest(manifest), "comparison": {"file": path.name, "sha256": digest(path)},
               "samples": rows, "visualAcceptance": "Not automatically decided; inspect same-sample silhouette and face details before choosing main-resolution."})
    print(json.dumps(rows, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--render-dir", type=Path, default=ROOT / "evidence/facepath-render")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "evidence/facepath-media")
    parser.add_argument("--only", choices=SCENARIOS, action="append")
    parser.add_argument("--sheets-only", action="store_true")
    parser.add_argument("--calibration-only", action="store_true")
    args = parser.parse_args()
    out = args.output_dir.resolve()
    if not out.is_relative_to(ROOT):
        raise ValueError("Media output must stay inside facepath05 workspace")
    out.mkdir(parents=True, exist_ok=True)
    if args.calibration_only:
        native_calibration(args.render_dir, out)
        return
    results = []
    concatenated = []
    for name in args.only or SCENARIOS:
        manifest = args.render_dir / name / "manifest.json"
        report = json.loads(manifest.read_text())
        if report.get("format") != "bubu-facepath-render" or report.get("name") != name:
            raise ValueError("Unexpected render manifest")
        calibration = report["calibration"]
        if calibration["sourceBasisHeight"] != 291 or calibration["targetBasisHeight"] != 99:
            raise ValueError("Unexpected fixed-scale calibration")
        if calibration["scaledFullFrame"] != list(SCALED_SIZE) or report["fps"] != 30:
            raise ValueError("Unexpected scale or frame rate")
        if not report.get("fixedBodyRigVerified"):
            raise ValueError("Missing fixed-body/rig verification")
        item = {"name": name, "renderManifestSHA256": digest(manifest),
                "contactSheets": contact_sheets(args.render_dir, report, out),
                "calibration": calibration, "offlineBlenderNotWebGL": True,
                "mainRasterMode": report["mainRasterMode"], "mainResolution": report["mainResolution"]}
        if not args.sheets_only:
            movie_frames = len(report["frames"])
            if movie_frames != round(report["duration"] * report["fps"]) + 1:
                raise ValueError("Expected inclusive-endpoint replay samples")
            frame_folder = out / "frames" / name
            frame_folder.mkdir(parents=True, exist_ok=True)
            for index, frame in enumerate(report["frames"]):
                if frame["frame"] != index or abs(frame["time"] - index / 30) > 1e-9:
                    raise ValueError("Movie samples must retain the exact30Hz export grid")
                image = frame_canvas(source_image(args.render_dir, frame["image"]))
                destination = frame_folder / f"{index:06d}.png"
                image.save(destination)
                concatenated.append(destination)
            item["movie"] = encode_movie(frame_folder, out / f"{name}-native99-normal-speed.mp4", movie_frames)
            item["movie"]["timelineDuration"] = report["duration"]
            item["movie"]["endpointPolicy"] = "All actual30Hz frames including t=0 and timelineDuration are encoded. Media duration is frameCount/30, one frame longer than the sampled timeline."
        results.append(item)
        print(f"MEDIA COMPLETE {name}", flush=True)
    index = {"format": "bubu-facepath-media", "offlineBlenderNotWebGL": True,
             "backgroundRGB": list(BACKGROUND), "mainMovieLabels": False,
             "scalePolicy": "Native141x116 at unchanged orthographic scale, or one uniform414x342-to141x116 resize; modes recorded per scenario. No per-pose fitting or crop.",
             "results": results}
    if len(results) > 1 and not args.sheets_only:
        # Concatenate unchanged actual frames, without interpolated transitions.
        combined_dir = out / "frames" / "combined"
        combined_dir.mkdir(parents=True, exist_ok=True)
        import shutil
        for number, source in enumerate(concatenated):
            shutil.copyfile(source, combined_dir / f"{number:06d}.png")
        index["combinedMovie"] = encode_movie(combined_dir, out / "facepath05-native99-normal-speed.mp4", len(concatenated))
        index["combinedMovie"]["scenarioOrder"] = [item["name"] for item in results]
        index["combinedMovie"]["timelineDuration"] = sum(item["movie"]["timelineDuration"] for item in results)
        index["combinedMovie"]["transitionPolicy"] = "Direct scenario concatenation, no added frames or retiming."
    write_json(out / "manifest.json", index)


if __name__ == "__main__":
    main()
