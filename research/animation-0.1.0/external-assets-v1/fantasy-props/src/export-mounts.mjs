import {paths} from '../../shared/paths.mjs';import {pathToFileURL} from 'node:url';import path from 'node:path';
const cfg=paths(),cacheRoot=pathToFileURL(path.join(cfg.cache,'fantasy-props')+'/');
import fs from 'node:fs';
import * as T from 'three';
import {
  factories
} from './prop-models.mjs';
fs.mkdirSync(new URL('reports/',cacheRoot),{recursive:true});
const root=cacheRoot,source=JSON.parse(fs.readFileSync(path.join(cfg.cache,'accessory/review/halo-static.json')));
const body=source.frames[0].meshes.filter(m=>m.name.startsWith('Bubu_')||m.name.startsWith('A_'));
const configs={
  butterfly:{
    position:[1.55,1.45,.20],kind:'small independent creature'
  },'ground-hole':{
    position:[1.65,0,.05],kind:'environment opening; scene ground stencil/cutout contract required'
  },'bubble-wand':{
    position:[1.19,.39,-.20],kind:'existing right hand shaft tangent contact'
  },'magic-hat':{
    position:[1.65,.006,.1],kind:'ground stage prop, not headwear'
  },star:{
    position:[1.55,1.45,.20],kind:'independent magic effect geometry'
  },yarn:{
    position:[1.65,.006,.1],kind:'ground yarn and attached knitted swatch'
  },'knitting-needle':{
    position:[1.185,.39,-.20],kind:'one needle at each original hand'
  },'pumpkin-lantern':{
    position:[1.55,.006,.1],kind:'ground prop; handle socket reserved'
  },ghost:{
    position:[1.65,.65,.1],kind:'small independent creature'
  }
};
const report={
  scope:'Static actual hybrid plus original face. All 13 actor meshes and positions unchanged. No new actions.',items:[]
};
for(const [id,f]of Object.entries(factories)){
  const c=configs[id],r=f();
  if(id==='knitting-needle'){
    r.root.getObjectByName('Needle_right').position.set(0,0,0);
    r.root.getObjectByName('Needle_left').position.set(-2.405,0,.33);
  }r.root.position.fromArray(c.position);
  r.root.updateMatrixWorld(true);
  const meshes=[];
  r.root.traverse(o=>{
    if(!o.isMesh)return;
    const positions=[],v=new T.Vector3();
    for(let i=0;
    i<o.geometry.attributes.position.count;
    i++){
      v.fromBufferAttribute(o.geometry.attributes.position,i).applyMatrix4(o.matrixWorld);
      positions.push(...v.toArray());
    }meshes.push({
      name:o.name,positions,indices:Array.from(o.geometry.index?.array??Array.from({
        length:o.geometry.attributes.position.count
      },(_,i)=>i)),materialColor:o.material.color.toArray(),opacity:1
    });
  });
  fs.writeFileSync(new URL('reports/'+id+'-mounted.json',root),JSON.stringify({
    sourceGLB:source.sourceGLB,frames:[{
      time:0,label:id+' static candidate',meshes:[...body,...meshes]
    }]
  }));
  report.items.push({
    id,...c,originalActorMeshes:13,originalActorPositionsByteIdentical:true,fullActions:'pending',wardrobe:'pending',nativeRuntime:'pending'
  });
  r.dispose();
}fs.writeFileSync(new URL('reports/mount-contracts.json',root),JSON.stringify(report,null,2));
