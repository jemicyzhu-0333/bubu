import {createHash} from 'node:crypto';
import catalogue from './attachment-profiles.json' with {type:'json'};

/** Versioned research boundary conditions. Keep the original coarse file and
 * historical profiles intact; changing a profile never changes source art. */
export function resolveCapeAttachment(coarseBytes,profile='tea-swept-51-v1') {
  if(!Object.hasOwn(catalogue.profiles,profile))throw Error('Unknown cape attachment profile');
  if(createHash('sha256').update(coarseBytes).digest('hex')!==catalogue.simulationSHA256)throw Error('Cape simulation identity changed');
  const coarse=JSON.parse(coarseBytes),definition=catalogue.profiles[profile];
  const releasedPins=Object.freeze([...definition.releasedPins]);
  if(new Set(releasedPins).size!==releasedPins.length||releasedPins.some(p=>!coarse.pins.includes(p)))throw Error('Invalid released support');
  const pins=Object.freeze(coarse.pins.filter(p=>!releasedPins.includes(p)));
  return Object.freeze({profile,simulationSHA256:catalogue.simulationSHA256,pins,releasedPins,reason:definition.reason,productionAccepted:false});
}
