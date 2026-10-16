/** Mechanical quaternion keys only. Does not generate, retarget, or approve art.
 * Run after build-fixture.py when rebuilding the complete fixture. Existing
 * body, accessory, profile, and target-segment bytes are deliberately untouched.
 */
import {readFile, writeFile, mkdir, copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const baseDirectory=new URL('../fixtures/',import.meta.url);
const directory=new URL('authored/',baseDirectory);
const rotation=(axis,angle)=>{
  const q=[0,0,0,Math.cos(angle/2)];
  q[axis]=Math.sin(angle/2);
  return q;
};
const track=(target,interpolation,axis,keys)=>({
  target,interpolation,
  keys:keys.map(([at,angle])=>({at,rotation:rotation(axis,angle)}))
});

// Every track owns its timing. Repeated rotations author actual holds, and
// their unequal boundaries intentionally cannot be represented by one ease.
const library={
  format:'bubu-clips',version:'0.1.0',id:'mechanical.authored-clips',
  clips:[{
    id:'asymmetric-holds',durationSec:1,endBehavior:'hold',tracks:[
      track('joint:arm.left','LINEAR',2,[[0,.04],[.125,.04],[.375,.18],[.625,.18],[1,-.08]]),
      track('joint:arm.right','STEP',0,[[0,-.06],[.25,.12],[.6875,-.04],[1,.08]]),
      track('accessory:testCap','LINEAR',1,[[0,.1],[.1875,.1],[.5,-.3],[.875,-.3],[1,.22]])
    ]
  }]
};
const bytes=Buffer.from(JSON.stringify(library,null,2)+'\n');
const manifestURL=new URL('manifest.json',directory);
const manifest=JSON.parse(await readFile(new URL('manifest.json',baseDirectory),'utf8'));
const prior=manifest.assets.find(asset=>asset.id==='clips');
if(prior&&prior.kind!=='clips')throw new Error('Fixture asset id clips is already in use');
const asset={id:'clips',path:'authored-clips.json',kind:'clips',bytes:bytes.length,
  sha256:createHash('sha256').update(bytes).digest('hex')};
if(prior)manifest.assets[manifest.assets.indexOf(prior)]=asset;
else manifest.assets.push(asset);
manifest.clips=asset.id;
if(!manifest.requiredCapabilities.includes('authored-quaternion-clips'))
  manifest.requiredCapabilities.push('authored-quaternion-clips');
await mkdir(directory,{recursive:true});
for(const source of manifest.assets)if(source.id!==asset.id)
  await copyFile(new URL(source.path,baseDirectory),new URL(source.path,directory));
await writeFile(new URL(asset.path,directory),bytes);
await writeFile(manifestURL,JSON.stringify(manifest,null,2)+'\n');
console.log(`Generated mechanical authored clip: ${bytes.length} bytes, ${library.clips[0].tracks.length} independent tracks`);
