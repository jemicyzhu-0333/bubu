import {pathToFileURL} from 'node:url';
const root=process.env.THREE_ROOT;
export async function resolve(specifier,context,next){if(root&&specifier==='three')return next(pathToFileURL(root+'/build/three.module.js').href,context);if(root&&specifier.startsWith('three/addons/'))return next(pathToFileURL(root+'/examples/jsm/'+specifier.slice(13)).href,context);return next(specifier,context);}
