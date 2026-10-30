import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

test('disabled coupled solver preserves geometry, affine seams and positive update domain',async()=>{
  const {stderr}=await promisify(execFile)('python3',[fileURLToPath(new URL('./test_coupled.py',import.meta.url))],{
    timeout:60000,env:{...process.env,OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'1',PYTHONDONTWRITEBYTECODE:'1'},
  });
  assert.match(stderr,/Ran 17 tests/);
  assert.match(stderr,/OK/);
});
