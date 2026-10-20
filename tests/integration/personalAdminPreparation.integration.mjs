// Personal-target approval rehearsal ONLY in a fresh guarded PostgreSQL/PostgREST fixture.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {QueueFixture,need,digest,preservationQuery} from './queueFixture.mjs';
const run=randomUUID().slice(0,8),fixture=new QueueFixture(run),checks=[];
const file=`tests/integration/results/personal_admin_preparation_${run}.json`;
const report={run,retained_writes:false,real_mfa_enrollment:false,synthetic_accounts_only:true,checks};
const personalEmail='ellasharmaineabeso2004@gmail.com',schoolEmail='eabeso63122@liceo.edu.ph';
const q=x=>"'"+String(x).replaceAll("'","''")+"'";
const id=name=>fixture.users[name];
async function test(name,body){await body();checks.push({name,result:'PASS'});console.log('PASS: '+name);}
async function deniedSql(sql,code='42501'){
 await fixture.sql(`do $negative$ begin begin ${sql.replace(/;+\s*$/,'')}; raise exception 'Unexpected acceptance'; exception when sqlstate '${code}' then null; end; end $negative$;`);
}
async function rpc(actor,aal,name,args={}){
 const r=await fixture.request('/rpc/'+name,{name:actor,body:args,token:fixture.token(actor,'authenticated',aal)});
 return{status:r.status,body:await r.json()};
}
const denied=r=>need(r.status>=400 && r.body.code==='42501','PGA_EXPECTED_DENIAL');
let before,source,inventory;
try{
 mkdirSync('tests/integration/results',{recursive:true});
 before=await fixture.retained();source=fixture.retainedRead(preservationQuery).trim();inventory=await fixture.inventory();
 await fixture.start();report.existing_sql_methods=fixture.policyTests;
 await fixture.sql(`create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
  create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users,provider text,provider_id text,identity_data jsonb);
  create table auth.mfa_factors(user_id uuid primary key references auth.users,status text);
  update auth.users set email=${q(personalEmail)} where id=${q(id('other'))};
  update auth.users set email=${q(schoolEmail)} where id=${q(id('student'))};
  insert into auth.identities(user_id,provider,provider_id,identity_data) select id,'google','fixture-sub-'||id,jsonb_build_object('sub','fixture-sub-'||id,'email',email,'email_verified',true) from auth.users;
  insert into auth.mfa_factors values(${q(id('admin'))},'verified');`);
 const proposal=readFileSync('supabase/20261019000700_staff_security.PROPOSED.sql');
 report.proposal_sha256=digest(proposal);
 need(report.proposal_sha256==='b22d63d24c991b9ebf0d380d27a716d5ea72e418f5e62e177c96dded4481222c','PGA_PROPOSAL_CHANGED');
 const originalRoles=(await fixture.sql('select json_object_agg(id,role) from queue_private.accounts;')).trim();
 await fixture.sql(proposal.toString('utf8'));
 await test('unchanged generic 007 seeds no approval and promotes neither account',async()=>{
  need((await fixture.sql('select json_object_agg(id,role) from queue_private.accounts;')).trim()===originalRoles,'PGA_ROLE_CHANGE');
  need((await fixture.sql('select count(*) from queue_private.staff_access_approvals;')).trim()==='0','PGA_SEEDED_APPROVAL');
 });
 const personalBinding=(await fixture.sql(`select queue_private.google_staff_binding(${q(id('other'))});`)).trim();
 const schoolBinding=(await fixture.sql(`select queue_private.google_staff_binding(${q(id('student'))});`)).trim();
 need(personalBinding!==schoolBinding && id('other')!==id('student'),'PGA_IDENTITY_COLLISION');
 const ref=run+'-personal-admin';
 await test('school UUID/hash and email-only substitutions cannot approve the personal identity',async()=>{
  await deniedSql(`perform queue_private.review_staff_access(${q(id('other'))},${q(personalEmail)},${q(schoolBinding)},'ADMIN','wrong-binding',clock_timestamp()+interval '1 day')`);
  await deniedSql(`perform queue_private.review_staff_access(${q(id('student'))},${q(personalEmail)},${q(schoolBinding)},'ADMIN','wrong-user',clock_timestamp()+interval '1 day')`,'22023');
  await deniedSql(`perform queue_private.review_staff_access(${q(randomUUID())},${q(personalEmail)},${q(personalBinding)},'ADMIN','missing-user',clock_timestamp()+interval '1 day')`,'22023');
 });
 await test('personal and school STUDENT cannot self-promote even with signed AAL2',async()=>{
  for(const actor of ['other','student'])for(const aal of ['aal1','aal2']){
   denied(await rpc(actor,aal,'set_account',{p_user:id(actor),p_role:'ADMIN',p_enabled:true,p_request_key:randomUUID()}));
   denied(await rpc(actor,aal,'admin_configuration'));
  }
 });
 await fixture.sql(`select queue_private.review_staff_access(${q(id('other'))},${q(personalEmail)},${q(personalBinding)},'ADMIN',${q(ref)},clock_timestamp()+interval '1 day');`);
 const promote=`perform queue_private.promote_approved_admin(${q(id('other'))},${q(personalEmail)},'STUDENT',${q(personalBinding)},${q(ref)})`;
 await test('exact personal approval alone cannot replace verified factor enrollment',async()=>{await deniedSql(promote);});
 await test('operator promotion helpers and approval storage remain inaccessible to browser roles',async()=>{
  const x=JSON.parse((await fixture.sql(`select json_build_object('execute',has_function_privilege('authenticated','queue_private.promote_approved_admin(uuid,text,text,text,text)','EXECUTE'),'insert',has_table_privilege('authenticated','queue_private.staff_access_approvals','INSERT'));`)).trim());
  need(!x.execute&&!x.insert,'PGA_OPERATOR_EXPOSURE');
 });
 await fixture.sql(`insert into auth.mfa_factors values(${q(id('other'))},'verified');`);
 await test('approved operator changes only the exact synthetic personal account; school stays STUDENT',async()=>{
  const original=JSON.parse((await fixture.sql('select json_object_agg(id,to_jsonb(a)) from queue_private.accounts a;')).trim());
  const assignments=(await fixture.sql('select coalesce(jsonb_agg(to_jsonb(a) order by account_id,counter_id),\'[]\') from queue_private.staff_counter_assignments a;')).trim();
  await fixture.sql(`do $promote$ begin ${promote}; end $promote$;`);
  const after=JSON.parse((await fixture.sql('select json_object_agg(id,to_jsonb(a)) from queue_private.accounts a;')).trim());
  need(after[id('other')].role==='ADMIN' && after[id('student')].role==='STUDENT','PGA_WRONG_PROMOTION');
  for(const key of Object.keys(original))if(key!==id('other'))need(JSON.stringify(original[key])===JSON.stringify(after[key]),'PGA_UNRELATED_ACCOUNT_CHANGED');
  need(assignments===(await fixture.sql('select coalesce(jsonb_agg(to_jsonb(a) order by account_id,counter_id),\'[]\') from queue_private.staff_counter_assignments a;')).trim(),'PGA_ASSIGNMENTS_CHANGED');
 });
 await test('promoted role still requires signed AAL2 for backend ADMIN access',async()=>{
  denied(await rpc('other','aal1','admin_configuration'));
  const r=await rpc('other','aal2','admin_configuration');need(r.status===200&&r.body.counters.length===5,'PGA_AAL2_ACCESS');
  denied(await rpc('student','aal2','admin_configuration'));
 });
 await test('existing ADMIN approval and MFA protections remain enforced',async()=>{
  denied(await rpc('admin','aal2','admin_configuration'));
  const h=(await fixture.sql(`select queue_private.google_staff_binding(${q(id('admin'))});`)).trim();
  await fixture.sql(`select queue_private.review_staff_access(${q(id('admin'))},'admin@example.invalid',${q(h)},'ADMIN',${q(run+'-existing-admin')},clock_timestamp()+interval '1 day');`);
  denied(await rpc('admin','aal1','admin_configuration'));
  need((await rpc('admin','aal2','admin_configuration')).status===200,'PGA_EXISTING_ADMIN_FAILED');
 });
 await test('repeat promotion and revoked approval fail closed',async()=>{
  await deniedSql(promote);
  await fixture.sql(`select queue_private.revoke_staff_review(${q(ref)});`);
  denied(await rpc('other','aal2','admin_configuration'));
 });
 report.result='PASS';
}catch(error){report.result='FAIL';report.failure=/^PGA_[A-Z_]+$/.test(error.message||'')?error.message:'PGA_FIXTURE_TEST_STOPPED';process.exitCode=1;}
finally{
 try{await fixture.stop();report.owned_containers_stopped=true;}catch{report.result='FAIL';report.shutdown_failed=true;process.exitCode=1;}
 try{
  if(source)need(source===fixture.retainedRead(preservationQuery).trim(),'PGA_RETAINED_DATA_CHANGED');
  if(before){const after=await fixture.retained();need(after.every((row,i)=>row.name.includes('vector')?row.id===before[i].id&&row.definition===before[i].definition:JSON.stringify(row)===JSON.stringify(before[i])),'PGA_RETAINED_SERVICE_CHANGED');}
  if(inventory){const after=await fixture.inventory();need(JSON.stringify(after.volumes)===JSON.stringify(inventory.volumes)&&JSON.stringify(after.containers)===JSON.stringify([...inventory.containers,...fixture.owned].sort())&&JSON.stringify(after.networks)===JSON.stringify([...inventory.networks,...(fixture.networkId?[fixture.networkId]:[])].sort()),'PGA_RESOURCE_DELTA');}
  report.retained_preservation=true;
 }catch{report.result='FAIL';report.retained_preservation=false;process.exitCode=1;}
 report.containers=[...fixture.owned];report.network=fixture.networkId?fixture.network:null;report.passed=checks.length;
 writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({result:report.result,passed:checks.length,evidence:file}));
}
