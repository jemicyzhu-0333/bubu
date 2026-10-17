import assert from 'node:assert/strict';
import {fixture} from '../../tools/fixture.mjs';
for(const ending of ['up','drag','hidden','regrab','gap']){
const f=await fixture();try{
f.emit('pointerdown',0);f.tick(0);let first,looks=0,last;
for(let i=1;i<=120;i++){const s=f.tick(i/2);if(s.pet.held){first??=s.pet.qualifiedAt;assert.equal(s.pet.qualifiedAt,first);}if(s.pet.face==='petLook'&&last!=='petLook')looks++;last=s.pet.face;assert(s.body.minimumFootY>=f.h.body.initialGround-1e-8);f.h.owner.assertCurrent();}
assert.equal(looks,1);assert.equal(first,.4);
if(ending==='gap'){assert.equal(f.tick(7200).mode,'petting');f.emit('pointerup',7200.1);f.tick(7200.1);f.tick(7205);}
else if(ending==='hidden'){f.at(60);f.doc.hidden=true;f.doc.emit('visibilitychange');assert.equal(f.h.state.face.path,null);f.at(80);f.doc.hidden=false;f.doc.emit('visibilitychange');f.tick(81);}
else if(ending==='drag'){const p=f.point();f.emit('pointermove',60.1,{clientX:p.clientX+15,clientY:p.clientY-10});assert.equal(f.tick(60.1).mode,'drag');f.emit('pointercancel',60.2);f.tick(60.2);f.tick(65);}
else{f.emit('pointerup',60.1);f.tick(60.1);if(ending==='regrab'){f.emit('pointerdown',60.2);f.tick(60.2);assert.equal(f.tick(60.7).pet.session,2);f.emit('pointercancel',60.8);f.tick(60.8);}f.tick(65);}
f.tick(f.h.state.time+1.1);assert.equal(f.h.state.mode,'idle');assert.equal(f.h.state.pointerId,null);assert.equal(f.target.captured.size,0);assert.equal(f.h.owner.weightedState.facts.interactionOwned,false);if(ending!=='drag')assert.equal(f.h.state.face.path,null);console.log(ending+' PASS');
}finally{f.h.dispose();assert.equal(f.h.pool.stats.active,0);assert.equal(f.h.pool.stats.decodedArrayBytes,0);}}
