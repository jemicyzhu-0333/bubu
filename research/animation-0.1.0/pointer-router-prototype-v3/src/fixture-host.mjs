// Node-only CPU test entry. Browser hosts import pointer-host.mjs instead.
import {localPackReader} from '../../drag-body-prototype-v1/vendor/runtime-facepath05/tools/read-local-pack.mjs';
import {createPointerHost as createDOMHost} from './pointer-host.mjs';
export const createPointerHost=options=>createDOMHost({...options,readPack:localPackReader(new URL('../../drag-body-prototype-v1/vendor/runtime-facepath05/fixtures/face-full18/',import.meta.url).pathname)});
