import {sampleGait} from '../gait-helper-proposal.mjs';
import fs from 'node:fs';
const frames=JSON.parse(fs.readFileSync(new URL('../gait-source.json',import.meta.url))).frames;
const r={};for(const mode of ['walk','run']) r[mode]=Array.from({length:120},(_,i)=>sampleGait(i/60,frames,{mode}));
fs.writeFileSync(new URL('./samples.json',import.meta.url),JSON.stringify(r,null,2));
