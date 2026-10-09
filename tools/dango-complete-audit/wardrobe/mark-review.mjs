// Record explicit reviewer decisions only after inspecting the named images.
// File hashes prevent silently carrying a review across changed evidence.
import fs from 'node:fs';
import path from 'node:path';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const out = path.resolve(arg('out') || 'dist/dango-complete-audit/wardrobe');
const files = arg('files')?.split(',');
if (!files?.length) throw Error('Supply exact inspected --files paths relative to the audit output');
const status = arg('status') || 'checked';
if (!['checked', 'limited', 'flagged'].includes(status)) throw Error('Unknown review status');
const { sha256 } = await import('./source-pin.mjs');
const ledgerFile = path.join(out, 'visual-decisions.json');
const saved = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
const reviews = new Map(saved.reviews.map(review => [review.file, review]));
for (const file of files) {
  const previous = reviews.get(file), image = fs.readFileSync(path.join(out, file));
  reviews.set(file, { file, sha256: sha256(image), status, findings: arg('finding') ? [arg('finding')] : [],
    method: arg('method') || 'Actual production saved phase/cycle frames visually inspected; full playback acceptance not claimed',
    ...(previous && previous.status !== status ? { resolvedPrevious: previous } : {}) });
}
saved.reviews = [...reviews.values()]; fs.writeFileSync(ledgerFile, JSON.stringify(saved, null, 2));
console.log(`Recorded explicit ${status} review of ${files.length} inspected image(s)`);
