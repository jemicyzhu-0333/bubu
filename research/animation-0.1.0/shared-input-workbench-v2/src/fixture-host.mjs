// Node-only actual-model fixture entry.
import {localPackReader} from '../../runtime-facepath05/tools/read-local-pack.mjs';
import {createPointerHost as createDOMHost} from './pointer-host.mjs';
export const createPointerHost=(options={})=>{const modelVariant=options.modelVariant??'full18';return createDOMHost({...options,modelVariant,readPack:localPackReader(new URL(modelVariant==='d2'?'../../runtime-facepath05/fixtures/face-d2/':'../../runtime-facepath05/fixtures/face-full18/',import.meta.url).pathname)});};
export const createD2PointerHost=options=>createPointerHost({...options,modelVariant:'d2'});
