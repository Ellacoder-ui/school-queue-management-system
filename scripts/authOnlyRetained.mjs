/** A plan-bound service adapter shared with rehearsal. Retained use needs approval.
 * No arbitrary Docker command, exec, deletion, or stack operation is provided. */
import http from 'node:http';
import {need,stable,toCreate,validateRetained,retainedId,network,names,exactDelta,environment,root} from './authOnlyCore.mjs';
import {approveReview} from './authOnlyWorkflow.mjs';

export class BoundAuthEngine {
  constructor(channel,restoreDelta=null){this.channel=channel;this.id=channel.id;this.names=channel.names;this.binding=null;this.pendingEndpoints=new Set();this.restoreDelta=restoreDelta;}
  async bind(slot,id,original,candidate){
    need(!this.binding && /^[a-z][a-z0-9-]{0,20}$/.test(slot),'AGO_ALREADY_BOUND');
    await this.channel.verifyNetwork();
    const item=await this.channel.inspect(id);
    need(item.Name==='/'+this.names.auth && stable(toCreate(item,this.names.network))===stable(original),'AGO_BIND_ORIGINAL');
    this.binding={slot,originalId:id,original,candidate,replacementId:null,image:item.Image,
      endpoint:structuredClone(item.NetworkSettings.Networks[this.names.network])};
  }
  async restoreBinding(slot,capture,replacementId){
    need(/^[a-z][a-z0-9-]{0,20}$/.test(slot) && /^[0-9a-f]{64}$/.test(replacementId),'AGO_RESUME_ID');
    const e=environment(capture.candidate.Env);
    if(this.restoreDelta)this.restoreDelta(capture.original,capture.candidate);
    else exactDelta(capture.original,capture.candidate,{ClientId:e.GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID,ClientSecret:e.GOTRUE_EXTERNAL_GOOGLE_SECRET});
    need(capture.plan.originalId===capture.inspect.Id && capture.plan.runId===this.id,'AGO_RESUME_CAPTURE');
    this.binding={slot,originalId:capture.inspect.Id,original:capture.original,candidate:capture.candidate,replacementId,image:capture.inspect.Image,
      endpoint:structuredClone(capture.inspect.NetworkSettings.Networks[this.names.network])};
    await this.inspect(capture.inspect.Id);await this.inspect(replacementId);
  }
  async inspect(id){
    const b=this.binding;
    if(b)need(id===b.originalId || id===b.replacementId,'AGO_BOUND_ID');
    const item=await this.channel.inspect(id);
    if(b){
      await this.channel.verifyNetwork();
      need(['/'+this.names.auth,'/'+this.names.prefix+b.slot+'-original','/'+this.names.prefix+b.slot+'-failed'].includes(item.Name),'AGO_BOUND_NAME');
      const copy=structuredClone(item), keys=Object.keys(copy.NetworkSettings.Networks);
      need(!keys.length || (keys.length===1 && keys[0]===this.names.network),'AGO_BOUND_NETWORK');
      need(item.Image===b.image,'AGO_BOUND_IMAGE');
      if(keys.length){
        const observedId=copy.NetworkSettings.Networks[this.names.network].NetworkID;
        // Docker assigns an endpoint on start, including after reconnecting a
        // stopped original. Permit only a successful create/connect by THIS
        // adapter, while independently verifying the actual named network.
        const pending=this.pendingEndpoints.has(id) && ['created','exited'].includes(item.State.Status) && !item.State.Running && observedId==='';
        need(observedId===b.endpoint.NetworkID || pending,'AGO_BOUND_NETWORK_ID');
        if(observedId===b.endpoint.NetworkID)this.pendingEndpoints.delete(id);
      }
      if(!keys.length)copy.NetworkSettings.Networks={[this.names.network]:b.endpoint};
      const expected=id===b.originalId?b.original:b.candidate;
      need(stable(toCreate(copy,this.names.network))===stable(expected),'AGO_BOUND_DEFINITION');
    }
    return item;
  }
  async create(name,body){
    const b=this.binding;
    need(b && !b.replacementId && name===this.names.auth && stable(body)===stable(b.candidate),'AGO_BOUND_CREATE');
    await this.channel.verifyNetwork();
    const id=await this.channel.create(name,body);b.replacementId=id;this.pendingEndpoints.add(id);await this.inspect(id);return id;
  }
  async action(id,operation,value){
    const b=this.binding;need(b,'AGO_NOT_BOUND');await this.inspect(id);
    need(['stop','start','rename','disconnect','connect'].includes(operation),'AGO_BOUND_ACTION');
    if(operation==='rename')need([this.names.auth,this.names.prefix+b.slot+'-original',this.names.prefix+b.slot+'-failed'].includes(value),'AGO_BOUND_RENAME');
    if(operation==='connect')need(id===b.originalId && stable(value)===stable(b.original.NetworkingConfig.EndpointsConfig[this.names.network].Aliases),'AGO_BOUND_ALIASES');
    const result=await this.channel.action(id,operation,value);
    if(operation==='connect')this.pendingEndpoints.add(id);
    return result;
  }
}

// The channel remains private to the approved retained factory. All mutations pass
// BoundAuthEngine's full-definition and exact-ID checks and the shared reconciler.
class RetainedChannel {
  constructor(item,id,validator=validateRetained){
    validator(item);names(id);this.id=id;
    this.imageTag=item.Config.Image;this.imageId=item.Image;
    this.names={auth:'supabase_auth_school-queue-local',prefix:`supabase_auth_school-queue-local-${id}-`,network};
    this.ids=new Set([item.Id]);this.networkId=item.NetworkSettings.Networks[network].NetworkID;
    need(/^[0-9a-f]{64}$/.test(this.networkId),'AGO_RETAINED_NETWORK_ID');
  }
  async #request(method,target,body){return new Promise((resolve,reject)=>{
    const data=body===undefined?null:Buffer.from(JSON.stringify(body));
    const r=http.request({socketPath:'//./pipe/dockerDesktopLinuxEngine',path:'/v1.56'+target,method,timeout:20000,
      headers:data?{'Content-Type':'application/json','Content-Length':data.length}:{}},response=>{
      let size=0;const chunks=[];response.on('data',b=>{size+=b.length;if(size>2097152)r.destroy();else chunks.push(b);});
      response.on('error',()=>reject(Error('AGO_PRIVATE_ENGINE_RESPONSE')));
      response.on('end',()=>{if(response.statusCode<200 || response.statusCode>=300)return reject(Error('AGO_PRIVATE_ENGINE_STATUS'));
        try{const text=Buffer.concat(chunks).toString('utf8');resolve(text?JSON.parse(text):null);}catch{reject(Error('AGO_PRIVATE_ENGINE_JSON'));}});
    });r.on('timeout',()=>r.destroy());r.on('error',()=>reject(Error('AGO_PRIVATE_ENGINE_REQUEST')));r.end(data);
  });}
  async inspect(id){need(this.ids.has(id),'AGO_PRIVATE_ID');const x=await this.#request('GET',`/containers/${id}/json`);need(x.Id===id,'AGO_PRIVATE_IDENTITY');return x;}
  async verifyNetwork(){
    const x=await this.#request('GET',`/networks/${this.networkId}`);
    const named=await this.#request('GET','/networks/'+encodeURIComponent(network));
    need(x.Id===this.networkId && named.Id===this.networkId && x.Name===network,'AGO_RETAINED_NETWORK_ID');
  }
  async create(name,body){need(name===this.names.auth,'AGO_PRIVATE_NAME');
    const image=await this.#request('GET','/images/'+encodeURIComponent(this.imageTag)+'/json');need(image.Id===this.imageId,'AGO_CACHED_AUTH_TAG_CHANGED');
    const x=await this.#request('POST','/containers/create?name='+encodeURIComponent(name),body);
    need(/^[0-9a-f]{64}$/.test(x.Id),'AGO_PRIVATE_CREATED_ID');this.ids.add(x.Id);return x.Id;}
  async action(id,operation,value){
    const item=await this.inspect(id);
    if(operation==='stop'){if(item.State.Running)await this.#request('POST',`/containers/${id}/stop?t=10`);}
    else if(operation==='start')await this.#request('POST',`/containers/${id}/start`);
    else if(operation==='rename')await this.#request('POST',`/containers/${id}/rename?name=${encodeURIComponent(value)}`);
    else if(operation==='disconnect')await this.#request('POST',`/networks/${this.networkId}/disconnect`,{Container:id,Force:false});
    else if(operation==='connect')await this.#request('POST',`/networks/${this.networkId}/connect`,{Container:id,EndpointConfig:{Aliases:value}});
    else throw Error('AGO_PRIVATE_ACTION');
  }
}
export async function retainedMfaEngine(item,id,authorization){
  const {approveMfaReview}=await import('./authMfaWorkflow.mjs');
  const {validateMfaRetained,exactMfaDelta}=await import('./authMfaPlan.mjs');
  need(authorization?.review && authorization.hash,'AMF_REVIEW_APPROVAL');
  approveMfaReview(authorization.review,authorization.hash,{expiry:!authorization.replacementId});
  need(!authorization.review.plan.synthetic && authorization.review.plan.runId===id &&
    stable(authorization.review.inspect)===stable(item),'AMF_RETAINED_AUTHORIZATION');
  need(process.platform==='win32' && root.toLowerCase()==='c:\\users\\hp\\school-queue-management-system' &&
    !['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'].some(k=>process.env[k]),'AMF_PLATFORM');
  const channel=new RetainedChannel(item,id,validateMfaRetained);
  if(authorization.replacementId){need(/^[0-9a-f]{64}$/.test(authorization.replacementId),'AMF_REPLACEMENT_ID');channel.ids.add(authorization.replacementId);}
  return new BoundAuthEngine(channel,exactMfaDelta);
}
export function retainedAuthEngine(item,id,authorization){
  need(authorization?.review && authorization.hash,'AGO_RETAINED_ACTIVATION_LOCKED');
  approveReview(authorization.review,authorization.hash,{expiry:!authorization.replacementId});
  need(!authorization.review.plan.synthetic && authorization.review.plan.runId===id &&
    stable(authorization.review.inspect)===stable(item),'AGO_RETAINED_AUTHORIZATION');
  need(process.platform==='win32' && root.toLowerCase()==='c:\\users\\hp\\school-queue-management-system' &&
    !['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'].some(k=>process.env[k]),'AGO_PLATFORM');
  need(item.Id===retainedId,'AGO_RETAINED_IDENTITY');
  const channel=new RetainedChannel(item,id);
  if(authorization.replacementId){need(/^[0-9a-f]{64}$/.test(authorization.replacementId),'AGO_RESUME_ID');channel.ids.add(authorization.replacementId);}
  return new BoundAuthEngine(channel);
}
