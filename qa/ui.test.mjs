import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {OWNER} from '../auth/accounts.js';

const project='demo-transbordo', ownerEmail='owner.ui@example.invalid';
const email=role=>role+'.ui@example.invalid';
const pcp={date:'2026-11-25',reference:'QA original',rows:[{id:'qa-ui',code:'QA-01',itemId:'p1',postCount:'1',stations:[{workers:'1',boxes:'3',people:[]}]}],revision:'qa',savedAt:1};
const catalog={settings:{panelTitle:'Teste de homologação',intervalSec:15},
  items:[{id:'p1',partCode:'QA-01',partName:'Peça de homologação',time:'00:00:12,00',qtyPerBox:'10',status:'open'}]};
const bundle=`
import * as apps from 'firebase/app';
import * as a from 'firebase/auth';
import * as f from 'firebase/firestore';
export {apps};
export const config={apiKey:'emulator',authDomain:'localhost',projectId:'demo-transbordo',appId:'qa'};
export const auth={...a,initializeAuth(app,opts){const auth=a.initializeAuth(app,opts);a.connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});return auth;}};
export const firestore={...f,getFirestore(app){const db=f.getFirestore(app);f.connectFirestoreEmulator(db,'127.0.0.1',8080);return db;}};
`;
async function preview(){
  const built=await build({stdin:{contents:bundle,resolveDir:process.cwd()},bundle:true,format:'esm',write:false,minify:true});
  const server=createServer(async(req,res)=>{try{
    const pathname=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
    if(!/^(?:auth\/)?[\w.-]+$/.test(pathname)){res.writeHead(404).end();return;}
    const data=pathname==='auth/firebase.js'?built.outputFiles[0].contents:await fs.readFile(path.resolve(pathname));
    const mime={'.js':'text/javascript','.html':'text/html','.css':'text/css'};
    res.writeHead(200,{'content-type':(mime[path.extname(pathname)]||'text/plain')+'; charset=utf-8','Content-Security-Policy':"connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*; font-src 'self' data:; style-src 'self' 'unsafe-inline'"});res.end(data);
  }catch{res.writeHead(404).end();}});
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));return {server,url:'http://127.0.0.1:'+server.address().port};
}
async function until(fn,what){const end=Date.now()+15000;while(Date.now()<end){if(await fn())return;await delay(150);}throw Error(what);}
test('Fluxo completo da interface, troca de senha, PCP, TV, revogação e modo offline',{timeout:165000},async()=>{
  assert(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST,'Somente emuladores');
  const app=initializeApp({projectId:project}),db=getFirestore(app),auth=getAuth(app);
  const addr='http://'+process.env.FIRESTORE_EMULATOR_HOST+'/emulator/v1/projects/'+project+'/databases/(default)/documents';
  assert((await fetch(addr,{method:'DELETE'})).ok);
  const password=crypto.randomUUID(),nextPassword=crypto.randomUUID();
  await auth.createUser({uid:OWNER,email:ownerEmail,password});
  await db.collection('paineis').doc('principal').set({state:JSON.stringify(catalog),updatedAt:1,updatedBy:'qa'});
  await db.collection('paineis').doc('pcp').set({plan:JSON.stringify(pcp),updatedAt:1,updatedBy:'qa'});
  const {server,url}=await preview();const browser=await chromium.launch();
  const contexts=[],errors=[];
  async function page(viewport) {
    const ctx=await browser.newContext({viewport});contexts.push(ctx);

    const p=await ctx.newPage();p.setDefaultTimeout(12000);
    p.on('console',msg=>{if(msg.type()==='error'||msg.type()==='warning')console.log('Console QA:',msg.text().slice(0,400));});
    p.on('pageerror',e=>{errors.push(e.message);console.error('Erro de interface:',e.message);});return p;
  }
  const button=(p,name)=>p.getByRole('button',{name,exact:true});
  async function login(p,id,pass){
    const dlg=p.locator('.tn-login');await dlg.waitFor();await dlg.getByLabel('Login ou e-mail').fill(id);
    await dlg.locator('#tn-senha').fill(pass);await button(dlg,'Entrar').click();
    await p.locator('html:not([data-locked])').waitFor();
  }
  try{
    const senior=await page({width:1280,height:800});await senior.goto(url,{waitUntil:'domcontentloaded'});
    assert(await senior.locator('#editor').isHidden());await login(senior,ownerEmail,password);
    assert.equal(await senior.locator('html').getAttribute('data-role'),'senior');console.log('Primeiro acesso Sênior confirmado');
    await button(senior,'Gestão de acessos').click();const admin=senior.locator('.tn-admin');
    for(const role of ['editor','viewer']){
      await button(admin,'Cadastrar usuário').click();await admin.getByLabel('Login',{exact:true}).fill(role+'.ui');
      await admin.getByLabel('E-mail',{exact:true}).fill(email(role));await admin.getByLabel('Senha inicial').fill(password);
      await admin.getByLabel('Nível de acesso').selectOption(role);await button(admin,'Salvar usuário').click();
      await admin.getByText(email(role),{exact:true}).waitFor();
    }
    console.log('Gestão de usuários pela conta Sênior confirmada');
    const edit=await page({width:1100,height:800});await edit.goto(url,{waitUntil:'domcontentloaded'});await login(edit,'EdItOr.UI',password);
    assert.equal(await button(edit,'Gestão de acessos').count(),0);
    await until(()=>edit.locator('#pcpRef').inputValue().then(v=>v==='QA original'),'PCP original não abriu').catch(async e=>{console.error('Estado PCP:',await edit.locator('#pcpRef').inputValue(),await edit.locator('#pcpDraftStatus').textContent(),await edit.locator('#sync-badge').allTextContents());throw e;});
    await edit.locator('#pcpRef').fill('QA revisado');await edit.locator('#pcpRef').press('Tab');
    await until(async()=>JSON.parse((await db.doc('paineis/pcp').get()).data().plan).reference==='QA revisado','PCP não sincronizou');
    await edit.locator('.pcp-run-btn').first().click();
    await until(async()=>(await db.doc('paineis/runLock_qa-ui').get()).exists,'Start sem registro');
    await edit.locator('.pcp-run-btn').first().click();
    const stop=edit.locator('#stopDialog');await stop.waitFor();await stop.locator('[value=manual]').check();
    await stop.locator('[name=boxes]').fill('2');await stop.locator('[value=no]').check();await button(stop,'Confirmar encerramento').click();
    await until(async()=>!(await db.doc('paineis/runLock_qa-ui').get()).exists,'Stop não concluiu');
    const runs=await db.collection('paineis').where('boxes','==',2).get();assert.equal(runs.size,1);console.log('Start, Stop e quantidade de caixas confirmados');
    const viewer=await page({width:360,height:740});await viewer.goto(url,{waitUntil:'domcontentloaded'});
    const dlg=viewer.locator('.tn-login');await button(dlg,'Mostrar senha').click();assert.equal(await dlg.locator('#tn-senha').getAttribute('type'),'text');
    assert(await viewer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await login(viewer,'VIEWER.UI',password);assert(await viewer.locator('#pcpRef').isDisabled());assert.equal(await button(viewer,'Gestão de acessos').count(),0);
    await viewer.locator('.ed-tab[data-page=historico]').click();await viewer.locator('.history-entry summary').first().waitFor();
    const tv=await page({width:1280,height:720});await tv.goto(url+'/?tv=1',{waitUntil:'domcontentloaded'});
    await tv.getByText(/Código da TV · /).waitFor();assert(await tv.locator('#editor').isHidden());
    await button(admin,'TVs').click();await button(admin,'Autorizar').click();await tv.locator('html[data-role=screen]:not([data-locked])').waitFor();
    assert.equal(await tv.locator('body').getAttribute('data-view'),'display');
    await tv.reload({waitUntil:'domcontentloaded'});await tv.locator('html[data-role=screen]:not([data-locked])').waitFor();
    console.log('TV autorizada voltou após recarga');
    const reset=await page({width:360,height:740});await reset.goto(url,{waitUntil:'domcontentloaded'});
    await button(reset,'Esqueci minha senha').click();await reset.getByLabel('E-mail cadastrado').fill(email('viewer'));
    await button(reset,'Enviar link de recuperação').click();await reset.getByText(/você receberá o link/).waitFor();
    const codes=await (await fetch('http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST+'/emulator/v1/projects/'+project+'/oobCodes')).json();
    const code=codes.oobCodes.find(c=>c.email===email('viewer')&&c.requestType==='PASSWORD_RESET');assert(code);
    assert((await fetch('http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST+'/identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=emulator',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({oobCode:code.oobCode,newPassword:nextPassword})})).ok);
    await button(reset,'Voltar para o login').click();await login(reset,email('viewer'),nextPassword);
    console.log('Redefinição por e-mail e recuperação do login confirmadas');
    await button(admin,'Usuários').click();const vr=admin.locator('.tn-row').filter({hasText:email('viewer')});
    await button(vr,'Editar').click();await admin.getByLabel('Acesso ativo').uncheck();await button(admin,'Salvar usuário').click();
    await viewer.locator('.tn-login').waitFor();assert(await viewer.locator('#editor').isHidden());
    await button(admin,'Auditoria').click();await admin.getByText(/Alteração · Operação · pcp/).first().waitFor();console.log('Revogação e auditoria confirmadas');
    await edit.evaluate(()=>navigator.serviceWorker.ready);
    await edit.context().setOffline(true);await edit.reload({waitUntil:'domcontentloaded'});await login(edit,'EDITOR.UI',password);
    await until(()=>edit.locator('#pcpRef').inputValue().then(v=>v==='QA revisado'),'Cópia privada não foi recuperada offline');
    assert(await edit.evaluate(()=>!Object.keys(localStorage).some(k=>k.includes('plan_v')||k.includes('transbordo_v'))));
    console.log('Consulta ao PCP após recarga offline confirmada');assert.deepEqual(errors,[]);
  }finally{await browser.close();server.close();await db.terminate();await deleteApp(app);}
});
