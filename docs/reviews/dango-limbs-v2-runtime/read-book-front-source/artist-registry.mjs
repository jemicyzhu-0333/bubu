// QA-local injection registry, never an application global.
let artists=null;
export const setArtists=value=>{artists=value;};
export const getArtist=mode=>{if(!artists?.[mode])throw Error('Unknown QA artist '+mode);return artists[mode];};
