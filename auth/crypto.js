const utf8 = new TextEncoder();
const decode = new TextDecoder();
export const hex = bytes => [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
export const unhex = value => Uint8Array.from(value.match(/../g), pair=>parseInt(pair,16));
export const random = size => crypto.getRandomValues(new Uint8Array(size));
function base64(bytes) {
  const data = new Uint8Array(bytes), chunks = [];
  for (let i=0;i<data.length;i+=16384) chunks.push(String.fromCharCode(...data.subarray(i,i+16384)));
  return btoa(chunks.join(''));
}
function bytes(value) { return Uint8Array.from(atob(value), c=>c.charCodeAt(0)); }
export async function aes(raw) { return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']); }
export async function derive(password,salt,bits=256) {
  const material=await crypto.subtle.importKey('raw',utf8.encode(password),'PBKDF2',false,['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:600000},material,bits));
}
export async function seal(key,context,value) {
  const iv=random(12);
  return {iv, box:await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:utf8.encode(context)},key,utf8.encode(JSON.stringify(value)))};
}
export async function open(key,context,record) {
  return JSON.parse(decode.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv,additionalData:utf8.encode(context)},key,record.box)));
}
export async function ticket(login,password) {
  const bits=await derive(password,utf8.encode('transbordonews/login/v1/'+login),512);
  const id=hex(bits.slice(0,32)), key=await aes(bits.slice(32));bits.fill(0);
  return {id, async encode(email) { const s=await seal(key,id,email);return {login,iv:base64(s.iv),box:base64(s.box)}; },
    decode:s=>open(key,id,{iv:bytes(s.iv),box:bytes(s.box)})};
}
