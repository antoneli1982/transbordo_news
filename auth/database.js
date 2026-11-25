// O documento operacional, o índice da alteração e a auditoria são uma única gravação.
export function auditedDatabase(F, db, actor) {
  const audited = new Set(['paineis', 'accessUsers', 'accessScreens']);
  function equal(a, b) {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (typeof a.isEqual === 'function') return a.isEqual(b);
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b,k) && equal(a[k], b[k]));
  }
  async function runTransaction(database, work) {
    return F.runTransaction(database, async native => {
      const reads = new Map(), writes = new Map();
      const api = {
        async get(ref) {
          if (!reads.has(ref.path)) reads.set(ref.path, await native.get(ref));
          return reads.get(ref.path);
        },
        set(ref, data, options) { writes.set(ref.path, { ref, data, options, op:'set' }); return api; },
        update(ref, data) { writes.set(ref.path, { ref, data, op:'update' }); return api; },
        delete(ref) { writes.set(ref.path, { ref, op:'delete' }); return api; }
      };
      const result = await work(api);
      const staged = [];
      for (const w of writes.values()) {
        const area = w.ref.parent.id;
        if (!audited.has(area)) { staged.push(w); continue; }
        const current = await api.get(w.ref), before = current.data();
        if (w.op === 'update' && !current.exists()) throw Error('O registro já foi removido.');
        const after = w.op === 'delete' ? undefined : w.op === 'update' || w.options?.merge ? {...before,...w.data} : w.data;
        if (equal(before, after)) continue;
        const kind = !current.exists() ? 'create' : w.op === 'delete' ? 'delete' : 'update';
        const log = F.doc(F.collection(db, 'accessAudit'));
        const fields=[...new Set([...Object.keys(before||{}),...Object.keys(after||{})])].filter(k=>!equal(before?.[k],after?.[k])).sort();
        const data={area,target:w.ref.id,actor:actor(),kind,fields,at:F.serverTimestamp()};
        if(area==='accessUsers'){data.before=before||null;data.after=after||null;}
        staged.push(w, {op:'set', ref:log, data},
          {op:'set', ref:F.doc(db,'accessChanges',area,'targets',w.ref.id), data:{event:log.id}});
      }
      for (const w of staged) {
        if (w.op === 'delete') native.delete(w.ref);
        else if (w.op === 'update') native.update(w.ref,w.data);
        else if (w.options) native.set(w.ref,w.data,w.options);
        else native.set(w.ref,w.data);
      }
      return result;
    });
  }
  return { ...F, db, runTransaction, setDoc:(ref,data,options)=>runTransaction(db,tx=>{tx.set(ref,data,options);}) };
}
