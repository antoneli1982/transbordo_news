// Executar localmente com Node 22 e o SDK web 10.13.0 instalado na raiz.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import * as apps from 'firebase/app';
import * as A from 'firebase/auth';
import * as F from 'firebase/firestore';
import {config} from '../auth/project.mjs';
import {accounts,OWNER} from '../auth/accounts.js';
import {auditedDatabase} from '../auth/database.js';
import {decode,inspect,prompt} from './backup.mjs';

const original='e71b30919663a9c44f645f04afc3f559306c6a2a';
export function historicalWorkforce(html) {
  const match=/^\s*var PEOPLE_SEED=(\[.*\]);\s*$/m.exec(html);
  if(!match)throw Error('A lista de origem não foi encontrada.');
  const rows=JSON.parse(match[1]);
  if(!Array.isArray(rows)||!rows.length||rows.some(r=>typeof r.name!=='string'||!r.name.trim()||typeof r.chapa!=='string'))throw Error('O formato da lista de origem não confere.');
  return rows;
}
export async function seedMissing(logged,ref,rows,uid) {
  return logged.runTransaction(logged.db,async tx=>{
    if((await tx.get(ref)).exists())return false;
    tx.set(ref,{rows:JSON.stringify(rows),updatedAt:Date.now(),updatedBy:uid});return true;
  });
}
async function main(){
  const [file,option,...rest]=process.argv.slice(2);
  if(!file||rest.length||(option&&option!=='--cadastrar-base-original'))throw Error('Informe o arquivo .tnbackup e, se necessário, --cadastrar-base-original.');
  const backup=decode(await fs.readFile(file),await prompt('Senha do backup: ',true));
  console.log('Backup do Transbordo conferido.',inspect(backup.documents));
  const rows=option?historicalWorkforce(execFileSync('git',['show',original+':index.html'],{encoding:'utf8',maxBuffer:16*1024*1024})):null;
  const app=apps.initializeApp(config),auth=A.initializeAuth(app,{persistence:A.inMemoryPersistence}),db=F.getFirestore(app);
  try{
    // Um documento inexistente verifica a permissão de consulta sem expor dados.
    try{await F.getDocFromServer(F.doc(db,'paineis','_verificacao_de_acesso'));throw Error('O Firestore ainda permite consulta pública. Confira as regras antes de ativar a conta.');}
    catch(error){if(error.code!=='permission-denied')throw error;}
    const email=await prompt('E-mail da primeira conta Sênior: '),password=await prompt('Senha da primeira conta Sênior: ',true);
    const logged=auditedDatabase(F,db,()=>auth.currentUser?.uid),service=accounts({apps,A,F,config,auth,db,logged});
    const profile=await service.signIn(email,password);
    if(profile.uid!==OWNER||profile.role!=='senior')throw Error('Use a conta principal do projeto.');
    await A.signOut(auth);await service.signIn('IvAn.AnToNeLi',password);
    if(rows){
      const ref=F.doc(db,'paineis','workforce');
      const created=await seedMissing(logged,ref,rows,profile.uid);
      const saved=JSON.parse((await F.getDocFromServer(ref)).data().rows);
      if(created&&JSON.stringify(saved)!==JSON.stringify(rows))throw Error('A leitura após a gravação diverge da base original.');
      console.log(created?'Base histórica cadastrada.':'Cadastro existente preservado.',saved.length,'colaboradores.');
    }
    console.log('Conta Sênior e entrada por login com maiúsculas e minúsculas confirmadas.');
  }finally{await A.signOut(auth).catch(()=>{});await F.terminate(db);await apps.deleteApp(app);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
