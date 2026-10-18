import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {paths} from './paths.mjs';
export function candidatePaths(group){
 const p=paths(),out=path.join(p.cache,group);
 for(const d of ['reports','review','models'])fs.mkdirSync(path.join(out,d),{recursive:true});
 return {...p,out,root:pathToFileURL(out+'/'),baseline:path.join(p.cache,'accessory/review/halo-static.json')};
}
