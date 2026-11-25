import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encode,decode} from '../scripts/backup.mjs';
test('Backup cifrado permite recuperar os registros e detecta senha inválida ou alteração',()=>{
  const content={project:'transbordonews',documents:[{name:'teste',fields:{mensagem:{stringValue:'Texto privado de teste'}}}]};
  const password=crypto.randomUUID(), file=encode(content,password);
  assert(!file.includes('Texto privado de teste'));assert.deepEqual(decode(file,password),content);
  assert.throws(()=>decode(file,'senha-incorreta'));file[file.length-1]^=1;
  assert.throws(()=>decode(file,password));
});
