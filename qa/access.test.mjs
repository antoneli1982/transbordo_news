import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import * as F from 'firebase/firestore';
import {auditedDatabase} from '../auth/database.js';
import {accounts,OWNER} from '../auth/accounts.js';
import {ticket} from '../auth/crypto.js';
let env;
const email=id=>id.toLowerCase()+'@example.invalid';
const context=id=>{
  const uid=id==='owner'?OWNER:id, db=env.authenticatedContext(uid,{email:email(id)}).firestore();
  return {db,uid,api:auditedDatabase(F,db,()=>uid)};
};
async function fixture(id,role) {
  await env.withSecurityRulesDisabled(async c=>{
    const db=c.firestore();await F.setDoc(F.doc(db,'accessUsers',id),{email:email(id),login:id,role,active:true});
    await F.setDoc(F.doc(db,'accessLogins',id),{uid:id,ticket:null});
  });
}
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-transbordo',firestore:{host:'127.0.0.1',port:8080,rules:await fs.readFile('firestore.rules','utf8')}});});
after(async()=>{await env?.cleanup();});
test('Primeiro Sênior, consulta, edição, revogação e auditoria',async()=>{
  const root=context('owner'),oper=context('editor'),view=context('viewer'),other=context('stranger');
  const person=F.doc(root.db,'accessUsers',OWNER);
  // Exercita o mesmo procedimento de primeiro acesso que o formulário usa.
  const mockAuth={currentUser:{uid:OWNER}}, A={signInWithEmailAndPassword:async()=>({user:{uid:OWNER,email:email('owner')}}),signOut:async()=>{}};
  const service=accounts({A,F,auth:mockAuth,db:root.db,logged:root.api});
  const password=crypto.randomUUID();const senior=await service.signIn(email('owner'),password);
  assert.equal(senior.role,'senior');assert.equal(senior.login,'ivan.antoneli');
  const alias=await service.signIn('ivan.antoneli',password);assert.equal(alias.uid,OWNER);
  const ctx=env.unauthenticatedContext().firestore();
  const sealed=await ticket('ivan.antoneli',password);
  const packed=await F.getDoc(F.doc(ctx,'loginTickets',sealed.id));assert.equal(await sealed.decode(packed.data()),email('owner'));
  await assertFails(F.getDocs(F.collection(ctx,'loginTickets')));
  await fixture('editor','editor');await fixture('viewer','viewer');
  assert.equal((await F.getDoc(person)).data().role,'senior');
  const panel=db=>F.doc(db,'paineis','pcp');
  await root.api.setDoc(panel(root.db),{plan:'primeira versão'});
  await oper.api.setDoc(panel(oper.db),{plan:'plano revisto'});
  assert.equal((await F.getDoc(panel(view.db))).data().plan,'plano revisto');
  await assertFails(F.getDoc(panel(ctx)));await assertFails(F.getDoc(panel(other.db)));
  await assertFails(view.api.setDoc(panel(view.db),{plan:'negado'}));
  await assertFails(F.setDoc(panel(oper.db),{plan:'sem auditoria'}));
  await assertFails(F.getDocs(F.collection(oper.db,'accessUsers')));
  await assertFails(F.getDocs(F.collection(view.db,'accessAudit')));
  await assertFails(oper.api.runTransaction(oper.db,tx=>{tx.update(F.doc(oper.db,'accessUsers','editor'),{role:'senior'});}));
  const run=F.doc(oper.db,'paineis','run_qa'),lock=F.doc(oper.db,'paineis','runLock_qa');
  await oper.api.runTransaction(oper.db,async tx=>{await tx.get(lock);tx.set(run,{start:1,end:null});tx.set(lock,{runId:'run_qa'});});
  await oper.api.runTransaction(oper.db,async tx=>{await tx.get(lock);tx.update(run,{end:2});tx.delete(lock);});
  assert.equal((await F.getDoc(run)).data().end,2);assert.equal((await F.getDoc(lock)).exists(),false);
  const before=(await F.getDocs(F.collection(root.db,'accessAudit'))).size;
  await oper.api.setDoc(panel(oper.db),{plan:'plano revisto'});
  assert.equal((await F.getDocs(F.collection(root.db,'accessAudit'))).size,before);
  const user=(await service.users()).find(u=>u.uid==='editor');
  await service.save({...user,role:'viewer'},user);
  await assertFails(oper.api.setDoc(panel(oper.db),{plan:'edição revogada'}));
  await service.save({...user,role:'viewer',active:false},{...user,role:'viewer'});
  await assertFails(F.getDoc(panel(oper.db)));
  const logs=await service.audit();assert(logs.some(d=>d.data().actor==='editor'&&d.data().target==='pcp'));
  const roleChange=logs.find(d=>d.data().before?.role==='editor'&&d.data().after?.role==='viewer');
  assert(roleChange);assert(roleChange.data().fields.includes('role'));
  await assertFails(F.deleteDoc(logs[0].ref));
});
test('TV anônima depende de autorização e só consulta os documentos de exibição',async()=>{
  const t=env.authenticatedContext('tvfixture',{firebase:{sign_in_provider:'anonymous'}}).firestore(),owner=context('owner');
  const dev=F.doc(t,'accessScreens','tvfixture');await F.setDoc(dev,{code:'AB12CD34',active:false});
  const panel=F.doc(t,'paineis','pcp');await assertFails(F.getDoc(panel));
  await owner.api.runTransaction(owner.db,tx=>{tx.update(F.doc(owner.db,'accessScreens','tvfixture'),{active:true});});
  assert((await F.getDoc(panel)).exists());
  await assertFails(F.getDoc(F.doc(t,'paineis','run_qa')));
  await assertFails(F.setDoc(panel,{plan:'negado'}));await assertFails(F.getDocs(F.collection(t,'accessUsers')));
});
test('Troca do login, reativação e prevenção de duplicidade',async()=>{
  const root=context('owner');const service=accounts({F,db:root.db,logged:root.api,auth:{currentUser:{uid:OWNER}}});
  const u=(await service.users()).find(p=>p.uid==='editor');
  await service.save({...u,login:'Editor.Novo',active:true},u);
  const record=(await F.getDoc(F.doc(root.db,'accessUsers','editor'))).data();assert.equal(record.login,'editor.novo');
  const changed={...record,uid:'editor'};
  await assert.rejects(()=>service.save({...changed,login:'ivan.antoneli'},changed));
  assert((await F.getDoc(F.doc(root.db,'accessLogins','editor.novo'))).exists());
});
