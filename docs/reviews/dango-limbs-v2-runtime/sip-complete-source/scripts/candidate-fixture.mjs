import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

export function readOptions() {
  const {values}=parseArgs({options:{repo:{type:'string'},out:{type:'string'},start:{type:'string',default:'0'},end:{type:'string',default:'256'},smoke:{type:'boolean',default:false}}});
  if(!values.repo||!values.out)throw Error('Required: --repo=/path/to/repository --out=/new/output/directory');
  const start=Number(values.start),end=Number(values.end);
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>256||start>end)throw Error('Expected integer 0 <= start <= end <= 256');
  return{repo:path.resolve(values.repo),out:path.resolve(values.out),start,end,smoke:values.smoke};
}

export async function loadFixture(repo) {
  const load=relative=>import(pathToFileURL(path.resolve(repo,relative)).href);
  const {createDangoRasterArtist}=await load('src/capabilities/companion/presentation/dango-raster-art.mjs');
  const {DANGO_RASTER}=await load('assets/companion/dango/raster/dango.raster.mjs');
  const {sipContactSpriteKeys}=await load('src/capabilities/companion/presentation/dango-sip-contact-pose.mjs');
  const keys=sipContactSpriteKeys();
  if(keys.length!==4||keys.some(key=>DANGO_RASTER.tools[key]?.sourceContactPose?.runtimeReady!==false))throw Error('Expected exactly four existing sip-front-v2 production gates, all false. No repository state is modified.');
  const candidateManifest=structuredClone(DANGO_RASTER);
  for(const key of keys)candidateManifest.tools[key].sourceContactPose.runtimeReady=true;
  return{
    candidateManifest,legacyManifest:DANGO_RASTER,
    createCandidateArtist:options=>createDangoRasterArtist({...options,manifest:candidateManifest}),
    createLegacyArtist:options=>createDangoRasterArtist({...options,manifest:DANGO_RASTER})
  };
}
