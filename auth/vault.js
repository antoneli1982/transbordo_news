import {aes, derive, hex, open, random, seal, unhex} from './crypto.js';
const appKeys = key => /^(sese_(?:transbordo_|pcp_|tv_demo)|transbordo-server-version-|transbordoTranslateCacheV1|pcp-offline-runs-v1)/.test(key);
const shift = 8 * 60 * 60 * 1000;
const req = r => new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
function finished(tx) { return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error || Error('Falha no armazenamento deste aparelho.'));}); }
let connection;
async function database() {
  if(!connection) {
    const r=indexedDB.open('transbordo-private-v1',1);
    r.onupgradeneeded=()=>{r.result.createObjectStore('data');r.result.createObjectStore('leases');};
    connection=req(r).catch(e=>{connection=null;throw e;});
  }
  return connection;
}
async function get(store,key) { const db=await database();return req(db.transaction(store).objectStore(store).get(key)); }
async function put(store,key,value) { const db=await database(), t=db.transaction(store,'readwrite'), done=finished(t);t.objectStore(store).put(value,key);await done; }
async function remove(store,key) { const db=await database(), t=db.transaction(store,'readwrite'), done=finished(t);t.objectStore(store).delete(key);await done; }
const leaseContext = alias => 'transbordonews/offline/v1/'+alias;
const hash = async text=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
export const mediaKey = async url=>'media:'+await hash(url);
async function leaseId(alias){return hash(leaseContext(alias));}
export async function issueLease(profile,raw,password) {
  const salt=random(16),key=await aes(await derive(password,salt)), expires=Date.now()+shift;
  for(const alias of new Set([profile.login,profile.email])) {
    await put('leases',await leaseId(alias),{salt,...await seal(key,leaseContext(alias),{profile,raw,expires})});
  }
  return expires;
}
export async function revokeLease(profile) {
  await Promise.all([profile.login,profile.email].map(async alias=>remove('leases',await leaseId(alias))));
}
export async function unlockOffline(alias,password) {
  const r=await get('leases',await leaseId(alias));if(!r)throw Error('Entre uma vez com conexão neste aparelho.');
  const value=await open(await aes(await derive(password,r.salt)),leaseContext(alias),r);
  if(Date.now()>=value.expires || value.expires-Date.now()>shift) throw Error('Reconecte para renovar o acesso.');
  return value;
}
export async function vaultKey(F,db,uid) {
  const ref=F.doc(db,'accessVaults',uid), proposed=hex(random(32));
  return F.runTransaction(db,async tx=>{
    const snap=await tx.get(ref);if(snap.exists())return snap.data().key;
    tx.set(ref,{key:proposed});return proposed;
  });
}
export async function openVault(uid,raw) {
  const db=await database(),key=await aes(unhex(raw)), memory=new Map(), pending=new Set();
  const name='transbordo-private-'+uid;
  const channel=typeof BroadcastChannel==='function'?new BroadcastChannel(name):null;
  const context=k=>uid+'/'+k;
  const read=async k=>{const r=await get('data',[uid,k]);return r?open(key,context(k),r):undefined;};
  async function modify(k,change) {
    // Compare-and-swap no IndexedDB. A criptografia acontece fora da transação curta.
    for(;;) {
      const prior=await get('data',[uid,k]);
      const old=prior?await open(key,context(k),prior):undefined;
      const value=change(old);
      if(value===undefined)return old;
      const record={...await seal(key,context(k),value),rev:hex(random(12))};
      const tx=db.transaction('data','readwrite'),done=finished(tx),s=tx.objectStore('data');
      const current=await req(s.get([uid,k]));
      if(current?.rev!==prior?.rev){await done;continue;}
      s.put(record,[uid,k]);await done;channel?.postMessage(k);return value;
    }
  }
  const writes=new Map();
  function mutate(k,change) {
    const task=modify(k,change);pending.add(task);
    task.then(()=>pending.delete(task),()=>pending.delete(task));return task;
  }
  function write(k,v) {
    const action=(writes.get(k)||Promise.resolve()).catch(()=>{}).then(async()=>{
      const record={...await seal(key,context(k),v),rev:hex(random(12))};
      await put('data',[uid,k],record);channel?.postMessage(k);
    });
    writes.set(k,action);pending.add(action);
    action.then(clear,clear);return action;
    function clear(){pending.delete(action);if(writes.get(k)===action)writes.delete(k);}
  }
  async function warm() {
    const range=IDBKeyRange.bound([uid,'ls:'],[uid,'ls:\uffff']);
    const keys=await req(db.transaction('data').objectStore('data').getAllKeys(range));
    for(const [,k] of keys)memory.set(k.slice(3),await read(k));
  }
  channel?.addEventListener('message',async e=>{
    if(e.data==='catalog'){
      const record=await read('catalog');
      if(record)window.dispatchEvent(new StorageEvent('storage',{key:'sese_transbordo_v4',newValue:record.json}));
      return;
    }
    if(typeof e.data!=='string'||!e.data.startsWith('ls:'))return;
    const k=e.data.slice(3),value=await read(e.data);
    memory.set(k,value);window.dispatchEvent(new StorageEvent('storage',{key:k,newValue:value}));
  });
  function report(e) {window.dispatchEvent(new CustomEvent('vault-error',{detail:e}));}
  const storage={
    getItem(k){return k==='sese_screen_theme_v1'?window.localStorage.getItem(k):memory.get(k)??null;},
    setItem(k,v){if(k==='sese_screen_theme_v1'){window.localStorage.setItem(k,v);return;}
      v=String(v);if(memory.get(k)===v)return;memory.set(k,v);
      write('ls:'+k,v).catch(e=>{if(memory.get(k)===v)memory.delete(k);report(e);});}
  };
  window.addEventListener('beforeunload',e=>{if(pending.size){e.preventDefault();e.returnValue='';}});
  return {storage,warm,read,write,mutate,report,mediaKey,async flush(){while(pending.size)await Promise.all([...pending]);}};
}
export async function migrateLegacy(vault) {
  async function copy(k,value) {
    const saved=await vault.read(k);
    if(saved!==undefined && JSON.stringify(saved)!==JSON.stringify(value)) {
      // Preserve a divergent draft for recovery by this operator.
      k='legacy:'+Date.now()+':'+k;
    }
    await vault.write(k,value);
    if(JSON.stringify(await vault.read(k))!==JSON.stringify(value))throw Error('A conferência da migração falhou.');
  }
  const keys=Object.keys(window.localStorage).filter(appKeys);
  for(const k of keys){
    const value=window.localStorage.getItem(k);if(value===null)continue;
    await copy('ls:'+k,value);if(window.localStorage.getItem(k)===value)window.localStorage.removeItem(k);
  }
  const legacy=await req(indexedDB.open('sese_transbordo_db'));
  try {
    const keys=legacy.objectStoreNames.contains('kv')?await req(legacy.transaction('kv').objectStore('kv').getAllKeys()):[];
    for(const k of keys){
      if(typeof k!=='string'||!appKeys(k))continue;
      const value=await req(legacy.transaction('kv').objectStore('kv').get(k));if(value===undefined)continue;
      await copy('db:'+k,value);
      const tx=legacy.transaction('kv','readwrite'),done=finished(tx),s=tx.objectStore('kv');
      const current=await req(s.get(k));
      if(JSON.stringify(current)===JSON.stringify(value))s.delete(k);
      await done;
    }
  }finally{legacy.close();}
  if(!window.caches)return;
  for(const name of ['transbordo-images-v1','transbordo-mtm-v1']){
    if(!(await caches.has(name)))continue;
    const cache=await caches.open(name);
    for(const request of await cache.keys()){
      let response=await cache.match(request);
      if(!response)continue;
      if(response.type==='opaque'){
        try{response=await fetch(request.url,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});}
        catch{response=null;}
      }
      if(!response?.ok){
        const error=Error('Não foi possível proteger um anexo antigo deste posto. Reconecte o aparelho para concluir a migração.');
        error.code='access/migration';throw error;
      }
      const blob=await response.blob();
      const encoded=await new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=no;r.readAsDataURL(blob);});
      const k=await mediaKey(request.url);await copy(k,encoded);
      await cache.delete(request);
    }
    if(!(await cache.keys()).length)await caches.delete(name);
  }
}
export function memoryVault() {
  const m=new Map();
  return {mediaKey,storage:{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v))},read:async k=>m.get(k),
    write:async(k,v)=>{m.set(k,v);},mutate:async(k,fn)=>{const v=fn(m.get(k));if(v!==undefined)m.set(k,v);return m.get(k);},
    warm:async()=>{},flush:async()=>{},report:()=>{}};
}
