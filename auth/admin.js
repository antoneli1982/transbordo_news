import {OWNER,roles} from './accounts.js';
const node=(tag,label)=>{const n=document.createElement(tag);if(label!==undefined)n.textContent=label;return n;};
function action(label,fn){const b=node('button',label);b.type='button';b.onclick=fn;return b;}
const errorText=e=>({'auth/email-already-in-use':'Este e-mail já tem cadastro.',
  'auth/invalid-credential':'O e-mail já existe e a senha inicial não confere.',
  'auth/weak-password':'A senha não atende aos requisitos do Firebase.',
  'permission-denied':'Acesso recusado. Confira sua sessão.'}[e.code] || e.message || 'Não foi possível concluir.');
export async function openAdministration(service,actor) {
  const dialog=node('dialog');dialog.className='tn-admin';dialog.setAttribute('aria-label','Gestão de acessos');
  const top=node('header');top.append(node('h2','Gestão de acessos'),action('Fechar',()=>dialog.close()));
  const nav=node('nav'),body=node('section'),msg=node('p');msg.setAttribute('role','status');
  dialog.append(top,nav,msg,body);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  let people=[],page=0;
  function section(fn){return async()=>{const current=++page;msg.textContent='Carregando…';body.replaceChildren();
    try {await fn(current);if(page===current&&msg.textContent==='Carregando…')msg.textContent='';}
    catch(e){if(page===current)msg.textContent=errorText(e);}};}
  function row(...items){const line=node('div');line.className='tn-row';line.append(...items);return line;}
  function label(name,control){const l=node('label',name);l.append(control);return l;}
  function input(type,value=''){const n=node('input');n.type=type;n.value=value;n.required=true;return n;}
  function editor(user){
    ++page;msg.textContent='';body.replaceChildren();const f=node('form');f.className='tn-account-form';
    const login=input('text',user?.login),email=input('email',user?.email),pass=input('password'),level=node('select'),active=node('input');
    login.autocapitalize='none';login.spellcheck=false;login.pattern='[a-zA-Z0-9._\\-]{3,40}';
    pass.autocomplete='new-password';pass.minLength=8;active.type='checkbox';active.checked=user?.active??true;
    for(const [key,value] of Object.entries(roles)){const op=node('option',value);op.value=key;level.append(op);}
    level.value=user?.role||'viewer';const passLabel=label('Senha inicial',pass);
    function passState(){const needed=!user||email.value.trim().toLowerCase()!==user.email;pass.required=needed;passLabel.hidden=!needed;}
    email.oninput=passState;passState();const save=node('button','Salvar usuário');save.type='submit';
    f.append(node('h3',user?'Editar usuário':'Cadastrar usuário'),label('Login',login),label('E-mail',email),passLabel,
      label('Nível de acesso',level),label('Acesso ativo',active),save,action('Cancelar',users));
    if(user){const note=node('p','Ao trocar o e-mail, informe uma senha inicial para a nova conta. Ao trocar somente o login, o primeiro acesso usa o e-mail cadastrado.');
      f.append(note);}
    body.append(f);
    f.onsubmit=async e=>{e.preventDefault();save.disabled=true;msg.textContent='Salvando…';
      try{await service.save({login:login.value,email:email.value,password:pass.value,role:level.value,active:active.checked},user);
        pass.value='';await users();msg.textContent='Cadastro salvo.';}
      catch(err){msg.textContent=errorText(err);}finally{save.disabled=false;}};
  }
  const users=section(async current=>{
    people=await service.users();if(current!==page)return;
    body.append(action('Cadastrar usuário',()=>editor(null)));
    for(const u of people.sort((a,b)=>a.login.localeCompare(b.login,'pt-BR'))){
      const details=node('span');details.append(node('strong',u.login),node('small',u.email));
      const line=row(details,node('span',roles[u.role]+(u.active?' · Ativo':' · Desativado')));
      if(u.uid!==OWNER&&u.uid!==actor.uid)line.append(action('Editar',()=>editor(u)));
      body.append(line);
    }
  });
  const screens=section(async current=>{
    const devices=await service.screens();if(current!==page)return;
    body.append(node('p','Abra o link da TV no aparelho e confira o código antes de liberar a exibição.'));
    const link=node('a','Abrir painel da TV');link.href='?tv=1';link.target='_blank';link.rel='noopener';body.append(link);
    if(!devices.length)body.append(node('p','Nenhuma TV solicitou acesso.'));
    for(const screen of devices){const btn=action(screen.active?'Bloquear':'Autorizar',async()=>{
      btn.disabled=true;try{await service.setScreen(screen.uid,!screen.active);await screens();}
      catch(e){msg.textContent=errorText(e);}finally{btn.disabled=false;}});
      body.append(row(node('strong',screen.code),node('span',screen.active?'Autorizada':'Aguardando autorização'),btn));}
  });
  const audit=section(async current=>{
    if(!people.length)people=await service.users();if(page!==current)return;
    const labels={create:'Criação',update:'Alteração',delete:'Exclusão'};
    let after=null;const more=action('Carregar mais',async()=>{try{await next();}catch(e){msg.textContent=errorText(e);}});
    async function next(){more.disabled=true;
      try{const docs=await service.audit(after);if(page!==current)return;more.remove();
        for(const snap of docs){const e=snap.data(),user=people.find(u=>u.uid===e.actor);
          const context={accessUsers:'Usuário',accessScreens:'TV',paineis:'Operação'}[e.area]||e.area;
          const target=e.area==='accessUsers'?(people.find(u=>u.uid===e.target)?.login||e.target):e.target;
          body.append(row(node('time',e.at.toDate().toLocaleString('pt-BR')),node('strong',user?.login||e.actor),node('span',labels[e.kind]+' · '+context+' · '+target)));}
        if(!docs.length&&!after)body.append(node('p','Nenhuma alteração registrada.'));
        after=docs.at(-1);if(docs.length===40)body.append(more);
      }finally{more.disabled=false;}}
    await next();
  });
  nav.append(action('Usuários',users),action('TVs',screens),action('Auditoria',audit));dialog.showModal();await users();
}
