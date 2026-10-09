// Pin the release candidate without inventing capture-time provenance for older evidence.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const files = [];
const final = process.argv.includes('--final');
function walk(relative) {
  for (const entry of fs.readdirSync(path.join(root, relative), {withFileTypes:true})) {
    const file = `${relative}/${entry.name}`;
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile() && !file.endsWith('/source-traceability.json')) files.push(file);
  }
}
for (const dir of ['src','assets/companion/usagi','tools/usagi-complete-review','tools/usagi-gallery','tools/dango-state-cycle-preview']) walk(dir);
const sourceHashes = Object.fromEntries(files.sort().map(file => [file, hash(fs.readFileSync(path.join(root,file)))]));
const result = {
  schemaVersion:1, generatedAt:new Date().toISOString(), status:final ? 'release-source-snapshot' : 'candidate-snapshot-shared-runtime-not-yet-frozen',
  treeSha256:hash(JSON.stringify(sourceHashes)), sourceHashes,
  provenanceLimit:'This snapshot records the current release candidate, not a reconstructed hash of every historical capture. Older manifests without source hashes cannot establish exact capture-time source identity. Their image hashes establish evidence-file integrity only.',
  historicalEvidence:[
    {path:'dist/usagi-complete-review/actions',scope:'General action/expression/story sheets and initial replay; original catch-star and rest-nap proofs are superseded below'},
    {path:'tools/usagi-complete-review/wardrobe-review.json',scope:'See checked-in wardrobe-review.json for evidence paths and its contemporaneous narrower source pins; broader runtime pin is retrospective'}
  ],
  finalTargetedReplacements:[
    {capability:'catch-star',path:'dist/usagi-complete-review/actions/catch-repair-independent',scope:'All four views plus auto, bare plus three curated outfits, after Usagi wrist contact repair'},
    {capability:'rest-nap',path:'dist/usagi-complete-review/actions/nap-final-independent',scope:'Five story phases, bare plus three curated outfits, after shared phase-accent and sleep-face repairs'},
    {capability:'bubble-blow-composite',path:'dist/usagi-complete-review/actions/bubble-composite/after',scope:'Four requested views and two facings; body + scene + overlay after attached ring-origin repair; before directory is historical only'},
    {capability:'continuous-state-cycle',path:'dist/usagi-complete-review/state-cycle',scope:'Four persistent-renderer 28-second sequences after nap repairs'},
  ],
  pendingFinalRecapture:final ? [] : ['Source snapshot must be regenerated after final shared freeze and targeted bubble composite review.'],
  acceptanceLimits:['Offscreen production Canvas evidence','Full normal-speed human playback and native desktop acceptance remain unclaimed','No memory-risk test']
};
fs.writeFileSync(path.join(root,'tools/usagi-complete-review/source-traceability.json'),JSON.stringify(result,null,2)+'\n');
console.log(`${files.length} files; tree SHA-256 ${result.treeSha256}`);
