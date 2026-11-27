const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const core=html.split('/* SYNC_CORE_START:')[1].split('/* SYNC_CORE_END */')[0];
const context=vm.createContext({});
vm.runInContext(core.slice(core.indexOf('*/')+2),context);
const copy=v=>JSON.parse(JSON.stringify(v));
const pcp=(rows,extras={})=>({plan:JSON.stringify({date:'2026-11-27',reference:'',responsible:'',rows,savedAt:10,revision:'a',cloudPending:false,...extras}),updatedAt:10,updatedBy:'pc-a'});
const cat=items=>({state:JSON.stringify({settings:{title:'Transbordo'},items}),updatedAt:10,updatedBy:'pc-a'});
const reconcile=(key,base,local,remote)=>copy(context.syncReconcile(key,base,local,remote));
const row=(id,boxes=1)=>({id,code:id,stations:[{boxes,workers:1,people:[]}]});
test('two computers editing different PCP rows retain both changes',()=>{
 const base=pcp([row('A'),row('B')]);
 const out=reconcile('pcp',base,pcp([row('A',10),row('B')]),pcp([row('A'),row('B',20)],{savedAt:9999999,revision:'b'}));
 assert.deepEqual(out.conflicts,[]);
 assert.deepEqual(JSON.parse(out.payload.plan).rows,[row('A',10),row('B',20)]);
});
test('same station changed differently requires review',()=>{
 const result=reconcile('pcp',pcp([row('A')]),pcp([row('A',10)]),pcp([row('A',20)]));
 assert.equal(result.conflicts.length,1);
});
test('stale pending flag with identical content clears without overwrite conflict',()=>{
 const a=pcp([row('A')]),b=pcp([row('A')],{savedAt:99,revision:'remote',cloudPending:true});
 assert.deepEqual(reconcile('pcp',null,a,b).conflicts,[]);
});
test('unknown legacy base with different data is never guessed',()=>{
 assert.equal(reconcile('pcp',null,pcp([row('A')]),pcp([row('B')])).conflicts.length,1);
});
test('catalog edits on different fields merge, including empty values',()=>{
 const a={id:'A',name:'Old',observation:'Old',updated:'before'};
 const result=reconcile('catalog',cat([a]),cat([{...a,name:'New',updated:'local'}]),cat([{...a,observation:'',updated:'remote'}]));
 assert.deepEqual(result.conflicts,[]);
 assert.deepEqual(JSON.parse(result.payload.state).items,[{...a,name:'New',observation:'',updated:'local'}]);
});
test('deletions are preserved alongside unrelated additions',()=>{
 const a={id:'A',value:1},b={id:'B',value:1},c={id:'C',value:1};
 const result=reconcile('catalog',cat([a,b]),cat([b]),cat([a,b,c]));
 assert.deepEqual(result.conflicts,[]);
 assert.deepEqual(JSON.parse(result.payload.state).items,[b,c]);
});
test('delete versus edit cannot silently resurrect or delete an item',()=>{
 const a={id:'A',value:1};
 assert.equal(reconcile('catalog',cat([a]),cat([]),cat([{...a,value:2}])).conflicts.length,1);
});
test('independent additions are retained and remote order is followed',()=>{
 const a={id:'A'},b={id:'B'},c={id:'C'},d={id:'D'};
 const result=reconcile('catalog',cat([a,b]),cat([a,b,c]),cat([b,a,d]));
 assert.deepEqual(result.conflicts,[]);
 assert.deepEqual(JSON.parse(result.payload.state).items,[b,a,d,c]);
});
test('incompatible simultaneous reorder requires review',()=>{
 const a={id:'A'},b={id:'B'},c={id:'C'};
 assert.equal(reconcile('catalog',cat([a,b,c]),cat([b,a,c]),cat([a,c,b])).conflicts.length,1);
});
test('edits made while upload is running rebase against the sent ancestor',()=>{
 const old=pcp([row('A'),row('B')]);
 const sent=pcp([row('A',2),row('B')]);
 const committed=reconcile('pcp',old,sent,pcp([row('A'),row('B',3)])).payload;
 const latest=pcp([row('A',4),row('B')]);
 const next=reconcile('pcp',sent,latest,committed);
 assert.deepEqual(next.conflicts,[]);
 assert.deepEqual(JSON.parse(next.payload.plan).rows,[row('A',4),row('B',3)]);
});
test('conflicting edit during upload still requires review',()=>{
 const sent=pcp([row('A',2),row('B')]);
 const committed=pcp([row('A',2),row('B',3)]);
 assert.equal(reconcile('pcp',sent,pcp([row('A',2),row('B',4)]),committed).conflicts.length,1);
});
function transport(){
 const timeouts=[],intervals=[],listeners=[],delivered=[],failures=[],reads=[];
 const env={Set,Date,JSON,navigator:{onLine:true},document:{hidden:false},
  setTimeout:fn=>(timeouts.push(fn),timeouts.length),clearTimeout(){},setInterval:fn=>(intervals.push(fn),intervals.length),clearInterval(){},
  onSnapshot:(ref,options,callback,error)=>(listeners.push({callback,error}),()=>{}),
  getDocFromServer:ref=>new Promise((resolve,reject)=>reads.push({resolve,reject})),getDocsFromServer:()=>Promise.reject(Error('unused'))};
 vm.createContext(env);
 const source=html.slice(html.indexOf('  const refreshers=new Set();'),html.indexOf('  let lastWake=0;'));
 vm.runInContext(source,env);
 const stop=env.listenShared({type:'document'},{includeMetadataChanges:true},snap=>delivered.push(snap.data()),e=>failures.push(e));
 return {env,timeouts,intervals,listeners,delivered,failures,reads,stop};
}
const snap=(value,fromCache=false,hasPendingWrites=false)=>({exists:()=>true,data:()=>({value}),metadata:{fromCache,hasPendingWrites}});
test('stalled listener gets a server read; cache is not confirmation',async()=>{
 const t=transport();t.listeners[0].callback(snap('cached',true));t.timeouts[0]();
 assert.equal(t.reads.length,1);t.reads[0].resolve(snap('server'));await new Promise(setImmediate);
 assert.deepEqual(t.delivered,[{value:'cached'},{value:'server'}]);t.stop();
});
test('late recovery read cannot roll back a newer live snapshot',async()=>{
 const t=transport();t.timeouts[0]();t.listeners[0].callback(snap('newer'));
 t.reads[0].resolve(snap('older'));await new Promise(setImmediate);
 assert.deepEqual(t.delivered,[{value:'newer'}]);t.stop();
});
test('identical confirmed snapshots are deduplicated',()=>{
 const t=transport();t.listeners[0].callback(snap('same'));t.listeners[0].callback(snap('same'));
 assert.equal(t.delivered.length,1);t.stop();
});
test('listener errors retry instead of leaving a disconnected screen',()=>{
 const t=transport();t.listeners[0].error({code:'unavailable'});t.timeouts.at(-1)();
 assert.equal(t.listeners.length,2);assert.equal(t.failures.length,1);t.stop();
});
test('unsubscribed listener ignores a delayed server read',async()=>{
 const t=transport();t.timeouts[0]();t.stop();t.reads[0].resolve(snap('late'));await new Promise(setImmediate);
 assert.equal(t.delivered.length,0);
});
// Run the actual PCP listener/write functions in independent JS contexts with isolated storage.
function integrationServer(initial){
 let data=copy(initial);const watchers=[];
 return {get data(){return copy(data);},read:()=>({exists:()=>true,data:()=>copy(data),metadata:{fromCache:false,hasPendingWrites:false}}),
  onSnapshot(ref,options,receive){watchers.push(receive);receive(this.read());},
  async runTransaction(db,action){await action({get:async()=>this.read(),set:(ref,next)=>{data=copy(next);watchers.forEach(receive=>receive(this.read()));}});}
 };
}
function pcpClient(server,id){
 const storage=new Map(),timers=[];let renders=0,reviews=0;
 const env={Map,Set,JSON,Date,console,navigator:{onLine:true},setTimeout:fn=>(timers.push(fn),timers.length),clearTimeout(){},
  lsGet:k=>storage.get(k)??null,lsSet:(k,v)=>storage.set(k,v),clone:copy,
  window:{addEventListener(){},__FB:{db:{},doc:()=>({}),onSnapshot:server.onSnapshot.bind(server),runTransaction:server.runTransaction.bind(server)}},
  pcpCloudRef:null,pcpCloudStarted:false,pcpCloudInitialDone:false,pcpCloudTimer:null,pcpCloudBusy:false,pcpDraftPending:false,pcpHydrated:true,
  PCP_CLIENT:id,pcpPlan:{rows:[]},pcpNormalize:copy,pcpRefreshTV(){},pcpLocalStatus(){},pcpPersistDraft(){},el:()=>({textContent:''})};
 vm.createContext(env);
 const start=html.indexOf('  /* SYNC_CORE_START:');const end=html.indexOf('  var catalogCloudBusy=',start);
 vm.runInContext(html.slice(start,end),env);
 const pcpStart=html.indexOf('  function pcpScheduleCloud(){'),pcpEnd=html.indexOf('\n/* Bitstream Vera',pcpStart);
 vm.runInContext(html.slice(pcpStart,pcpEnd),env);
 env.showSyncReview=(key)=>{reviews++;env.syncReviews.set(key,true);};
 env.pcpApplySharedPlan=plan=>{renders++;env.pcpPlan=copy(plan);env.pcpPlan.cloudPending=false;};
 env.pcpConnectCloud();
 return {env,timers,get renders(){return renders;},get reviews(){return reviews;},
  edit(rows,revision){env.pcpPlan={...env.pcpPlan,rows:copy(rows),revision,savedAt:Date.now(),cloudPending:true};},
  async publish(){env.pcpPublishPlan();await new Promise(setImmediate);}
 };
}
test('integration: PCP change arrives in another isolated client and TV without reload',async()=>{
 const server=integrationServer(pcp([row('A')])),a=pcpClient(server,'a'),b=pcpClient(server,'b');
 a.edit([row('A',7)],'edit-a');const rendered=a.renders;await a.publish();
 assert.equal(b.env.pcpPlan.rows[0].stations[0].boxes,7);
 assert.equal(b.env.sharedTvPlan.rows[0].stations[0].boxes,7);
 assert.equal(a.env.pcpPlan.cloudPending,false);
 assert.equal(a.renders,rendered,'an ordinary save must not rebuild the focused editor');
});
test('integration: concurrent edits on different rows synchronize both computers',async()=>{
 const server=integrationServer(pcp([row('A'),row('B')])),a=pcpClient(server,'a'),b=pcpClient(server,'b');
 a.edit([row('A',7),row('B')],'edit-a');b.edit([row('A'),row('B',9)],'edit-b');
 await a.publish();await b.publish();
 assert.deepEqual(copy(a.env.pcpPlan.rows),[row('A',7),row('B',9)]);
 assert.deepEqual(copy(b.env.pcpPlan.rows),[row('A',7),row('B',9)]);
 assert.equal(a.reviews+b.reviews,0);
 assert.equal(b.env.pcpPlan.cloudPending,false);
});
test('integration: conflicting edits preserve shared and local versions for review',async()=>{
 const server=integrationServer(pcp([row('A')])),a=pcpClient(server,'a'),b=pcpClient(server,'b');
 a.edit([row('A',7)],'edit-a');b.edit([row('A',9)],'edit-b');await a.publish();await b.publish();
 assert.equal(JSON.parse(server.data.plan).rows[0].stations[0].boxes,7);
 assert.equal(b.env.pcpPlan.rows[0].stations[0].boxes,9);
 assert.equal(b.env.sharedTvPlan.rows[0].stations[0].boxes,7,'TV follows confirmed shared data even when editor has a conflicting draft');
 assert.equal(b.reviews,1);assert.equal(b.env.pcpPlan.cloudPending,true);
});
