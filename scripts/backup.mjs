// Uso: node scripts/backup.mjs [--conferir arquivo | --extrair arquivo destino.json]
import {createHash,randomBytes,pbkdf2Sync,createCipheriv,createDecipheriv} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {config} from '../auth/project.mjs';
const project='transbordonews', owner='dAgYSGswrIOhVYxiB7VXAzqVOhk1';
const root='https://firestore.googleapis.com/v1/projects/'+project+'/databases/(default)/documents';
const hash=data=>createHash('sha256').update(data).digest('hex');
async function prompt(label,hidden=false){
  if(!process.stdin.isTTY)throw Error('Execute em um terminal interativo. A senha nunca deve ser passada na linha de comando.');
  process.stdout.write(label);
  const out=hidden?new Writable({write(_chunk,_encoding,cb){cb();}}):process.stdout;
  const rl=createInterface({input:process.stdin,output:out,terminal:true,historySize:0});
  try{return await rl.question('');}finally{rl.close();if(hidden)process.stdout.write('\n');}
}
async function post(url,data,token){
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});
  if(!r.ok){const error=await r.json().catch(()=>({}));throw Error(error.error?.message||'HTTP '+r.status);}
  return r.json();
}
export function encode(payload,password){
  const raw=Buffer.from(JSON.stringify(payload)),salt=randomBytes(16),iv=randomBytes(12);
  const header={version:1,project,salt:salt.toString('hex'),iv:iv.toString('hex'),iterations:600000,compression:'gzip',sha256:hash(raw),count:payload.documents.length};
  const cipher=createCipheriv('aes-256-gcm',pbkdf2Sync(password,salt,header.iterations,32,'sha256'),iv);
  const encrypted=Buffer.concat([cipher.update(gzipSync(raw)),cipher.final(),cipher.getAuthTag()]);
  return Buffer.concat([Buffer.from(JSON.stringify(header)+'\n'),encrypted]);
}
export function decode(bytes,password){
  const cut=bytes.indexOf(10);if(cut<1||cut>2048)throw Error('Formato de backup inválido.');
  const hdr=JSON.parse(bytes.subarray(0,cut));if(hdr.version!==1||hdr.project!==project||hdr.iterations!==600000)throw Error('Cabeçalho incompatível.');
  const cipher=createDecipheriv('aes-256-gcm',pbkdf2Sync(password,Buffer.from(hdr.salt,'hex'),hdr.iterations,32,'sha256'),Buffer.from(hdr.iv,'hex'));
  cipher.setAuthTag(bytes.subarray(-16));const data=gunzipSync(Buffer.concat([cipher.update(bytes.subarray(cut+1,-16)),cipher.final()]));
  if(hash(data)!==hdr.sha256)throw Error('O conteúdo diverge da cópia original.');
  const p=JSON.parse(data);if(p.documents.length!==hdr.count||p.project!==project)throw Error('A contagem de documentos diverge.');
  return p;
}
function inspect(docs){
  const byId=new Map(docs.map(d=>[d.name.split('/').at(-1),d]));
  if(byId.size!==docs.length||!byId.has('principal')||!byId.has('pcp'))throw Error('Faltam documentos do catálogo ou do PCP.');
  const catalog=JSON.parse(byId.get('principal').fields.state.stringValue);
  const plan=JSON.parse(byId.get('pcp').fields.plan.stringValue);
  if(!Array.isArray(catalog.items)||!Array.isArray(plan.rows))throw Error('O cadastro ou o PCP tem formato inesperado.');
  const refs=new Set(JSON.stringify(catalog).match(/fb:att_[A-Za-z0-9_-]+/g)||[]);
  for(const ref of refs){
    const id=ref.slice(3),first=byId.get(id);
    if(!first?.fields?.d?.stringValue)throw Error('Anexo sem documento inicial: '+id);
    const total=Number(first.fields.n?.integerValue||1);
    if(!Number.isSafeInteger(total)||total<1)throw Error('Quantidade inválida de partes: '+id);
    for(let i=1;i<total;i++)if(!byId.get(id+'_c'+i)?.fields?.d?.stringValue)throw Error('Anexo com parte ausente: '+id);
  }
  return {documentos:docs.length,embalagens:catalog.items.length,linhasPCP:plan.rows.length,
    execucoes:[...byId.keys()].filter(k=>k.startsWith('run_')).length,anexosReferenciados:refs.size};
}
async function main(){
  const [mode,input,output]=process.argv.slice(2);
  if(mode==='--conferir'||mode==='--extrair'){
    if(!input||(mode==='--extrair'&&!output))throw Error('Informe o arquivo e, para extrair, um destino JSON novo.');
    const data=decode(await fs.readFile(input),await prompt('Senha usada na cópia: ',true));
    console.log(inspect(data.documents));
    if(mode==='--extrair')await fs.writeFile(output,JSON.stringify(data),{flag:'wx',mode:0o600});
    return;
  }
  if(mode)throw Error('Opção de backup desconhecida.');
  const email=(await prompt('E-mail da primeira conta Sênior: ')).trim();
  const password=await prompt('Senha da conta (também protege este backup): ',true);
  const user=await post('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+config.apiKey,{email,password,returnSecureToken:true});
  if(user.localId!==owner)throw Error('Use a conta autorizada para a implantação.');
  const token=user.idToken;
  const {transaction}=await post(root+':beginTransaction',{options:{readOnly:{}}},token);
  let records;
  try{records=await post(root+':runQuery',{structuredQuery:{from:[{collectionId:'paineis'}]},transaction},token);}
  finally{await post(root+':rollback',{transaction},token).catch(()=>{});}
  if(!Array.isArray(records)||records.some(r=>r.error))throw Error('O Firestore não retornou uma leitura completa.');
  const documents=records.flatMap(r=>r.document?[r.document]:[]);
  const payload={version:1,project,collection:'paineis',readTime:records.at(-1).readTime,documents};
  const summary=inspect(documents);
  const folder=path.join(os.homedir(),'TransbordoNews-Backups');await fs.mkdir(folder,{recursive:true,mode:0o700});
  const dest=path.join(folder,'TransbordoNews_'+new Date().toISOString().replace(/[:.]/g,'-')+'.tnbackup');
  await fs.writeFile(dest,encode(payload,password),{flag:'wx',mode:0o600});
  const restored=decode(await fs.readFile(dest),password);inspect(restored.documents);
  console.log('Backup gravado e restauração conferida.',summary,'\n'+dest);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
