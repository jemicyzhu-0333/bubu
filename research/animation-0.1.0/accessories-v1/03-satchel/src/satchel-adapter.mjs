import {SproutAdapter} from '../../01-sprout/src/sprout-adapter.mjs';
export const SATCHEL_SPEC=Object.freeze({id:'milestone.satchel',exclusiveGroup:'sidebag',minLevel:8,priority:40,effect:null,side:'character-right',frontViewerSide:'left',strap:'continuous low waist sling',pouchCenter:[-.91,.32,.35]});
/** Immutable external attachment. No body deformation or accessory clock.
 * Wardrobe owner enforces sidebag rules and source resource lifetime. */
export class SatchelAdapter extends SproutAdapter {
 constructor(options){super(options);this.root.name='Accessory_milestone.satchel';}
 update(time,{enabled=true}={}){return super.update(time,{reducedMotion:true,enabled});}
}
