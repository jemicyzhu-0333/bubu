import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { catalog } from './catalog.mjs';
import { fileURLToPath } from 'node:url';
import { assessEvidenceReview } from './review-state.mjs';

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const out = path.resolve(arg('out') || 'dist/dango-complete-audit/actions');
const reviewPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'reviewed-evidence.json');
const acceptance = fs.existsSync(reviewPath) ? JSON.parse(fs.readFileSync(reviewPath, 'utf8')) : {};
const fingerprint = file => ({ path: path.relative(process.cwd(), file).split(path.sep).join('/'),
  sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
function acceptedReview(bound, files, note) {
  return assessEvidenceReview(bound, files.map(fingerprint), acceptance.reviewedAt, note);
}
const notes = {
  workout: 'Grounded support paws, body compression and recovery inspected; headband remains separate from the eyes.',
  'chase-butterfly': 'Existing running body/feet preserved; butterfly remains ahead and leg exchange is visible.',
  hiccup: 'Cup held by both paws; recoil peak and recovery inspected.',
  juggle: 'Three separate moving balls and alternating paws inspected; front-only policy is explicit.',
  'carry-energy': 'Rebuilt: angled crystal moved between both eyes; both grip anchors follow it. Frontal placement preserved.',
  'pit-fall': 'Body enters and rises through the fixed hole rim with lower-body occlusion.',
  'mirror-meet': 'One small held mirror; no duplicate full character. Front-only policy retained.',
  sing: 'Microphone follows the near paw and mouth; opposite paw provides the performance gesture.',
  'stuck-corner': 'Existing squash/pleading cue inspected; this catalog action does not add an actual wall object.',
  'chase-laser': 'Approved run stays intact; red laser cue is separate from body motion.',
  'dig-treasure': 'Shovel contact, soil, tool withdrawal and chest reveal inspected.',
  yawn: 'Cap, rising paws, closed-eye yawn and recovery remain distinct.',
  sneeze: 'Tissue approaches muzzle during recoil and returns to the side.',
  'bubble-blow': 'Rebuilt: frontal wand ring moved away from the eye; angled clearance also checked. Composite overlay reviewed separately.',
  meditate: 'Cushion remains below body and breath/face phases are visible.',
  wave: 'Near paw waves at the body edge; angled hand extension remains connected.',
  stretch: 'Both paws rise and return; normal body volume and feet remain readable.',
  'happy-hop': 'Preparation, repeated hop peaks and return inspected.',
  'high-five': 'Open high-five paw and ordinary wrist remain connected in both allowed views.',
  spin: 'Full rotational cycle inspected in front, angled and back; back remains faceless.',
  dance: 'Alternating hand/foot motion and notes inspected.',
  'look-around': 'Binoculars intentionally cover eyes only in the raised contact phase; front-only policy retained.',
  'tail-wiggle': 'Rebuilt: back tail now has a visible connected foreground root; front/angled tail poses preserved.',
  'read-book': 'Book grip and turning page remain legible in both allowed views.',
  'take-note': 'Pen tip, supporting paw and writing motion inspected.',
  'type-keyboard': 'Alternating key presses, concentration and recovery inspected.',
  'sip-tea': 'Both paws follow cup; rim reaches muzzle during closed-eye sip and lowers again.',
  'paper-plane': 'Held preparation, release, flight and fade inspected; hand releases the plane.',
  sweep: 'Rebuilt: broom moved beyond eye line while retaining both paw contacts and original bristle height.',
  'magic-trick': 'Hat and transient star reveal inspected; front-only policy retained.',
  telescope: 'Eyepiece intentionally aligns with the far eye and near paw; angled-only policy retained.',
  'plant-water': 'Can spout and water path reach the visible plant; frontal-only policy retained.',
  'knit-scarf': 'Two needles, separate yarn ball, thread and alternating hand motion inspected.',
  'drum-solo': 'Alternating paws strike above drum rim; drum remains centered for each view.',
  moonwalk: 'Existing sliding feet and dust inspected; no extra pair of shoes introduced.',
  'hide-box': 'Existing box peek/compression inspected; named action is a partial hide, not full disappearance.',
  'build-blocks': 'Rebuilt: top cube seats on actual support pixels, paw retracts/fades and stack stays in place.',
  'catch-star': 'Falling star reaches raised paw and is lowered into two-paw hold.',
  'umbrella-dance': 'Single shaft, canopy and near grip inspected; no duplicate front shaft.',
  'snack-picnic': 'Mat remains behind the body; food approaches mouth and returns.',
  'shadow-box': 'Two gloves follow alternating paw positions without leaving an extra paw pair.',
  'tiny-chef': 'Both paws support pan; food toss and steam inspected.',
  'photo-pose': 'Camera lift, exact flash interval at46%, lowering and recovery inspected.',
  'focus-read': 'All5 stages: open, read, write, reread, hold book.',
  'focus-type': 'All5 stages: think, type, inspect laptop, type, organize notes.',
  'focus-write': 'All6 stages: prepare page, think, write, reread, add detail, organize.',
  'focus-browse': 'All5 stages: open laptop, browse, write note, recheck, rest.',
  'focus-charts': 'All5 stages: arrange chart, trace trend, compare notes, mark chart, review.',
  'focus-notes': 'All5 stages: arrange, read, sort, write, put away.',
  'rest-daydream': 'All4 stages: breath, look, daydream, stretch.',
  'rest-nap': 'Rebuilt shared phase cues: prepare and wake no longer retain sleep ZZZ; authored sleeping stage stays closed-eyed.',
  'rest-tea': 'All5 stages: carry, cool,3 sip cycles, hold, lower.',
  'rest-stretch': 'All5 stages: settle, stretch, sway, release, settle.',
  'rest-window': 'All4 stages: turn attention, follow cloud, pause, wave. Limited facial return preserved.',
  'rest-plant': 'All6 stages: inspect plant, steady pot, water, wait, inspect, wave; plant persists throughout.'
};
const records = [], errors = [];
for (const entry of catalog) {
  const dir = path.join(out, entry.kind, entry.id), recordPath = path.join(dir, 'record.json');
  if (!fs.existsSync(recordPath)) { errors.push(`missing ${entry.kind}/${entry.id}`); continue; }
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  const videoSha256 = createHash('sha256').update(fs.readFileSync(path.join(dir, record.clip))).digest('hex');
  const probe = spawnSync('/usr/bin/ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=nb_frames,r_frame_rate,width,height,duration', '-of', 'json', path.join(dir, record.clip)], { encoding: 'utf8' });
  if (probe.status) errors.push(`ffprobe ${entry.kind}/${entry.id}: ${probe.stderr}`);
  const video = probe.status ? null : JSON.parse(probe.stdout).streams[0];
  if (Number(video?.nb_frames) !== record.frameCount) errors.push(`frame count mismatch ${entry.id}`);
  if (Math.abs(Number(video?.duration) - entry.durationMs / 1000) > 1 / record.fps) errors.push(`normal-speed duration mismatch ${entry.id}`);
  if (video?.width !== 720 || video?.height !== 510 || video?.r_frame_rate !== `${record.fps}/1`) errors.push(`video format mismatch ${entry.id}`);
  if (process.argv.includes('--decode')) {
    const decoded = spawnSync('/usr/bin/ffmpeg', ['-v', 'error', '-i', path.join(dir, record.clip), '-f', 'null', '-'], { encoding: 'utf8' });
    if (decoded.status) errors.push(`decode ${entry.kind}/${entry.id}: ${decoded.stderr}`);
  }
  if (record.checks.checkedFrames !== record.frameCount) errors.push(`incomplete frame checks ${entry.id}`);
  for (const key of ['blankFrames', 'edgeFrames', 'requestFallbackMismatches']) if (record.checks[key]) errors.push(`${entry.id}: ${key}`);
  if (record.sourcesChangedDuringCapture?.length) errors.push(`capture source changed ${entry.id}`);
  if (record.explicitRightAlias && !record.explicitRightAlias.sameAsCanonicalQuarter) errors.push(`static right alias mismatch ${entry.id}`);
  if (record.staticViewValidation) for (const [file, hash] of Object.entries(record.staticViewValidation.sourceHashes)) {
    if (record.sourceHashes[file] !== hash) errors.push(`static view validation source differs ${entry.id}: ${file}`);
  }
  const proposedReview = {
    note: notes[entry.id] || 'Front and angled expressive phases visually reviewed; back remains faceless. Open-eye perspective repair reviewed separately.',
    proofScope: 'Production offscreen renderer; agent visual review of key phases and combined playback frames; not native-window or user acceptance',
    reviewedViews: record.phaseProofs.map(value => value.view) };
  const review = acceptedReview(acceptance.entries?.find(value => value.kind === entry.kind && value.id === entry.id),
    [path.join(dir, record.clip), ...record.phaseProofs.map(value => path.join(dir, value.file))], proposedReview.note);
  record.review = review; record.videoVerification = { ...video, sha256: videoSha256,
    decoded: process.argv.includes('--decode') || Boolean(record.videoVerification?.decoded && record.videoVerification.sha256 === videoSha256) };
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));
  records.push({ kind: entry.kind, id: entry.id, label: entry.label, durationMs: entry.durationMs,
    directory: `${entry.kind}/${entry.id}`, views: entry.views, clip: `${entry.kind}/${entry.id}/${record.clip}`,
    phaseProofs: record.phaseProofs, frameCount: record.frameCount, checks: record.checks, review,
    sourceHashes: record.sourceHashes, story: entry.story, videoVerification: record.videoVerification,
    staticViewValidation: record.staticViewValidation, explicitRightAlias: record.explicitRightAlias });
}
const hashSets = new Map();
for (const record of records) for (const [file, hash] of Object.entries(record.sourceHashes)) {
  if (!hashSets.has(file)) hashSets.set(file, new Set()); hashSets.get(file).add(hash);
}
const sourceVariants = Object.fromEntries([...hashSets].filter(([, set]) => set.size > 1).map(([file, set]) => [file, [...set]]));
if (Object.keys(sourceVariants).length) errors.push('catalog was captured against multiple source versions');
const environmentPath = path.join(out, 'environment', 'ledger.json');
const environment = fs.existsSync(environmentPath) ? JSON.parse(fs.readFileSync(environmentPath, 'utf8')) : null;
if (!environment || environment.entries.length !== 30) errors.push('scene/status/room/particle evidence incomplete');
if (environment) for (const entry of environment.entries) {
  if (entry.changedSources.length) errors.push(`environment source changed ${entry.kind}/${entry.id}`);
  for (const [file, hash] of Object.entries(entry.sourceHashes)) {
    if (hashSets.has(file) && !hashSets.get(file).has(hash)) errors.push(`environment source differs from action catalog: ${file}`);
  }
  if (entry.kind === 'particles') {
    if (entry.frames.length !== 28 || entry.frames.some(row => !row.renderedSpriteSources.length)) errors.push('registered particle drawing incomplete');
  } else {
    if (entry.frames.some(row => !row.occupied || row.edge)) errors.push(`environment body bounds ${entry.id}`);
    if (!entry.reducedMotion.bodyStable || !entry.reducedMotion.sceneStable || entry.reducedMotion.remainingParticles) errors.push(`reduced motion ${entry.id}`);
    if (!entry.sceneSources.length) errors.push(`missing actual backdrop images ${entry.id}`);
  }
  entry.review = acceptedReview(acceptance.environment?.find(value => value.kind === entry.kind && value.id === entry.id),
    [path.join(out, 'environment', entry.kind, entry.id, entry.proof)], 'Scene/status/room/particle proof needs visual review');
}
if (environment) fs.writeFileSync(environmentPath, JSON.stringify(environment, null, 2));
const repairPath = path.join(out, 'repairs', 'ledger.json');
const repairs = fs.existsSync(repairPath) ? JSON.parse(fs.readFileSync(repairPath, 'utf8')) : null;
if (!repairs || repairs.entries.length !== 6) errors.push('six alternate repair clips are not fully validated');
if (repairs) for (const entry of repairs.entries) {
  if (!entry.decoded || entry.checks.blankFrames || entry.checks.edgeFrames || entry.checks.requestFallbackMismatches) errors.push(`repair clip ${entry.directory}`);
  for (const [file, hash] of Object.entries(entry.sourceHashes)) if (hashSets.has(file) && !hashSets.get(file).has(hash)) errors.push(`repair source mismatch ${entry.directory}: ${file}`);
  const dir = path.join(out, 'repairs', entry.directory);
  entry.review = acceptedReview(acceptance.repairs?.find(value => value.directory === entry.directory),
    [path.join(dir, entry.clip), ...entry.frames.map(frame => path.join(dir, frame.file))], 'Alternate clip needs visual review');
}
const reviewGroups = [...records, ...(environment?.entries || []), ...(repairs?.entries || [])];
const awaitingReview = reviewGroups.filter(value => value.review.status === 'awaiting-visual-review');
if (awaitingReview.length) errors.push(`${awaitingReview.length} evidence groups await visual review`);
const ledger = { generatedAt: new Date().toISOString(),
  counts: { actions: records.filter(value => value.kind === 'action').length, sessions: records.filter(value => value.kind === 'session').length,
    expressions: records.filter(value => value.kind === 'expression').length, frames: records.reduce((sum, value) => sum + value.frameCount, 0),
    physicalViewProofs: records.reduce((sum, value) => sum + value.phaseProofs.length, 0), requestProofs: records.length * 6,
    supplementalStaticLeftChecks: records.filter(value => value.staticViewValidation).length,
    explicitStaticRightAliasChecks: records.filter(value => value.explicitRightAlias).length,
    repairVideoClips: repairs?.entries.length || 0, repairVideoFrames: repairs?.entries.reduce((sum, value) => sum + value.frameCount, 0) || 0,
    namedScenes: environment?.entries.filter(value => value.kind === 'scene').length || 0,
    statuses: environment?.entries.filter(value => value.kind === 'status').length || 0,
    sessionRooms: environment?.entries.filter(value => value.kind === 'room').length || 0, registeredParticleFixtures: 28,
    hashBoundReviewedGroups: reviewGroups.length - awaitingReview.length, awaitingVisualReview: awaitingReview.length },
  exclusions: ['No new mirror-music, mirror-coding, mirror-ai or ai-chat implementation exists in this branch',
    'profile is an alias, not a one-eye Dango silhouette', 'Action/session independent-left requests fall back; bare static left is supported and separately validated; left wardrobe layers are not supplied',
    'Native Electron/GPU/memory and final user visual acceptance are not established by these offscreen clips'],
  sourceVariants, errors, entries: records, repairs, environment };
fs.writeFileSync(path.join(out, 'review-ledger.json'), JSON.stringify(ledger, null, 2));
const data = JSON.stringify(ledger).replace(/</g, '\\u003c');
const html = `<!doctype html><meta charset="utf-8"><title>Dango action audit</title>
<style>body{font:15px system-ui;background:#edf1f2;color:#263642;margin:0}header{padding:20px;border-bottom:1px solid #cad4d8}main{display:grid;grid-template-columns:250px 1fr}nav{padding:12px;max-height:85vh;overflow:auto}button{display:block;width:100%;text-align:left;border:0;border-radius:8px;margin:4px 0;padding:9px;background:white;color:inherit;cursor:pointer}button.active{background:#cddfe7}article{padding:20px;max-width:1400px}video{width:720px;max-width:100%;background:#e9edef}img{max-width:100%;height:auto;display:block;margin:12px 0}small{color:#526674}select,input{padding:8px;margin:3px}details{margin:12px 0}pre{white-space:pre-wrap;font-size:12px}</style>
<header><strong>Dango:43 actions ·12 sessions ·32 expressions</strong><br><small>Actual production renderer ·30fps normal speed ·99 CSS px body design width +2× inspection ·offscreen evidence</small><br>
<p><a href="environment/scene-overview.png">25 scenes</a> · <a href="environment/status-overview.png">Hungry / coffee</a> · <a href="environment/room-overview.png">2 session rooms</a> · <a href="environment/particles/all-28/registered-particles.png">28 particle fixtures</a></p>
<input id="filter" placeholder="Find a named item"><select id="kind"><option value="">All</option><option>action</option><option>session</option><option>expression</option></select></header>
<main><nav id="list"></nav><article id="detail"></article></main><script>
const data=${data};let current='';const list=document.querySelector('#list'),detail=document.querySelector('#detail'),filter=document.querySelector('#filter'),kind=document.querySelector('#kind');
function render(){list.replaceChildren();for(const item of data.entries){if(kind.value&&item.kind!==kind.value||!item.id.includes(filter.value.toLowerCase()))continue;const b=document.createElement('button');b.textContent=item.kind+' / '+item.id;b.className=current===item.id?'active':'';b.onclick=()=>show(item);list.append(b)}}
function show(item){current=item.id;detail.replaceChildren();const title=document.createElement('h2');title.textContent=item.label+' · '+item.id;detail.append(title);const note=document.createElement('p');note.textContent=item.review.note;detail.append(note);const v=document.createElement('video');v.controls=true;v.loop=true;v.src=item.clip;detail.append(v);const info=document.createElement('p');info.textContent=item.durationMs/1000+'s · '+item.frameCount+' frames · '+item.review.status;detail.append(info);for(const proof of item.phaseProofs){const label=document.createElement('h3');label.textContent=proof.view+' · body/contact phases';detail.append(label);const image=document.createElement('img');image.src=item.directory+'/'+proof.file;image.alt=item.id+' '+proof.view;detail.append(image)}const d=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent='View policy, validation and source evidence';pre.textContent=JSON.stringify(item,null,2);d.append(summary,pre);detail.append(d);render()}
filter.oninput=render;kind.onchange=render;render();if(data.entries.length)show(data.entries[0]);</script>`;
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log(JSON.stringify({ ...ledger.counts, errors }));
if (errors.length) process.exitCode = 1;
