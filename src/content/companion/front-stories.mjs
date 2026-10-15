// Manual-only catalog entry. Never enters the autonomous cue or date scheduler.
export const FRONT_STORY_PREVIEWS = Object.freeze({
  'halloween-lantern': Object.freeze({id:'halloween-lantern',name:'南瓜灯与小幽灵（小步正面）',
    motion:'idle',prop:'none',effect:'none',expression:'life.idle',duration:7200,staticProgress:1/3,
    motionCaps:Object.freeze({ownsGround:true,frontStory:'halloween'}),
    previewDefaults:Object.freeze({skin:'pink',view:'front'})})
});
export const FRONT_STORY_GARMENTS = Object.freeze({
  'seasonal.pumpkin-beret':'pumpkin-beret', 'seasonal.plum-cape':'plum-cape'
});
