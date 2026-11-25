import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encode,decode,inspect} from '../scripts/backup.mjs';
test('Backup cifrado permite recuperar os registros e detecta senha inválida ou alteração',()=>{
  const content={project:'transbordonews',documents:[{name:'teste',fields:{mensagem:{stringValue:'Texto privado de teste'}}}]};
  const password=crypto.randomUUID(), file=encode(content,password);
  assert(!file.includes('Texto privado de teste'));assert.deepEqual(decode(file,password),content);
  assert.throws(()=>decode(file,'senha-incorreta'));file[file.length-1]^=1;
  assert.throws(()=>decode(file,password));
});

test('Conferência da cópia conta as execuções e verifica todas as partes referenciadas',()=>{
  const doc=(id,fields)=>({name:'projects/transbordonews/databases/(default)/documents/paineis/'+id,fields});
  const str=stringValue=>({stringValue});
  const docs=[doc('principal',{state:str(JSON.stringify({items:[{mtm:'fb:att_a1'}]}))}),
    doc('pcp',{plan:str(JSON.stringify({rows:[]}))}),doc('att_a1',{d:str('data:A'),n:{integerValue:'2'}}),
    doc('att_a1_c1',{d:str('B')}),doc('run_1',{end:{integerValue:'100'}}),
    doc('run_2',{end:{nullValue:null}}),doc('runLock_2',{runId:str('run_2')})];
  assert.deepEqual(inspect(docs),{documentos:7,embalagens:1,linhasPCP:0,execucoes:2,emAndamento:1,encerradas:1,travasAtivas:1,anexosReferenciados:1});
  assert.throws(()=>inspect(docs.filter(d=>!d.name.endsWith('att_a1_c1'))),/parte ausente/);
});
