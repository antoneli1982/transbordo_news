import {solicitarAcesso} from './login-dialog.js';
import {accounts,roles} from './accounts.js';
import {auditedDatabase} from './database.js';
import {openVault,memoryVault,vaultKey,issueLease,unlockOffline,revokeLease,migrateLegacy} from './vault.js';
import {hex,random} from './crypto.js';
import {openAdministration} from './admin.js';
const isTV=new URLSearchParams(location.search).get('tv')==='1';
const gate=document.getElementById('access-message');
const root=document.documentElement;
let services, current, closing=false;
function message(title,detail,again) {
  const a=document.createElement('strong'),b=document.createElement('p');a.textContent=title;b.textContent=detail;
  gate.replaceChildren(a,b);gate.hidden=false;
  if(again){const btn=document.createElement('button');btn.textContent='Tentar novamente';btn.onclick=()=>location.reload();gate.append(btn);}
}
async function online() {
  if(!services)services=(async()=>{
    const {apps,auth:A,firestore:F,config}=await import('./firebase.js');
    const app=apps.initializeApp(config,isTV?'transbordo-tv':'transbordo');
    const auth=A.initializeAuth(app,{persistence:isTV?A.indexedDBLocalPersistence:A.inMemoryPersistence});
    auth.languageCode='pt';
    const db=F.getFirestore(app),logged=auditedDatabase(F,db,()=>auth.currentUser?.uid);
    await auth.authStateReady();
    // Esta leitura usa um identificador vazio de dados. A versão autenticada exige a política publicada.
    try{await F.getDocFromServer(F.doc(db,'paineis','_verificacao_de_acesso'));throw Error('A proteção do projeto está pendente.');}
    catch(error){if(error.code!=='permission-denied')throw error;}
    const service=accounts({apps,A,F,config,db,auth,logged});return {A,F,auth,db,logged,service};
  })().catch(e=>{services=null;throw e;});
  return services;
}
async function credentials(alias,password) {
  let profile,raw,expires,remote;
  if(!navigator.onLine) {
    ({profile,raw,expires}=await unlockOffline(alias,password));
  } else {
    remote=await online();
    try{profile=await remote.service.signIn(alias,password);}
    catch(error){if(error.code==='access/inactive')await revokeLease(error.profile).catch(()=>{});throw error;}
    raw=await vaultKey(remote.F,remote.db,profile.uid);

  }
  const vault=await openVault(profile.uid,raw);
  if(profile.role!=='viewer')await migrateLegacy(vault);
  await vault.warm();
  if(remote)expires=await issueLease(profile,raw,password);
  return {profile,remote,vault,expires};
}
async function screen() {
  const remote=await online(),{A,F,auth,db}=remote;
  await auth.authStateReady();if(!auth.currentUser)await A.signInAnonymously(auth);
  const uid=auth.currentUser.uid,ref=F.doc(db,'accessScreens',uid);
  const info=await F.runTransaction(db,async tx=>{
    const snap=await tx.get(ref);if(snap.exists())return snap.data();
    const row={active:false,code:hex(random(4)).toUpperCase()};tx.set(ref,row);return row;
  });
  if(!info.active){
    message('Código da TV · '+info.code,'Peça ao Sênior para autorizar este código em Gestão de acessos › TVs.');
    await new Promise((resolve,reject)=>{const unsubscribe=F.onSnapshot(ref,s=>{
      if(!s.metadata.fromCache&&s.data()?.active===true){unsubscribe();resolve();}
    },reject);});
  }
  return {profile:{uid,login:'TV',role:'screen',active:true},remote,vault:memoryVault(),expires:null};
}
async function end(reason,clear=true) {
  if(closing)return;closing=true;root.dataset.locked='';
  for(const d of document.querySelectorAll('dialog[open]'))d.close();
  message('Sessão encerrada',reason,false);
  window.dispatchEvent(new Event('access-flush'));
  try{await current?.vault.flush();}catch{message('Falha ao salvar neste aparelho','Mantenha a página aberta e verifique o espaço disponível.',false);return;}
  const c=current;
  if(clear && c && !isTV)await revokeLease(c.profile).catch(()=>{});
  if(c?.remote && !isTV)await c.remote.A.signOut(c.remote.auth).catch(()=>{});
  location.reload();
}
function viewsOnly(){
  const allowed=['.ed-tab','.tn-session button','.calc-wrap button','#edSearch','#edSearchClear','#btnExport',
    '#btnPrevItem','#btnNextItem','#btnGoLista','#btnPreviewTv','#btnPreviewTv2','.catalog-edit','#btnCadastroPCP',
    '#pcpPdf','#dashExport','#dashBack','#dashFrom','#dashTo','#dashPerson','#dashPart','#dashClear','.dash-range',
    '#pcpClosePeople','#pcpExportPeople','#pcpExportPeopleTop','[data-theme-choice]','[data-det-close]'].join(',');
  const host=document.getElementById('editor');
  const selector='input,select,textarea,button,[contenteditable=true]';
  function protect(el){if(el.matches(allowed))return;
    if(el.isContentEditable)el.contentEditable='false';
    else if(!el.disabled)el.disabled=true;
  }
  function inspect(node){if(node.nodeType!==1)return;if(node.matches(selector))protect(node);node.querySelectorAll(selector).forEach(protect);}
  inspect(host);
  new MutationObserver(records=>{for(const r of records){if(r.type==='attributes')protect(r.target);else r.addedNodes.forEach(inspect);}})
    .observe(host,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled']});
}
async function enter(session) {
  current=session;
  const {profile,vault,remote,expires}=session;
  const edit=profile.role==='senior'||profile.role==='editor';
  if(remote){
    window.__FB=edit?remote.logged:{...remote.logged,
      setDoc:async()=>{throw Error('Acesso de consulta.');},runTransaction:async()=>{throw Error('Acesso de consulta.');}};
    const ref=remote.F.doc(remote.db,isTV?'accessScreens':'accessUsers',profile.uid);
    const verify=data=>data?.active===true&&(isTV||(data.role===profile.role&&data.login===profile.login&&data.email===profile.email));
    remote.F.onSnapshot(ref,{includeMetadataChanges:true},snap=>{
      if(!snap.metadata.fromCache&&!verify(snap.data()))end('Sua permissão foi atualizada.');
    },()=>end('Sua autorização precisa ser conferida novamente.'));
    if(isTV){
      let lastCheck=Date.now();
      const check=async()=>{try{const snap=await remote.F.getDocFromServer(ref);
        if(!verify(snap.data()))return end('TV bloqueada.');lastCheck=Date.now();
      }catch{if(Date.now()-lastCheck>15*60*1000)end('Reconecte a TV para confirmar a autorização.');}};
      setInterval(check,60000);window.addEventListener('online',check);
    }
  }else window.addEventListener('online',()=>end('Conexão restabelecida. Entre para sincronizar os registros.',false),{once:true});
  if(expires) {
    const remaining=Math.max(0,expires-Date.now());
    setTimeout(()=>end('Entre novamente para renovar o acesso.'),remaining);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()>=expires)end('A sessão expirou.');});
  }
  window.addEventListener('vault-error',()=>{const note=document.getElementById('access-storage-warning');note.hidden=false;});
  root.dataset.role=profile.role;
  const group=document.createElement('div');group.className='tn-session';
  const text=document.createElement('span');text.textContent=profile.login+' · '+(roles[profile.role]||'TV');group.append(text);
  if(profile.role==='senior'&&remote){const admin=document.createElement('button');admin.type='button';admin.textContent='Gestão de acessos';
    admin.onclick=()=>openAdministration(remote.service,profile);group.append(admin);}
  const logout=document.createElement('button');logout.type='button';logout.textContent='Sair';logout.onclick=()=>end('Você saiu do sistema.');group.append(logout);
  document.querySelector('.ed-actions').append(group);
  window.bootTransbordo({profile,vault,edit,screen:isTV});
  delete window.bootTransbordo;if(!edit)viewsOnly();delete root.dataset.locked;gate.hidden=true;
}
async function main() {
  if('serviceWorker' in navigator)navigator.serviceWorker.register('./offline-sw.js').then(()=>navigator.serviceWorker.ready).then(()=>{
    window.transbordoOfflineReady=true;window.dispatchEvent(new Event('offline-shell-ready'));
  }).catch(()=>window.dispatchEvent(new Event('offline-shell-error')));
  message('Transbordo News',isTV?'Conectando o painel da TV…':'Acesso ao PCP e ao Transbordo');
  if(isTV)window.addEventListener('online',()=>{if(!current)location.reload();});
  const session=isTV?await screen():await solicitarAcesso({entrar:credentials,recuperar:async email=>(await online()).service.reset(email)});
  await enter(session);
}
main().catch(e=>{
  console.error('Não foi possível abrir o Transbordo.',e.code||e.name);
  root.dataset.locked='';message('Acesso indisponível',isTV?'Confira a conexão e a autorização desta TV.':'Confira a conexão e tente entrar novamente.',true);
});
