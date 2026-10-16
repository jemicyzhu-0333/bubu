import assert from 'node:assert/strict';
import {ResourceCache} from '../../src/resource-cache.mjs';
const ticks=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve()};
const out=[];
{let resolve,n=0;const c=new ResourceCache(),controller=new AbortController(),load=()=>new Promise(r=>resolve=r);const p=c.acquire('a',load,{signal:controller.signal});const caught=p.catch(e=>e);await ticks();controller.abort();resolve({dispose(){n++}});await caught;await ticks();assert.equal(n,1);assert.equal(c.retainedReferences,0);assert.equal(c.entries.size,0);out.push('Abort sole pending waiter: delayed successful load disposed once');}
{let resolve,n=0;const c=new ResourceCache(),controller=new AbortController(),load=()=>new Promise(r=>resolve=r);const p=c.acquire('a',load,{signal:controller.signal});const caught=p.catch(e=>e);const q=c.acquire('a',load);await ticks();controller.abort();resolve({dispose(){n++}});await caught;const lease=await q;assert.equal(n,0);lease.release();lease.release();assert.equal(n,1);assert.equal(c.stats.loads,1);assert.equal(c.retainedReferences,0);out.push('Abort shared waiter: sibling stays alive, dedup and double release correct');}
{let n=0;const c=new ResourceCache();await assert.rejects(c.acquire('a',()=>Promise.reject(Error('bad'))));assert.equal(c.entries.size,0);const lease=await c.acquire('a',()=>({dispose(){n++}}));lease.release();assert.equal(n,1);assert.equal(c.retainedReferences,0);out.push('Failed loads evicted, retry acquires fresh resource');}
console.log(JSON.stringify({passed:out},null,2));
