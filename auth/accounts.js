import {ticket} from './crypto.js';
export const OWNER = 'dAgYSGswrIOhVYxiB7VXAzqVOhk1';
export const roles = {senior:'Sênior',editor:'Editor',viewer:'Visualizador'};
export const canonical = value => String(value||'').trim().toLowerCase();
export function accounts({apps,A,F,config,auth,db,logged}) {
  const ref=(area,id)=>F.doc(db,area,id);
  const read=(area,id)=>F.getDocFromServer(ref(area,id));
  function valid(profile) {
    if(!/^[a-z0-9._-]{3,40}$/.test(profile.login) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(profile.email) ||
       !Object.hasOwn(roles,profile.role)) throw Error('Confira o login, o e-mail e o nível de acesso.');
  }
  async function reserve(tx,uid,login,prevLogin,passTicket,oldUid) {
    const alias=ref('accessLogins',login),current=(await tx.get(alias)).data();
    if(current && current.uid!==uid && current.uid!==oldUid)throw Error('Esse login já está em uso.');
    let ticketId=passTicket?.id || (current?.uid===uid?current.ticket:null);
    tx.set(alias,{uid,ticket:ticketId});
    if(passTicket)tx.set(ref('loginTickets',passTicket.id),passTicket.payload);
    if(current?.ticket && current.ticket!==ticketId)tx.delete(ref('loginTickets',current.ticket));
    if(prevLogin && prevLogin!==login) {
      const old=ref('accessLogins',prevLogin),prior=(await tx.get(old)).data();
      if(prior?.uid===uid || (oldUid && prior?.uid===oldUid)){
        if(prior.ticket)tx.delete(ref('loginTickets',prior.ticket));tx.delete(old);
      }
    }
  }
  async function makeTicket(login,email,password) {
    const t=await ticket(login,password);return {id:t.id,payload:await t.encode(email)};
  }
  async function signIn(identity,password) {
    identity=canonical(identity);
    let email=identity,aliasTicket=null;
    if(!identity.includes('@')){
      aliasTicket=await ticket(identity,password);
      const snap=await read('loginTickets',aliasTicket.id);
      if(!snap.exists())throw Error('Credenciais inválidas.');
      email=await aliasTicket.decode(snap.data());
    }
    let user;
    try {
      user=(await A.signInWithEmailAndPassword(auth,email,password)).user;
      const p=ref('accessUsers',user.uid);
      let profile=(await F.getDocFromServer(p)).data();
      if(!profile && user.uid===OWNER) {
        const initial={email:canonical(user.email),login:'ivan.antoneli',role:'senior',active:true};
        const sealed=await makeTicket(initial.login,initial.email,password);
        await logged.runTransaction(db,async tx=>{
          if((await tx.get(p)).exists())return;
          await reserve(tx,user.uid,initial.login,null,sealed);
          tx.set(p,initial);
        });
        profile=(await F.getDocFromServer(p)).data();
      }
      if(!profile?.active || !Object.hasOwn(roles,profile.role) || canonical(user.email)!==profile.email ||
         (aliasTicket && profile.login!==identity)){
        const error=Error('Acesso indisponível.');error.code='access/inactive';
        error.profile={login:profile?.login||identity,email:canonical(user.email)};throw error;
      }
      if(!aliasTicket) {
        const t=await makeTicket(profile.login,profile.email,password);
        if((await read('accessLogins',profile.login)).data()?.ticket!==t.id)
          await logged.runTransaction(db,async tx=>{await reserve(tx,user.uid,profile.login,null,t);});
      }
      return {...profile,uid:user.uid};
    } catch(error){ if(user)await A.signOut(auth);throw error; }
  }
  async function identity(email,password,work) {
    if(typeof password!=='string'||password.length<8)throw Error('A senha inicial precisa ter pelo menos 8 caracteres.');
    const app=apps.initializeApp(config,'provision-'+crypto.randomUUID());
    const secondary=A.initializeAuth(app,{persistence:A.inMemoryPersistence});
    if(auth.emulatorConfig&&!secondary.emulatorConfig)A.connectAuthEmulator(secondary,auth.emulatorConfig.url||'http://127.0.0.1:9099',{disableWarnings:true});
    let user;
    try {
      try {user=(await A.createUserWithEmailAndPassword(secondary,email,password)).user;}
      catch(e){if(e.code!=='auth/email-already-in-use')throw e;
        user=(await A.signInWithEmailAndPassword(secondary,email,password)).user;}
      return await work(user.uid);
    } finally {await A.signOut(secondary).catch(()=>{});await apps.deleteApp(app);}
  }
  async function save(form,original) {
    const profile={login:canonical(form.login),email:canonical(form.email),role:form.role,active:form.active===true};
    valid(profile);
    if(original && (original.uid===auth.currentUser.uid || original.uid===OWNER))throw Error('A conta administrativa em uso é protegida.');
    if(original && original.email===profile.email) {
      return logged.runTransaction(db,async tx=>{
        const p=ref('accessUsers',original.uid),prev=(await tx.get(p)).data();
        if(!prev || ['email','login','role','active'].some(k=>prev[k]!==original[k]))throw Error('O cadastro mudou. Reabra para editar.');
        if(prev.login!==profile.login)await reserve(tx,original.uid,profile.login,prev.login,null);
        tx.set(p,profile);
      });
    }
    if(typeof form.password!=='string'||form.password.length<8)throw Error('A senha inicial precisa ter pelo menos 8 caracteres.');
    const t=await makeTicket(profile.login,profile.email,form.password);
    return identity(profile.email,form.password,async uid=>{
      await logged.runTransaction(db,async tx=>{
        const target=ref('accessUsers',uid);
        if((await tx.get(target)).exists())throw Error('Este e-mail já tem um perfil.');
        if(original) {
          const old=ref('accessUsers',original.uid),current=(await tx.get(old)).data();
          if(!current||['email','login','role','active'].some(k=>current[k]!==original[k]))throw Error('O cadastro mudou. Reabra para editar.');
          tx.set(old,{...current,active:false});
        }
        await reserve(tx,uid,profile.login,original?.login,t,original?.uid);
        tx.set(target,profile);
      });
    });
  }
  return {signIn,save,reset:email=>A.sendPasswordResetEmail(auth,canonical(email)),
    users:async()=>(await F.getDocsFromServer(F.collection(db,'accessUsers'))).docs.map(d=>({...d.data(),uid:d.id})),
    screens:async()=>(await F.getDocsFromServer(F.collection(db,'accessScreens'))).docs.map(d=>({...d.data(),uid:d.id})),
    setScreen:(uid,active)=>logged.runTransaction(db,tx=>{tx.update(ref('accessScreens',uid),{active});}),
    audit:async after=>{const filters=[F.orderBy('at','desc')];if(after)filters.push(F.startAfter(after));filters.push(F.limit(40));
      return (await F.getDocsFromServer(F.query(F.collection(db,'accessAudit'),...filters))).docs;}
  };
}
