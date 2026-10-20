// Pure SQL preparation only: no connection, CLI or retained execution path.
import {createHash} from 'node:crypto'
export const reviewed007='b22d63d24c991b9ebf0d380d27a716d5ea72e418f5e62e177c96dded4481222c'
const need=(value,code)=>{if(!value)throw Error(code)}
const sha=x=>createHash('sha256').update(x).digest('hex')
const q=x=>"'"+String(x).replaceAll("'","''")+"'"
// Split at semicolons outside PostgreSQL strings, identifiers, dollar bodies and
// comments. Preserve offsets: the reviewed DDL body is never regex-rewritten.
export function statements(source){
 const out=[];let start=0,i=0,quote=null,dollar=null,depth=0,line=false
 for(;i<source.length;i++){
  const c=source[i],next=source[i+1]
  if(line){if(c==='\n')line=false;continue}
  if(depth){if(c==='/'&&next==='*'){depth++;i++}else if(c==='*'&&next==='/'){depth--;i++}continue}
  if(dollar){if(source.startsWith(dollar,i)){i+=dollar.length-1;dollar=null}continue}
  if(quote){if(c===quote){if(next===quote)i++;else quote=null}continue}
  if(c==='-'&&next==='-'){line=true;i++;continue}
  if(c==='/'&&next==='*'){depth=1;i++;continue}
  if(c==="'"||c==='"'){quote=c;continue}
  if(c==='$'){const tag=source.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];if(tag){dollar=tag;i+=tag.length-1;continue}}
  if(c===';'){out.push({start,end:i+1,text:source.slice(start,i+1)});start=i+1}
 }
 need(!quote&&!dollar&&!depth,'B007_UNTERMINATED_SQL')
 const tail=source.slice(start).replace(/--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//g,'').trim();need(!tail,'B007_INCOMPLETE_SQL')
 return out
}
const meaningful=s=>s.replace(/--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//g,'').trim()
export function migrationBody(bytes){
 need(Buffer.isBuffer(bytes)&&sha(bytes)===reviewed007,'B007_CHECKSUM')
 const source=bytes.toString('utf8'),list=statements(source)
 need(/^begin\s*;$/i.test(meaningful(list[0].text))&&/^commit\s*;$/i.test(meaningful(list.at(-1).text)),'B007_OUTER_TRANSACTION')
 const body=source.slice(list[0].end,list.at(-2).end)
 const top=statements(body).map(x=>meaningful(x.text))
 need(top.every(x=>!/^(begin|start\s+transaction|commit|end\s*;|rollback|abort|savepoint|release|prepare\s+transaction|set\s+transaction)\b/i.test(x)),'B007_INNER_TRANSACTION')
 return {body,sha256:sha(body),topLevelStatements:top.length}
}
export function bootstrap007(bytes,{target,email,binding,reference,cluster,days=1}){
 need(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(target)&&/^[0-9a-f]{64}$/.test(binding)&&/^\d{10,24}$/.test(cluster),'B007_BINDING')
 need(typeof email==='string'&&email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&typeof reference==='string'&&reference.length>=1&&reference.length<=200,'B007_INPUT')
 need(Number.isInteger(days)&&days>=1&&days<=30,'B007_EXPIRY')
 const {body}=migrationBody(bytes)
 return `BEGIN;
SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='3s'; SET LOCAL search_path='';
DO $preflight$ BEGIN
 IF current_database()<>'postgres' OR session_user<>'postgres' OR current_setting('role') NOT IN ('none','postgres')
 OR (SELECT system_identifier::text FROM pg_control_system())<>${q(cluster)}
 OR to_regclass('queue_private.staff_access_approvals') IS NOT NULL
 OR to_regprocedure('queue_private.require_staff_mfa(text)') IS NOT NULL
 THEN RAISE EXCEPTION 'Bootstrap source guard rejected' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM queue_private.settings WHERE id FOR UPDATE;
 PERFORM 1 FROM queue_private.accounts WHERE id=${q(target)}::uuid FOR UPDATE;
 PERFORM 1 FROM auth.users WHERE id=${q(target)}::uuid FOR UPDATE;
 PERFORM 1 FROM auth.identities WHERE user_id=${q(target)}::uuid FOR SHARE;
 PERFORM 1 FROM auth.mfa_factors WHERE user_id=${q(target)}::uuid FOR SHARE;
 IF NOT EXISTS(SELECT 1 FROM queue_private.accounts a JOIN auth.users u ON u.id=a.id
   WHERE a.id=${q(target)}::uuid AND a.role='ADMIN' AND a.enabled AND lower(u.email)=lower(${q(email)})
   AND u.email_confirmed_at IS NOT NULL AND u.is_anonymous IS NOT TRUE)
 OR NOT EXISTS(SELECT 1 FROM auth.mfa_factors WHERE user_id=${q(target)}::uuid AND factor_type='totp' AND status='verified')
 THEN RAISE EXCEPTION 'Bootstrap target guard rejected' USING ERRCODE='42501'; END IF;
END $preflight$;
-- Full reviewed 007 body, byte-preserved except its two outer transaction statements.
${body}
SELECT queue_private.review_staff_access(${q(target)}::uuid,${q(email)},${q(binding)},'ADMIN',${q(reference)},clock_timestamp()+interval '${days} days');
DO $acceptance$ BEGIN
 IF (SELECT count(*) FROM queue_private.staff_access_approvals)<>1 OR NOT EXISTS(
  SELECT 1 FROM queue_private.staff_access_approvals WHERE account_id=${q(target)}::uuid AND staff_role='ADMIN'
   AND identity_sha256=${q(binding)} AND approval_reference=${q(reference)} AND approved_by='postgres'
   AND revoked_at IS NULL AND expires_at>clock_timestamp() AND expires_at<=approved_at+interval '${days} days')
 THEN RAISE EXCEPTION 'Bootstrap approval acceptance rejected' USING ERRCODE='42501'; END IF;
 PERFORM queue_private.require_staff_approval(${q(target)}::uuid,'ADMIN');
END $acceptance$;
COMMIT;
`
}
