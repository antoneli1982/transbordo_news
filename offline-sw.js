const CACHE='transbordo-shell-auth-20261125-1';
const base=new URL(self.registration.scope);
const paths=['index.html','auth/start.js','auth/login-dialog.js','auth/access.css','auth/accounts.js','auth/database.js','auth/firebase.js','auth/vault.js','auth/crypto.js','auth/admin.js'];
const shell=new Set(paths.map(p=>new URL(p,base).href));
const home=new URL('index.html',base).href;
self.addEventListener('install',e=>e.waitUntil((async()=>{
  const c=await caches.open(CACHE);await c.addAll([...shell].map(url=>new Request(url,{cache:'reload'})));await self.skipWaiting();
})()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{
  for(const name of await caches.keys())if(name.startsWith('transbordo-shell-')&&name!==CACHE)await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=='GET'||u.origin!==base.origin)return;
  const isHome=r.mode==='navigate'&&(u.pathname===base.pathname||u.pathname===new URL(home).pathname);
  const key=isHome?home:u.href;
  if(!shell.has(key))return;
  e.respondWith((async()=>{const c=await caches.open(CACHE);const stored=await c.match(key);
    return stored||fetch(r);
  })());
});
