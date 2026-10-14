// Two fixed diagnostic registrations of one real, already-loaded limb source.
// Rebuild BOTH stencils from canonical alpha, regardless of the input root.
import assert from 'node:assert/strict';
const deepFreeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(deepFreeze);Object.freeze(v);}return v;};
export function registeredComparisonSources(source){
 assert.equal(source.state(),'ready');
 const inputSnapshot=JSON.stringify(source.manifest());
 const inputSocket=source.manifest().sockets.find(s=>s.kind==='shoulder'&&s.view==='front'&&s.side==='r');
 assert.ok([[61.5,45.5],[58.5,45.5]].some(p=>p.every((v,i)=>v===inputSocket.worldRoot[i])), 'Unexpected current registration: review before comparing.');
 assert.deepEqual(inputSocket.sourceBodyAnchor,[58.6,39.712821]);
 function at(worldRoot){
  const manifest=structuredClone(source.manifest()),socket=manifest.sockets.find(s=>s.kind==='shoulder'&&s.view==='front'&&s.side==='r');
  socket.worldRoot=[...worldRoot];socket.anchorOffset=worldRoot.map((v,i)=>v-socket.sourceBodyAnchor[i]);
  const pixels=source.pixels(socket.coverageStencil),coverage={width:pixels.width,height:pixels.height,data:new Uint8ClampedArray(pixels.data.length)};
  const offset=worldRoot.map((v,i)=>Math.round(v-socket.root[i]));
  for(let y=socket.usefulLocalRect[1];y<socket.usefulLocalRect[3];y++)for(let x=socket.usefulLocalRect[0];x<socket.usefulLocalRect[2];x++){
   if(source.bodyAlpha(socket.view,x+offset[0]+.5,y+offset[1]+.5))coverage.data.set([255,255,255,255],(y*pixels.width+x)*4);
  }
  deepFreeze(manifest);
  return Object.freeze({...source,manifest:()=>manifest,pixels:id=>id===socket.coverageStencil?coverage:source.pixels(id)});
 }
 return {before:at([61.5,45.5]),after:at([58.5,45.5]),inputSnapshot,inputRoot:[...inputSocket.worldRoot]};
}
export function cliOptions(argv){
 const value=name=>{const i=argv.indexOf(name);return i>=0?argv[i+1]:null;};
 const repo=value('--repo'),out=value('--out'),steps=Number(value('--steps')||1024);
 if(!repo||!out||!Number.isInteger(steps)||steps<1)throw Error('Usage: node SCRIPT --repo REPO --out OUTPUT_DIR [--steps 1024]');
 return {repo,out,steps};
}
