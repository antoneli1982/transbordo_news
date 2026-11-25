const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWrittenWithAuthContext } = require("firebase-functions/v2/firestore");
initializeApp();
const db = getFirestore(), auth = getAuth();
const users = db.collection("accessUsers"), logins = db.collection("accessLogins"), audit = db.collection("accessAudit");
const roles = new Set(["senior", "editor", "viewer"]);
const aliasOf = value => String(value || "").trim().toLowerCase();
function fail(code, message) { throw new HttpsError(code, message); }
async function requireSenior(request) {
  if (!request.auth) fail("unauthenticated", "Entre no sistema.");
  const actor = await users.doc(request.auth.uid).get();
  if (actor.data()?.active !== true || actor.data()?.role !== "senior") fail("permission-denied", "Acesso restrito ao Sênior.");
  return request.auth.uid;
}
exports.createAccessUser = onCall(async request => {
  const actor = await requireSenior(request);
  const { email, password, role } = request.data || {};
  const login = aliasOf(request.data?.login);
  if (typeof email !== "string" || email.length > 254 || !email.includes("@") ||
      typeof password !== "string" || password.length < 8 || password.length > 128 ||
      !/^[a-z0-9._-]{3,40}$/.test(login) || !roles.has(role))
    fail("invalid-argument", "Revise os dados e use uma senha de pelo menos 8 caracteres.");
  let account;
  try { account = await auth.createUser({email:email.trim(), password, displayName:login, disabled:true}); }
  catch (_) { fail("already-exists", "Não foi possível cadastrar a conta. Confira o e-mail."); }
  try {
    await db.runTransaction(async tx => {
      const [actorDoc, existing] = await Promise.all([tx.get(users.doc(actor)), tx.get(logins.doc(login))]);
      if (actorDoc.data()?.role !== "senior" || actorDoc.data()?.active !== true) fail("permission-denied", "Acesso revogado.");
      if (existing.exists) fail("already-exists", "Login já cadastrado.");
      tx.create(logins.doc(login), {uid:account.uid});
      tx.create(users.doc(account.uid), {email:account.email, login, role, active:true, createdAt:FieldValue.serverTimestamp()});
      tx.create(audit.doc(), {actor, action:"user.create", target:account.uid, role, at:FieldValue.serverTimestamp()});
    });
  } catch (e) {
    await auth.deleteUser(account.uid).catch(()=>{});
    throw e;
  }
  try { await auth.updateUser(account.uid,{disabled:false}); }
  catch (_) { await users.doc(account.uid).update({active:false}); fail("internal","Conta criada desativada. Solicite a reativação."); }
  return {uid:account.uid};
});
exports.setAccessUser = onCall(async request => {
  const actor = await requireSenior(request);
  const { uid, role, active } = request.data || {};
  if (typeof uid !== "string" || !uid || uid.includes("/") || !roles.has(role) || typeof active !== "boolean") fail("invalid-argument","Dados inválidos.");
  if (uid === actor) fail("failed-precondition","Não é permitido alterar o próprio perfil administrativo.");
  await db.runTransaction(async tx => {
    const [actorDoc,target] = await Promise.all([tx.get(users.doc(actor)),tx.get(users.doc(uid))]);
    if (actorDoc.data()?.active !== true || actorDoc.data()?.role !== "senior") fail("permission-denied","Acesso revogado.");
    if (!target.exists) fail("not-found","Usuário não localizado.");
    tx.update(target.ref,{role,active,updatedAt:FieldValue.serverTimestamp()});
    tx.create(audit.doc(),{actor,action:"user.update",target:uid,before:{role:target.data().role,active:target.data().active},after:{role,active},at:FieldValue.serverTimestamp()});
  });
  await auth.updateUser(uid,{disabled:!active});
  if (!active) await auth.revokeRefreshTokens(uid);
  return {uid};
});
exports.auditPanelWrite = onDocumentWrittenWithAuthContext("paineis/{id}", async event => {
  const before = event.data?.before, after = event.data?.after;
  const previous = before?.data() || {}, next = after?.data() || {};
  const keys = [...new Set([...Object.keys(previous), ...Object.keys(next)])];
  const changed = keys.filter(key => JSON.stringify(previous[key]) !== JSON.stringify(next[key]));
  await audit.doc(event.id).set({
    actor:event.authId || null, actorType:event.authType || null,
    action:!before?.exists ? "create" : !after?.exists ? "delete" : "update",
    target:event.params.id, changedFields:changed, at:event.time || FieldValue.serverTimestamp()
  });
});
