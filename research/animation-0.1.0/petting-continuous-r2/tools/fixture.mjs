import fs from 'node:fs';import * as T from 'three';
import {createD2PointerHost} from '../../shared-input-workbench-v2/src/fixture-host.mjs';
const profile=JSON.parse(fs.readFileSync(new URL('../../drag-body-prototype-v1/replay/body-poses.json',import.meta.url)));
export class Target extends EventTarget {
 constructor(){super();this.rect={left:0,top:0,width:384,height:384};this.hidden=false;this.captured=new Set();}
 getBoundingClientRect(){return this.rect;}
 setPointerCapture(id){this.captured.add(id);}
 hasPointerCapture(id){return this.captured.has(id);}
 releasePointerCapture(id){this.captured.delete(id);}
 emit(type,props={}){const e=new Event(type);Object.assign(e,{pointerId:1,isPrimary:true,button:0,buttons:1,...props});this.dispatchEvent(e);}
}
export async function fixture(){let now=0,next=0;const pending=new Map(),target=new Target(),doc=new Target(),win=new Target(),camera=new T.OrthographicCamera(-2.5,2.5,4,-1,.01,100);camera.position.set(0,0,8);camera.lookAt(0,0,0);camera.updateProjectionMatrix();const h=await createD2PointerHost({target,documentTarget:doc,windowTarget:win,camera,profile,bodyOptions:{yawDegrees:10},scheduler:{now:()=>now,request:cb=>{pending.set(++next,cb);return next;},cancel:id=>pending.delete(id)}});const point=(x=0,y=1.4)=>{const p=new T.Vector3(x,y,0).project(camera);return{clientX:(p.x+1)*192,clientY:(1-p.y)*192};};return {h,target,doc,win,camera,pending,point,at:t=>{now=t;},tick:t=>{now=t;return h.frame(t);},emit:(type,t,props={})=>{now=t;target.emit(type,{...point(),...props});}};}
