import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {ref,uploadBytes,getBytes,deleteObject} from 'firebase/storage';
let env;
before(async()=>{assert(process.env.FIREBASE_STORAGE_EMULATOR_HOST,'Somente emulador de Storage');
  env=await initializeTestEnvironment({projectId:'demo-transbordo',storage:{host:'127.0.0.1',port:9199,rules:await fs.readFile('storage.rules','utf8')}});});
after(async()=>{await env?.cleanup();});
test('Storage bloqueia leitura e alteração em todas as identidades',async()=>{
  await env.withSecurityRulesDisabled(async c=>{await uploadBytes(ref(c.storage(),'homologacao/teste.txt'),new Uint8Array([12]));});
  const contexts=[env.unauthenticatedContext(),...['senior','editor','viewer','screen'].map(id=>env.authenticatedContext(id,{role:id}))];
  for(const c of contexts){const file=ref(c.storage(),'homologacao/teste.txt');
    await assertFails(getBytes(file));await assertFails(uploadBytes(file,new Uint8Array([21])));await assertFails(deleteObject(file));}
});
