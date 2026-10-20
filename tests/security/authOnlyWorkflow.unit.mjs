import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {root,digest,codeBinding,proposedToml} from '../../scripts/authOnlyCore.mjs';
import {approveReview,bytesHash} from '../../scripts/authOnlyWorkflow.mjs';
import {fixtureSubnet} from '../../scripts/authOnlyEngine.mjs';
function review(){
  // This one-time Google workflow binds its original immutable pre-activation config.
  // The running config has legitimately changed since that workflow completed.
  const config=execFileSync('git',['show','HEAD:supabase/config.toml'],{cwd:root,windowsHide:true}),proposed=proposedToml(config);
  const x={baseline:{credential:{size:100,mtime:123},source:'bound-source'},inspect:{Id:'original'},original:{Env:['JWT=unchanged']},
    config:config.toString('base64'),proposedConfig:proposed.toString('base64')};
  x.plan={version:1,project:'school-queue-local',operation:'auth-only-google',createdAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),
    originalId:x.inspect.Id,originalHash:digest(x.original),sourceHash:digest(x.baseline),credentialMetadataHash:digest(x.baseline.credential),configHash:bytesHash(config),proposedConfigHash:bytesHash(proposed),code:codeBinding()};return x;
}
test('review approval accepts only the exact complete plan hash',()=>{const x=review();approveReview(x,digest(x.plan));assert.throws(()=>approveReview(x,'0'.repeat(64)),/APPROVAL/);});
test('project operation and version substitution are refused even with a recomputed hash',()=>{for(const [key,value]of[['project','other'],['operation','full-stack'],['version',2]]){const x=review();x.plan[key]=value;assert.throws(()=>approveReview(x,digest(x.plan)),/APPROVAL/);}});
test('source credential metadata original identity and configuration are independently bound',()=>{
  for(const change of [x=>x.baseline.source='changed',x=>x.baseline.credential.size++,x=>x.inspect.Id='different',x=>x.original.Env.push('EXTRA=bad'),x=>x.config=Buffer.from('changed').toString('base64'),x=>x.proposedConfig=Buffer.from('changed').toString('base64')]){
    const x=review();change(x);assert.throws(()=>approveReview(x,digest(x.plan)),/BINDING/);
  }
});
test('a code edit invalidates both activation and rollback approvals',()=>{const x=review();x.plan.code['scripts/authOnlyCore.mjs']='0'.repeat(64);assert.throws(()=>approveReview(x,digest(x.plan)),/CODE_CHANGED/);assert.throws(()=>approveReview(x,digest(x.plan),{expiry:false}),/CODE_CHANGED/);});
test('expired and future-created plans cannot activate; expiry does not prevent separately approved rollback',()=>{const x=review();x.plan.expiresAt=new Date(Date.now()-1).toISOString();assert.throws(()=>approveReview(x,digest(x.plan)),/EXPIRED/);approveReview(x,digest(x.plan),{expiry:false});x.plan.expiresAt=new Date(Date.now()+90000).toISOString();x.plan.createdAt=new Date(Date.now()+50000).toISOString();assert.throws(()=>approveReview(x,digest(x.plan)),/EXPIRED/);});
test('even a rehashed proposal cannot change nonce linking or unrelated TOML settings',()=>{const x=review();const b=Buffer.from(x.proposedConfig,'base64').toString().replace('skip_nonce_check = false','skip_nonce_check = true');x.proposedConfig=Buffer.from(b).toString('base64');x.plan.proposedConfigHash=bytesHash(Buffer.from(b));assert.throws(()=>approveReview(x,digest(x.plan)),/CONFIG_DELTA/);});
test('isolated fixture subnet rejects occupied addresses and wider overlapping networks without a retry',()=>{
  assert.equal(fixtureSubnet('1234abcd',[{IPAM:{Config:[{Subnet:'172.18.0.0/16'}]}}]),'10.253.18.0/24');
  for(const subnet of ['10.253.18.0/24','10.0.0.0/8','10.253.18.128/25'])assert.throws(()=>fixtureSubnet('1234abcd',[{IPAM:{Config:[{Subnet:subnet}]}}]),/CONFLICT/);
});
