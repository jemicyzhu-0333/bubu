import {
  readFile
}
from 'node:fs/promises';
import {
  localPackReader
}
from '../tools/read-local-pack.mjs';
import {
  preparePack
}
from '../src/pack-loader.mjs';
export const read=localPackReader(new URL('../fixtures/', import.meta.url).pathname);
export const pack=()=>preparePack(read);
export async function file(name) {
  return new Uint8Array(await readFile(new URL('../fixtures/'+name, import.meta.url)));
}
export function editGLB(bytes, change) {
  const d=new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), n=d.getUint32(12, true), obj=JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20+n))), bin=bytes.slice(28+n);
  change(obj);
  let text=JSON.stringify(obj);
  while(new TextEncoder().encode(text).length%4)text+=' ';
  const j=new TextEncoder().encode(text), out=new Uint8Array(28+j.length+bin.length), v=new DataView(out.buffer);
  [0x46546c67, 2, out.length, j.length, 0x4e4f534a].forEach((x, i)=>v.setUint32(i*4, x, true));
  out.set(j, 20);
  v.setUint32(20+j.length, bin.length, true);
  v.setUint32(24+j.length, 0x004e4942, true);
  out.set(bin, 28+j.length);
  return out;
}
