import * as T from 'three';
import {createTissue,createTelescope} from './prop-models.mjs';
function ownClone(source){const copy=source.clone(true);copy.traverse(o=>{if(o.isMesh){o.geometry=o.geometry.clone();o.material=o.material.clone();}});return copy;}
function resource(root,sockets){let disposed=false;return {root,sockets:Object.fromEntries(Object.entries(sockets).map(([k,p])=>[k,new T.Vector3(...p)])),dispose(){if(disposed)return;disposed=true;root.removeFromParent();const gs=new Set(),ms=new Set();root.traverse(o=>{if(o.isMesh){gs.add(o.geometry);ms.add(o.material);}});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());root.clear();}};}
/** Exact existing white sheet, detached without its box. Geometry is translated only. */
export function createTissueSheet(){const source=createTissue(),sheet=ownClone(source.root.getObjectByName('Tissue_single_sheet'));source.dispose();sheet.geometry.translate(0,-.295,0);const root=new T.Group();root.name='Prop_tissue_sheet';root.add(sheet);return resource(root,{grip:[-.125,.025,0],support:[0,0,0],tip:[0,.275,.025]});}
/** Exact existing altitude-pivot tube, detached from tripod with its material/parts intact. */
export function createTelescopeHandheld(){const source=createTelescope(),tube=ownClone(source.root.getObjectByName('Telescope_altitude_pivot'));source.dispose();tube.position.y=.30;const root=new T.Group();root.name='Prop_telescope_handheld';root.add(tube);return resource(root,{grip:[-.18,.30,0],support:[0,0,0],eyepiece:[0,.096,-.502],altitude:[0,.30,0]});}
export const factories={'tissue-sheet':createTissueSheet,'telescope-handheld':createTelescopeHandheld};
