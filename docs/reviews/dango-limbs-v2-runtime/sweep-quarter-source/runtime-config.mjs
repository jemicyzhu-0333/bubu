import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const REPO=fs.realpathSync(process.env.BUBU_REPO||fileURLToPath(new URL('../../../../',import.meta.url)));
if(!process.env.SWEEP_QA_OUT)throw Error('Set SWEEP_QA_OUT to a directory outside the repository.');
const requested=path.resolve(process.env.SWEEP_QA_OUT);
// Resolve the nearest existing parent before creating anything, including symlinks.
let ancestor=requested;const tail=[];while(!fs.existsSync(ancestor)){tail.unshift(path.basename(ancestor));ancestor=path.dirname(ancestor);}
const OUT=path.resolve(fs.realpathSync(ancestor),...tail),relative=path.relative(REPO,OUT);
if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw Error('QA output must be outside the repository.');
fs.mkdirSync(OUT,{recursive:true});
export {REPO,OUT};
