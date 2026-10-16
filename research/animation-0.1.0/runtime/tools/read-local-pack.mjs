import {
  readFile, stat, realpath
}
from 'node:fs/promises';
import {
  resolve, sep
}
from 'node:path';
import {
  path, fail
}
from '../src/contracts.mjs';
export function localPackReader(directory) {
  const root=resolve(directory);
  return async(name, max, signal)=> {
    path(name);
    const actualRoot=await realpath(root), file=await realpath(resolve(root, name));
    if(!file.startsWith(actualRoot+sep))fail('PATH', 'Outside pack');
    if((await stat(file)).size>max)fail('LIMIT', 'File byte budget');
    return new Uint8Array(await readFile(file, {
      signal
    }));
  };
}
