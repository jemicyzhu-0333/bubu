import {SproutAdapter} from '../../01-sprout/src/sprout-adapter.mjs';
export const SUNHAT_SPEC=Object.freeze({id:'milestone.sunhat',exclusiveGroup:'headwear',minLevel:5,priority:50,effect:null,seatY:1.43,topY:2.05,outerCrownRadii:[.785,.615],shellThickness:.026});
/** Same validated external attachment contract as sprout, with no sway.
 * Asset is exported relative to the identical scalp anchor. Wardrobe owner
 * must enforce headwear exclusion and retain source asset through last release. */
export class SunhatAdapter extends SproutAdapter {
 constructor(options){super(options);this.root.name='Accessory_milestone.sunhat';}
 update(time,{enabled=true}={}){return super.update(time,{reducedMotion:true,enabled});}
}
