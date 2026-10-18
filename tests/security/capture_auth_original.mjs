/** Read-only retained capture bridge. Receives private inspect/config via stdin.
 * No Docker interface, provider credential read, or service operation exists. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {root,need,validateRetained,storage,stable,digest,codeBinding,proposedToml} from '../../scripts/authOnlyCore.mjs';
try{
  need(!process.stdin.isTTY && !process.stdout.isTTY,'AGO_CAPTURE_IPC');
  const chunks=[];let size=0;
  for await(const b of process.stdin){size+=b.length;need(size<=1048576,'AGO_CAPTURE_BOUND');chunks.push(b);}
  const r=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  need(/^[0-9a-f]{64}$/.test(r.sourceHash),'AGO_CAPTURE_SOURCE');
  const original=validateRetained(r.item);
  const proposed=proposedToml(Buffer.from(r.config_base64,'base64'));
  const payload={format:1,project:'school-queue-local',profile:'retained-capture',inspect:r.item,original,
    config_base64:r.config_base64,proposed_config_base64:proposed.toString('base64'),sourceHash:r.sourceHash,code:codeBinding(),activationAuthorized:false};
  await storage('seal',r.runId,'retained-original',payload,'retained-capture');
  const opened=JSON.parse((await storage('open',r.runId,'retained-original',undefined,'retained-capture')).payload);
  need(stable(payload)===stable(opened),'AGO_RETAINED_READBACK');
  const file=path.join(root,'.local-auth-only',r.runId,'retained-original/payload.dpapi');
  const cipher=fs.readFileSync(file);
  need(r.item.Config.Env.every(e=>{const v=e.slice(e.indexOf('=')+1);return v.length<24 || !cipher.includes(Buffer.from(v));}),'AGO_CAPTURE_PRIVACY');
  console.log(JSON.stringify({result:'PASS',profile:'retained-capture',runId:r.runId,definitionHash:digest(original),
    captureBytes:cipher.length,cipherSha256:crypto.createHash('sha256').update(cipher).digest('hex'),privateReadback:true,plaintextEnvAbsent:true,activationAuthorized:false}));
}catch{console.error('AGO_CAPTURE_REJECTED');process.exitCode=1;}
