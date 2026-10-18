import {candidatePaths} from '../../shared/work-garden-paths.mjs';
const portable=candidatePaths('work-props');
import fs from 'node:fs';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const b=fs.readFileSync(portable.hybrid);const gltf=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');const out=[];gltf.scene.traverse(o=>{if(o.name.startsWith('Bubu_hand'))out.push({name:o.name,positions:Array.from(o.geometry.attributes.position.array),indices:Array.from(o.geometry.index.array)});});fs.writeFileSync(new URL('reports/source-hands.json',portable.root),JSON.stringify(out));
