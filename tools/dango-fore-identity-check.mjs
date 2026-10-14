// PET_VISUAL「按证据范围验收」: distinct material evidence is not anatomy,
// continuous-motion, root-contour, runtime-readiness, or native acceptance.
// node tools/dango-fore-identity-check.mjs [--root=/path/to/limbs] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const DEFAULT_ROOT = fileURLToPath(new URL('../assets/companion/dango/raster/limbs/', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const stable = value => JSON.stringify(value, (_, v) => v && !Array.isArray(v) && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);

// Ignore canvas padding, translation, invisible RGB, PNG metadata and encoding.
// Preserve every nonzero-alpha pixel, including antialiasing: no fuzzy tolerance.
export function visibleIdentity({ width, height, data }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || data.length !== width * height * 4) {
    throw new Error('Invalid decoded RGBA dimensions');
  }
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!data[(y * width + x) * 4 + 3]) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (right < 0) throw new Error('Empty visible material');
  const w = right - left + 1, h = bottom - top + 1;
  const pixels = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const from = ((y + top) * width + x + left) * 4, to = (y * w + x) * 4;
    if (data[from + 3]) for (let c = 0; c < 4; c++) pixels[to + c] = data[from + c];
  }
  return { width: w, height: h, sha256: digest(Buffer.concat([Buffer.from(`${w},${h}:`), pixels])) };
}

function packageReader(root) {
  const base = fs.realpathSync(root), images = new Map();
  const bytes = relative => {
    if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('Expected package-relative evidence path');
    const target = fs.realpathSync(path.resolve(base, relative));
    if (!target.startsWith(base + path.sep)) throw new Error(`Evidence escapes package: ${relative}`);
    return fs.readFileSync(target);
  };
  const png = async relative => {
    if (!images.has(relative)) images.set(relative, (async () => {
      const raw = bytes(relative);
      if (!raw.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`Not a PNG: ${relative}`);
      const image = await loadImage(raw), canvas = createCanvas(image.width, image.height);
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      const visible = visibleIdentity({ width: image.width, height: image.height,
        data: context.getImageData(0, 0, image.width, image.height).data });
      return { bytesSha256: digest(raw), visible };
    })());
    return images.get(relative);
  };
  return { bytes, png };
}

function requireHash(actual, declared, label) {
  if (!/^[a-f0-9]{64}$/.test(declared || '') || actual !== declared) throw new Error(`${label} hash missing or mismatched`);
}

async function frameEvidence(frame, reader) {
  const logical = await reader.png(frame.src), production = await reader.png(frame.productionSrc);
  const source = await reader.png(frame.source), recipeBytes = reader.bytes(frame.sourceRecipe);
  requireHash(logical.bytesSha256, frame.sha256, 'frame');
  requireHash(source.bytesSha256, frame.sourceSha256, 'source');
  requireHash(digest(recipeBytes), frame.sourceRecipeSha256, 'recipe');
  const result = { angle: frame.angle, src: frame.src, logical, production, source,
    recipeBytesSha256: digest(recipeBytes), extractionSha256: null, provenanceError: null,
    matrixSha256: digest(stable(frame.inverseSamplingMatrix ?? null)) };
  try {
    result.extractionSha256 = await extractionIdentity(frame, JSON.parse(recipeBytes), reader);
  } catch (error) { result.provenanceError = error.message; }
  return result;
}

async function extractionIdentity(frame, recipe, reader) {
  const source = await reader.png(frame.source);
  const master = await reader.png(recipe.master ?? recipe.source);
  requireHash(master.bytesSha256, recipe.masterSha256 ?? recipe.sourceSha256, 'master');
  if (recipe.sourceCropFile) {
    const cropSource = await reader.png(recipe.sourceCropFile);
    if (cropSource.visible.sha256 !== source.visible.sha256) throw new Error('Recipe source crop disagrees with frame source');
  }
  if (!Array.isArray(recipe.crop) || recipe.crop.length !== 4 || !recipe.crop.every(Number.isFinite)
      || recipe.crop[2] <= recipe.crop[0] || recipe.crop[3] <= recipe.crop[1]) throw new Error('Missing or invalid extraction crop');
  let mask;
  if (recipe.maskFile) {
    const image = await reader.png(recipe.maskFile);
    requireHash(image.bytesSha256, recipe.maskSha256, 'mask');
    mask = { visibleSha256: image.visible.sha256 };
  } else if (recipe.schema === 'dango-source-distinct-fore/1') {
    // This reviewed recipe uses rectangular cuts with source alpha, not a polygon
    // or an external mask. Its material is verified separately from recipe prose.
    mask = { kind: 'rectangular-source-alpha' };
  } else {
    if (!Array.isArray(recipe.polygon) || recipe.polygon.length < 3
        || !recipe.polygon.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) {
      throw new Error('Missing geometric polygon or verified maskFile; historical labels do not count');
    }
    mask = { polygon: recipe.polygon };
  }
  const matrix = frame.inverseSamplingMatrix;
  if (!Array.isArray(matrix) || matrix.length !== 2
      || !matrix.every(row => Array.isArray(row) && row.length === 3 && row.every(Number.isFinite))) {
    throw new Error('Missing or invalid inverse sampling matrix');
  }
  return digest(stable({ master: master.visible.sha256, crop: recipe.crop, mask }));
}

export async function auditForeIdentity(root = DEFAULT_ROOT) {
  const report = { status: 'FAIL', scope: 'Distinct material and declared extraction-chain evidence only; not complete author provenance, anatomy, rebuild fidelity, runtime readiness or native acceptance.',
    failures: [], pairs: [], duplicates: [], runtimeReady: null, materialStatus: 'FAIL', sourceChainStatus: 'FAIL' };
  let manifest, reader;
  try {
    reader = packageReader(root);
    manifest = JSON.parse(reader.bytes('limbs.json'));
    report.runtimeReady = manifest.extensions?.runtimeReady ?? null;
  } catch (error) { report.failures.push(error.message); return report; }
  const evidence = {};
  for (const segment of ['arm-upper-l', 'arm-fore-l']) {
    const frames = manifest.segments?.[segment]?.frames;
    evidence[segment] = [];
    if (!Array.isArray(frames) || !frames.length) { report.failures.push(`${segment}: missing frames`); continue; }
    const angles = new Set();
    for (const frame of frames) {
      if (!Number.isFinite(frame.angle) || angles.has(frame.angle)) {
        report.failures.push(`${segment}: invalid or repeated angle ${frame.angle}`); continue;
      }
      angles.add(frame.angle);
      try {
        const item = await frameEvidence(frame, reader);
        evidence[segment].push(item);
        if (item.provenanceError) report.failures.push(`${segment}@${frame.angle}: ${item.provenanceError}`);
      }
      catch (error) { report.failures.push(`${segment}@${frame.angle}: ${error.message}`); }
    }
  }
  const upper = evidence['arm-upper-l'], fore = evidence['arm-fore-l'];
  for (const frame of fore) {
    const corresponding = upper.find(candidate => candidate.angle === frame.angle);
    if (!corresponding) { report.failures.push(`fore@${frame.angle}: missing upper angle/evidence`); continue; }
    report.pairs.push({ angle: frame.angle,
      samePngBytes: corresponding.logical.bytesSha256 === frame.logical.bytesSha256,
      sameVisibleRgba: corresponding.logical.visible.sha256 === frame.logical.visible.sha256,
      sameProductionVisibleRgba: corresponding.production.visible.sha256 === frame.production.visible.sha256,
      sameSourceVisibleRgba: corresponding.source.visible.sha256 === frame.source.visible.sha256,
      sameRecipeBytes: corresponding.recipeBytesSha256 === frame.recipeBytesSha256,
      sameExtraction: frame.extractionSha256 === null || corresponding.extractionSha256 === null
        ? null : corresponding.extractionSha256 === frame.extractionSha256,
      sameMatrix: corresponding.matrixSha256 === frame.matrixSha256 });
    // Compare against every upper frame: relabeling/reordering angles is not new material.
    for (const candidate of upper) {
      const matches = [];
      for (const key of ['logical', 'production', 'source']) {
        if (candidate[key].visible.sha256 === frame[key].visible.sha256) matches.push(key);
      }
      if (frame.extractionSha256 !== null && candidate.extractionSha256 === frame.extractionSha256) matches.push('extraction');
      if (matches.length) report.duplicates.push({ foreAngle: frame.angle, upperAngle: candidate.angle, matches });
    }
  }
  for (const frame of upper) if (!fore.some(candidate => candidate.angle === frame.angle)) {
    report.failures.push(`upper@${frame.angle}: missing fore angle/evidence`);
  }
  const complete = report.pairs.length > 0 && report.pairs.length === upper.length && upper.length === fore.length
    && upper.length === manifest.segments?.['arm-upper-l']?.frames?.length
    && fore.length === manifest.segments?.['arm-fore-l']?.frames?.length;
  report.materialStatus = complete && !report.duplicates.some(d => d.matches.some(m => m !== 'extraction')) ? 'PASS' : 'FAIL';
  report.sourceChainStatus = report.failures.length ? 'FAIL' : 'PASS';
  if (report.duplicates.length) report.failures.push(`${report.duplicates.length} fore/upper evidence collisions`);
  if (!report.pairs.length) report.failures.push('No complete fore/upper angle pairs');
  report.status = report.failures.length ? 'FAIL' : 'PASS';
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = process.argv.find(arg => arg.startsWith('--root='))?.slice(7);
  const report = await auditForeIdentity(root);
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`${report.status}: Dango independent fore identity (${report.pairs.length} complete angle pairs)`);
    console.log(`  material=${report.materialStatus}; sourceChain=${report.sourceChainStatus}`);
    for (const failure of report.failures) console.log(`  ${failure}`);
    console.log(report.scope);
  }
  process.exitCode = report.status === 'PASS' ? 0 : 1;
}
