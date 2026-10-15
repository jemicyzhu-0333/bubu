const sprite=(src,rect,tint='none')=>Object.freeze({src,rect:Object.freeze(rect),tint});
export const FRONT_STORY_ASSETS=Object.freeze({
 baseUrl:new URL('./',import.meta.url).href,version:'front-stories-v1',
 sprites:Object.freeze({
  hat:sprite('pink-hat-v2.png',[21,-10,25,25*370/450]),
  lapels:sprite('pink-lapels-v2.png',[18,40,30,30*220/490]),
  cape:sprite('pink-cape-v2.png',[-5,23,76,76*340/636]),
  pumpkin:sprite('pink-pumpkin-v2.png',[0,0,28,28*432/441]),
  ghost:sprite('pink-ghost.png',[0,0,21,21*310/324]),
  palm:sprite('../raster/action-contact/knit-front-round-v2/left-8x.png',[0,0,72,72],'body'),
  'robot-listen':sprite('pink-robot-listen.png',[74,33.5,24.25,31.5]),
  'robot-consider':sprite('pink-robot-consider.png',[74,33.5,24.25,31.5]),
  'robot-acknowledge':sprite('pink-robot-acknowledge.png',[69,33.5,28.75,31.5]),
  'robot-settle':sprite('pink-robot-settle.png',[74,33.5,24.25,31.5]),
  'wave-00':sprite('../raster/action-contact/wave-front-v1/wave-00-8x.png',[55,30,20,22],'body'),
  'wave-01':sprite('../raster/action-contact/wave-front-v1/wave-01-8x.png',[55,30,20,22],'body'),
  'wave-02':sprite('../raster/action-contact/wave-front-v1/wave-02-8x.png',[55,30,20,22],'body'),
  'wave-03':sprite('../raster/action-contact/wave-front-v1/wave-03-8x.png',[55,30,20,22],'body'),
  'wave-04':sprite('../raster/action-contact/wave-front-v1/wave-04-8x.png',[55,30,20,22],'body'),
  'wave-05':sprite('../raster/action-contact/wave-front-v1/wave-05-8x.png',[55,30,20,22],'body'),
  'wave-06':sprite('../raster/action-contact/wave-front-v1/wave-06-8x.png',[55,30,20,22],'body'),
  'wave-07':sprite('../raster/action-contact/wave-front-v1/wave-07-8x.png',[55,30,20,22],'body'),
  'wave-08':sprite('../raster/action-contact/wave-front-v1/wave-08-8x.png',[55,30,20,22],'body'),
  'wave-09':sprite('../raster/action-contact/wave-front-v1/wave-09-8x.png',[55,30,20,22],'body'),
  'wave-10':sprite('../raster/action-contact/wave-front-v1/wave-10-8x.png',[55,30,20,22],'body'),
 })
});
