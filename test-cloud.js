/* Pruebas sin acceso a Supabase real: auth compartida, restricciones del cliente y estructura. */
const fs=require('fs'),vm=require('vm'),assert=require('assert');
let membership={user_id:'11111111-1111-4111-8111-111111111111',rol:'PDV',pdvs:['UCA-02'],activo:true};
let currentUser={id:membership.user_id,email:'pdv@example.com'};
let signedIn=true, lastEmail='';
const client={
 auth:{getSession:async()=>({data:{session:signedIn?{access_token:'token'}:null}}),
  getUser:async()=>({data:{user:signedIn?currentUser:null}}),
  onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
  signInWithPassword:async({email})=>{lastEmail=email;signedIn=true;return {data:{user:currentUser}};},
  signOut:async()=>{signedIn=false;return {error:null}}},
 from(name){return {
  select(){return this},eq(){return this},maybeSingle:async()=>({data:name==='facturacion_usuarios'?membership:null,error:null}),
  upsert:async()=>({data:{},error:null})
 }}
};
const fakeWindow={V16_CONFIG:{url:'https://example.supabase.co',key:'anon-key',loginDomain:'example.com'},
  supabase:{createClient:(url,key,opts)=>{assert.strictEqual(opts.auth.storageKey,'v16-replica-auth');return client}},
  dispatchEvent:()=>{}};
vm.runInNewContext(fs.readFileSync(__dirname+'/facturacion-cloud.js','utf8'),{window:fakeWindow,CustomEvent:class {}}, {filename:'facturacion-cloud.js'});
const cloud=fakeWindow.FacturacionCloud;
(async()=>{
 let p=await cloud.restore();assert.equal(p.rol,'PDV');assert.deepEqual([...p.pdvs],['UCA-02']);assert.equal(cloud.admin(),false);
 await assert.rejects(cloud.saveRules('2026-11',{rate:10,step:24,maxExcess:120},10,'2026-11'),/Solo el administrador/);
 await cloud.logout();assert.equal(cloud.profile(),null);
 membership={...membership,rol:'ADMINISTRADOR',pdvs:[]};currentUser={...currentUser};
 p=await cloud.login('ADMIN', 'not-real');assert.equal(p.rol,'ADMINISTRADOR');assert.equal(lastEmail,'admin@example.com');assert.equal(cloud.admin(),true);
 await cloud.saveRules('2026-11',{rate:10,step:24,maxExcess:120},10,'2026-11');
 await cloud.logout();membership=null;await assert.rejects(cloud.login('NO-EXISTE','not-real'),/sin permiso activo/);
 console.log('Pruebas cloud mock: 7 verificaciones OK (sesión compartida, alcance, bloqueo rol, login, admin, guardado autorizado, acceso inexistente).');
})().catch(err=>{console.error(err);process.exit(1)});
