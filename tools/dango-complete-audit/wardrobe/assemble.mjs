import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ITEMS, VIEWS, PAIRS } from '../inventory.mjs';
import { pinSources, sha256 } from './source-pin.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const out = path.resolve(arg('out') || path.join(root, 'dist/dango-complete-audit/wardrobe'));
const read = file => JSON.parse(fs.readFileSync(path.join(out, file), 'utf8'));
const recordedGuard = read('source-pin.json'), futureGuard = pinSources(root);
const currentRecorded = Object.fromEntries(Object.keys(recordedGuard).map(file => [file, sha256(fs.readFileSync(path.join(root, file)))]));
const sameRecordedSubset = record => Object.entries(record.sourceHashes).every(([file, hash]) => currentRecorded[file] === hash)
  && Object.keys(record.sourceHashes).length === Object.keys(recordedGuard).length && record.changedSources.length === 0;
const snapshotPath = 'dist/pet-complete-production-freeze.json';
const snapshotBytes = fs.existsSync(path.join(root, snapshotPath)) ? fs.readFileSync(path.join(root, snapshotPath)) : null;
const snapshot = snapshotBytes ? JSON.parse(snapshotBytes) : null;
const snapshotChanges = snapshot ? snapshot.files.filter(entry => !fs.existsSync(path.join(root, entry.path))
  || sha256(fs.readFileSync(path.join(root, entry.path))) !== entry.sha256).map(entry => entry.path) : [];
const provenance = {
  recordedGuardScope: 'Only the paths actually stored in each completed batch were checked before and after capture',
  recordedGuardFiles: Object.keys(recordedGuard), recordedGuardFileCount: Object.keys(recordedGuard).length,
  omittedGuardFiles: Object.keys(futureGuard).filter(file => !Object.hasOwn(recordedGuard, file)),
  completeDependencyGuardAtCapture: false,
  limitation: 'The original guard omitted shared rendering/contact/choreography/playback/effect dependencies and diagnostic helpers. The coordinator froze production before the final run; that is not a retroactive per-batch hash guard.',
  futureGuardFileCount: Object.keys(futureGuard).length,
  fullFinalSnapshot: snapshot ? { file: snapshotPath, sha256: sha256(snapshotBytes), inventorySha256: snapshot.sha256,
    scope: snapshot.scope, currentSnapshotMatches: snapshotChanges.length === 0, changedFiles: snapshotChanges,
    note: 'Separate full final inventory, not a retroactive before/after capture guard' } : { file: snapshotPath, status: 'not-present' }
};
const reviews = new Map(read('visual-decisions.json').reviews.map(review => [review.file, review]));
function reviewed(file) {
  const entry = reviews.get(file);
  if (!entry) return { status: 'not-individually-reviewed', findings: [] };
  return sha256(fs.readFileSync(path.join(out, file))) === entry.sha256 ? entry
    : { status: 'awaiting-recheck-after-image-change', findings: [], previousReview: entry };
}
const items = ITEMS.map(item => {
  const folder = `items/${item.renderKey}`, record = read(`${folder}/record.json`), motion = read(`${folder}/motion-record.json`);
  const probe = spawnSync('/usr/bin/ffprobe', ['-v', 'error', '-show_entries', 'stream=avg_frame_rate,nb_frames,duration',
    '-of', 'json', path.join(out, folder, 'run-normal-speed.mp4')], { encoding: 'utf8' });
  if (probe.status !== 0) throw Error(`Invalid clip: ${item.id}`);
  const stream = JSON.parse(probe.stdout).streams[0];
  const clipValid = stream.avg_frame_rate === '30/1' && Number(stream.nb_frames) === 285 && Math.abs(Number(stream.duration) - 9.5) < .01;
  return { id: item.id, key: item.renderKey, slot: item.exclusiveGroup, folder, cases: record.cases.length,
    recordedGuardSubsetCurrent: sameRecordedSubset(record) && sameRecordedSubset(motion), staticNumericFlags: record.staticRows.filter(row => row.numericStatus === 'flagged').length,
    staticReview: reviewed(`${folder}/static-proof.png`), motionReview: reviewed(`${folder}/run-contact-sheet.png`),
    clip: `${folder}/run-normal-speed.mp4`, clipValid, motionSummary: motion.summary,
    records: record.cases.map(entry => ({ itemId: item.id, kind: entry.kind, actionId: entry.actionId, view: entry.view,
      file: `${folder}/${entry.file}`, numericStatus: entry.numericStatus, summary: entry.summary,
      intentionalSuppressionSamples: entry.rows.filter(row => row.suppressed.length).length,
      visualReview: reviewed(`${folder}/${entry.file}`) })) };
});
const pairs = VIEWS.flatMap(view => {
  const record = read(`pairs/${view}/record.json`);
  return record.rows.map(row => ({ pairIndex: row.pairIndex, view, items: row.items,
    file: `pairs/${view}/${row.file}`, recordedGuardSubsetCurrent: sameRecordedSubset(record), numericStatus: row.numericStatus,
    visualReview: reviewed(`pairs/${view}/${row.file}`), metrics: { occupied: row.occupied, edge: row.edge,
      wardrobeLayers: row.wardrobeLayers, expectedLayers: row.expectedLayers, faceFrontOverlap: row.faceFrontOverlap } }));
});
const riskRecord = read('risks/record.json');
const risks = riskRecord.cases.map(entry => ({ pairIndex: entry.pairIndex, items: entry.items, kind: entry.kind,
  actionId: entry.actionId, view: entry.view, file: `risks/${entry.file}`, summary: entry.summary,
  numericStatus: entry.summary.flaggedFrames ? 'flagged' : 'checked', recordedGuardSubsetCurrent: sameRecordedSubset(riskRecord),
  visualReview: reviewed(`risks/${entry.file}`) }));
const singles = items.flatMap(item => item.records);
const summary = { items: items.length, allowedSingleItemActionViewCases: singles.length, staticPairCases: pairs.length,
  highRiskMotionPairCases: risks.length, normalSpeedClips: items.filter(item => item.clipValid).length,
  highRiskMotionSampleFrames: risks.reduce((count, row) => count + row.summary.frames, 0),
  recordedGuardSubsetCurrent: [...items, ...pairs, ...risks].every(entry => entry.recordedGuardSubsetCurrent),
  completeDependencyGuardAtCapture: false,
  numericFlaggedCases: [...singles, ...pairs, ...risks].filter(entry => entry.numericStatus === 'flagged').length,
  singleItemSampleFrames: singles.reduce((n, row) => n + row.summary.frames, 0),
  continuousRunFrames: items.reduce((n, item) => n + item.motionSummary.frames, 0),
  staticItemsReviewed: items.filter(item => ['checked', 'limited', 'flagged'].includes(item.staticReview.status)).length,
  motionItemsReviewed: items.filter(item => ['checked', 'limited', 'flagged'].includes(item.motionReview.status)).length,
  pairViewsReviewed: pairs.filter(row => ['checked', 'limited', 'flagged'].includes(row.visualReview.status)).length,
  highRiskMotionCasesReviewed: risks.filter(row => ['checked', 'limited', 'flagged'].includes(row.visualReview.status)).length,
  individualActionViewProofsReviewed: singles.filter(row => ['checked', 'limited', 'flagged'].includes(row.visualReview.status)).length,
  intentionalActionHeadwearSuppressionCases: singles.filter(row => row.intentionalSuppressionSamples).length,
  visualGeometryFlags: [...items.map(item => item.staticReview), ...pairs.map(row => row.visualReview),
    ...risks.map(row => row.visualReview)].filter(row => row.status === 'flagged').length,
  visibilityLimitations: pairs.filter(row => row.visualReview.status === 'limited').map(row => ({ items: row.items, view: row.view, findings: row.visualReview.findings })),
  exclusions: ['Arbitrary three-to-seven-item powerset', 'Every intermediate frame for all 1664 single-item action/view cases',
    'Full normal-speed playback visual approval: motion inspection here uses saved cycle/phase frames',
    'Native window, browser compositor, GPU, physical display scaling and memory validation'] };
if (singles.length !== 1664 || pairs.length !== PAIRS.length * 3 || risks.length !== 32) throw Error('Incomplete finite matrix');
const ledger = { generatedAt: new Date().toISOString(), renderer: 'Production createPetRenderer / existing offscreen Skia',
  bodyDesignWidthCssPx: 99, inspectionWidthCssPx: 198, summary, sourceProvenance: provenance,
  recordedSourceHashes: recordedGuard, currentHashesOfRecordedSubset: currentRecorded, items, pairs, risks };
fs.writeFileSync(path.join(out, 'ledger.json'), JSON.stringify(ledger, null, 2));
if (summary.recordedGuardSubsetCurrent && summary.staticItemsReviewed === 16 && summary.motionItemsReviewed === 16
  && summary.pairViewsReviewed === 297 && summary.highRiskMotionCasesReviewed === 32) {
  fs.writeFileSync(path.join(root, 'tools/dango-complete-audit/wardrobe/review.json'), JSON.stringify(ledger, null, 2));
}
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const itemHtml = items.map(item => `<section><h2>${escape(item.id)}</h2><p>${escape(item.slot)} · ${item.cases} action/view cases · static: ${escape(item.staticReview.status)} · run samples: ${escape(item.motionReview.status)}</p><img loading="lazy" src="${item.folder}/static-proof.png" alt="${escape(item.id)} three views at normal size and 2×"><video controls preload="none" src="${item.clip}"></video><img loading="lazy" src="${item.folder}/run-contact-sheet.png" alt="Run cycle samples"><details><summary>All ${item.cases} action/view phase proofs and numeric results</summary><ul>${item.records.map(row => `<li><a href="${row.file}">${escape(row.kind)} / ${escape(row.actionId)} / ${escape(row.view)}</a> · numeric ${row.numericStatus} · visual ${escape(row.visualReview.status)}</li>`).join('')}</ul></details></section>`).join('\n');
const pairHtml = VIEWS.map(view => `<details><summary>${view}: all 99 static cross-slot pairs</summary>${Array.from({ length: 9 }, (_, index) => `<img loading="lazy" src="pairs/${view}/sheet-${String(index + 1).padStart(2, '0')}.png" alt="${view} pairs page ${index + 1}">`).join('')}</details>`).join('\n');
const riskHtml = risks.map(row => `<li><a href="${row.file}">#${row.pairIndex} ${escape(row.items.join(' + '))} / ${row.actionId}</a> · numeric ${row.numericStatus} · visual ${escape(row.visualReview.status)}</li>`).join('');
const provenanceHtml = `<p>The before/after source guard covered ${provenance.recordedGuardFileCount} recorded paths, not the full dependency set. The ${provenance.omittedGuardFiles.length} identified omitted paths are listed in the ledger. The separate <a href="../../pet-complete-production-freeze.json">full final production snapshot</a> matches current files; it is not a retroactive capture guard.</p>`;
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dango finite wardrobe audit</title><style>body{max-width:1400px;margin:auto;padding:28px;background:#f0f3ee;color:#243d36;font:16px/1.55 system-ui}h1{font-size:32px}section,details{background:white;border:1px solid #cfdbd1;border-radius:12px;margin:24px 0;padding:22px}img{max-width:100%;height:auto;display:block;margin:14px 0}video{width:min(680px,100%);display:block;background:#eef2ed}a{color:#286b55}summary{cursor:pointer;font-weight:600}li{margin:5px 0}pre{white-space:pre-wrap}</style><h1>Dango finite wardrobe audit</h1><p>Actual production renderer with the existing Skia backend. 99 CSS px is body design width; the full stage is 219 CSS px. The 2× proof uses identical output enlarged once.</p><p>${singles.length} single-item action/view cases, ${pairs.length} static pair views, ${risks.length} targeted motion pair cases, 16 full 9.5-second run clips at 30fps.</p><p>Numeric checks and visual inspection are recorded separately. A render or changed-pixel count is not visual approval. <a href="ledger.json">Full finite ledger</a></p><pre>${escape(JSON.stringify(summary, null, 2))}</pre>${itemHtml}<h2>All static pair views</h2>${pairHtml}<h2>Targeted pair motion</h2><ul>${riskHtml}</ul></html>`);
const htmlFile = path.join(out, 'index.html');
fs.writeFileSync(htmlFile, fs.readFileSync(htmlFile, 'utf8').replace('<pre>', `${provenanceHtml}<pre>`));
console.log(JSON.stringify(summary, null, 2));
if (!summary.recordedGuardSubsetCurrent || snapshotChanges.length || summary.normalSpeedClips !== 16 || summary.numericFlaggedCases || summary.visualGeometryFlags
  || summary.staticItemsReviewed !== 16 || summary.motionItemsReviewed !== 16
  || summary.pairViewsReviewed !== 297 || summary.highRiskMotionCasesReviewed !== 32) process.exitCode = 1;
