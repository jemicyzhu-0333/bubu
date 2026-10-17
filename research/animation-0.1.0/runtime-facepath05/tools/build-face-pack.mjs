/** Rebuild the portable fixture from the one explicitly registered review source.
 * This tool cannot approve a new hash or infer approval from source metadata. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {APPROVED_FACE_SOURCE} from '../src/approved-face-source.mjs';
import {FACE_ROSTER,FACE_SLOT_IDS} from '../src/face-contract.mjs';
import {sha256} from '../src/pack-loader.mjs';
const source=process.argv[2];
if(!source||!APPROVED_FACE_SOURCE)throw Error('Provide the registered reviewed slice path');
const bytes=await readFile(source);if(await sha256(bytes)!==APPROVED_FACE_SOURCE.sha256)throw Error('Unapproved source hash');
const profile={format:'bubu-face-profile',version:'0.1.0',purpose:'approved-single-face-paths',sourceSha256:APPROVED_FACE_SOURCE.sha256,root:'A_reference_root',body:'A_mochi_skin',faceMeshes:FACE_ROSTER,
 joints:{body:'Body',shoulderLeft:'Shoulder_L',shoulderRight:'Shoulder_R',hipLeft:'Hip_L',hipRight:'Hip_R'},sockets:{headTouch:'HeadTouch',accessory:'AccessoryAnchor'},basis:'approved05-original-small-o',semanticDefault:'R0',hiddenBasisLayers:['A_brow_L','A_brow_R','A_tongue'],
 paths:FACE_SLOT_IDS.map(id=>({id,meaning:APPROVED_FACE_SOURCE.paths[id].meaning,knots:APPROVED_FACE_SOURCE.paths[id].targets.map((target,i)=>({at:(i+1)/8,target}))})),readiness:{engine:'single-semantic-path',binding:'fixed-seven-slot-slice',verified:'source-parity-and-scalar-clock'}};
const p=new TextEncoder().encode(JSON.stringify(profile,null,2)+'\n');
const manifest={format:'bubu-face-suite',version:'0.1.0',id:'approved-seven-face-paths',purpose:'approved-single-face-paths',assets:[{id:'body',path:'asset.glb',kind:'glb',bytes:bytes.length,sha256:APPROVED_FACE_SOURCE.sha256},{id:'profile',path:'profile.json',kind:'profile',bytes:p.length,sha256:await sha256(p)}],character:{asset:'body',profile:'profile'},budgets:{decodedArrayBytes:20*1024*1024}};
const dir=new URL('../fixtures/face-slice7/',import.meta.url);await mkdir(dir,{recursive:true});await writeFile(new URL('asset.glb',dir),bytes);await writeFile(new URL('profile.json',dir),p);await writeFile(new URL('manifest.json',dir),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({fixture:dir.pathname,sourceSha256:APPROVED_FACE_SOURCE.sha256,bytes:bytes.length}));
if(process.argv[3]) {
 const raw=await readFile(process.argv[3]),source=JSON.parse(raw);
 const fixtures=source.fixtures.filter(f=>FACE_SLOT_IDS.includes(f.state));
 if(fixtures.length!==7*257)throw Error('Expected all 257 intensity samples for each registered slot');
 await writeFile(new URL('mapping-fixtures.json',dir),JSON.stringify({sourceMappingSHA256:await sha256(raw),sourceSampleCount:source.sampleCount,subsetSampleCount:fixtures.length,fixtures},null,2)+'\n');
}
