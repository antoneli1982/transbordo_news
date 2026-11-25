import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historicalWorkforce,seedMissing} from '../scripts/ativar.mjs';
test('Migração privada aceita a lista histórica e preserva o cadastro que já existe',async()=>{
  const rows=[{name:'Pessoa de teste',chapa:'A01'}];
  assert.deepEqual(historicalWorkforce('  var PEOPLE_SEED='+JSON.stringify(rows)+';'),rows);
  assert.throws(()=>historicalWorkforce('var PEOPLE_SEED=[];'));
  let doc;
  const logged={db:{},runTransaction:(_,work)=>work({get:async()=>({exists:()=>!!doc}),set:(_,v)=>doc=v})};
  assert(await seedMissing(logged,{},rows,'senior'));
  assert.equal(await seedMissing(logged,{},[{name:'Outro teste',chapa:'B02'}],'senior'),false);
  assert.deepEqual(JSON.parse(doc.rows),rows);
});
