import fs from 'node:fs';
import {fixture} from '../../../petting-continuous-r2/tools/fixture.mjs';
import {exportSceneFrame} from '../../../petting-continuous-r2/tools/export-scene-frame.mjs';
import {facts} from '../../../shared-input-workbench-v2/src/host-admission.mjs';
for(const face of ['P2','08']){
 const {h}=await fixture();h.body.offset.rotation.y=0;h.frame(0);h.owner.completeBatch({wallTime:.01,epoch:h.owner.epoch,facts:facts(true),events:[{type:'request',owner:'pointer',requestId:'offline-tea-face',lifetime:h.owner.maxAdmittedLifetime+1,candidate:face,holdMode:'keep'}]});h.owner.advance(.3);h.owner.assertCurrent();
 const f=exportSceneFrame(h.body.root,{time:.3,label:'approved '+face+' via existing owner'});fs.writeFileSync(new URL('face-'+face+'.json',import.meta.url),JSON.stringify(f));console.log(face,h.owner.state);h.dispose();
}
