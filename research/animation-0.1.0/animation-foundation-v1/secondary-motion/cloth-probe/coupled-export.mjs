/** External trajectory input for the isolated coupled cloth experiment. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadGLB,disposeAsset,hybrid} from '../../integration/asset-fixtures.mjs';
import {createTeaObstacles} from './tea-obstacles.mjs';
import {createTeaClearanceCandidate} from '../../contact/tea-clearance-candidate.mjs';
import {clothActionHorizon} from './action-horizon.mjs';

const research=fileURLToPath(new URL('../../../',import.meta.url));
const args=process.argv.slice(2);
assert.equal(args.length,1,'Usage: coupled-export.mjs NEW_EXTERNAL_JSON');
const requested=path.resolve(args[0]);
const destination=path.join(fs.realpathSync(path.dirname(requested)),path.basename(requested));
assert(!destination.startsWith(fs.realpathSync(research)+path.sep));
assert(!fs.existsSync(destination));
const read=name=>JSON.parse(fs.readFileSync(path.join(research,name)));
const input=Object.fromEntries([['config','rigid-config'],['hold','hold-fit'],['sip','sip-fit']].map(([key,name])=>[
  key,read(`original-parts-hybrid-v1/tea/inputs/${name}.json`),
]));
const controller=createTeaClearanceCandidate(input),asset=await loadGLB(hybrid);
let moving;
try{
  moving=createTeaObstacles(asset);
  const proxy=read('animation-foundation-v1/secondary-motion/cloth-probe/fixtures/wire-local-body-proxy-v2.json');
  moving.apply(controller.sample(0));
  const obstacles=moving.entries.map(entry=>({name:entry.name,kind:entry.kind,
    positions:Array.from(entry.kind==='body'?proxy.positions:entry.base),
    indices:Array.from(entry.kind==='body'?proxy.indices:entry.geometry.index.array),
  }));
  const paths={};
  for(const [name,cancelAt]of [['normal',null],['cancel02',.2]]){
    const horizon=clothActionHorizon({sampleHz:120,cancelAt}),frames=[];
    for(let i=0;i<=horizon.frames;i++){
      const time=i/horizon.sampleHz;
      moving.apply(controller.sample(time,cancelAt===null?{}:{cancelAt}));
      frames.push({time,obstacles:moving.entries.map(entry=>({name:entry.name,visible:entry.visible,matrix:entry.matrix.toArray()}))});
    }
    paths[name]={horizon,frames};
  }
  const frozen=read('animation-foundation-v1/integration/diagnostics/contact-contract-20261019/frozen-cape.json');
  const dependencies=[
    'original-parts-hybrid-v1/tea/src/rigid-tea.mjs','original-parts-hybrid-v1/tea/src/timeline.mjs',
    'original-parts-hybrid-v1/tea/src/scene-resources.mjs',
    'animation-foundation-v1/contact/tea-clearance-candidate.mjs',
    'animation-foundation-v1/secondary-motion/cloth-probe/tea-obstacles.mjs',
    'animation-foundation-v1/secondary-motion/cloth-probe/fixtures/wire-local-body-proxy-v2.json',
  ];
  fs.writeFileSync(destination,JSON.stringify({obstacles,paths,parts:frozen.parts,sourceModelSHA256:frozen.sha256,
    sourceHashes:Object.fromEntries(dependencies.map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(research,name))).digest('hex')])),
  }),{flag:'wx'});
  console.log({destination,obstacles:obstacles.length,normalFrames:paths.normal.horizon.frames,cancelFrames:paths.cancel02.horizon.frames});
}finally{moving?.dispose();disposeAsset(asset);}
