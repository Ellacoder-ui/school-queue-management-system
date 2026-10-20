import http from 'node:http';
import {root,need,names,label,authImage,pgImage,environment} from './authOnlyCore.mjs';
import {nodeImage} from './vectorRepairCore.mjs';
export {nodeImage};
const authTag='public.ecr.aws/supabase/gotrue:v2.197.0';
export function fixtureSubnet(runId,networks){
  names(runId);const subnet=`10.253.${parseInt(runId.slice(0,2),16)}.0/24`;
  const range=value=>{const [ip,bits]=value.split('/'),parts=ip.split('.').map(Number),prefix=Number(bits);
    need(parts.length===4 && parts.every(x=>Number.isInteger(x)&&x>=0&&x<=255) && /^\d+$/.test(bits||'') && prefix>=0 && prefix<=32,'AGO_SUBNET_FORMAT');
    const n=parts.reduce((a,x)=>a*256+x,0),size=2**(32-prefix),start=Math.floor(n/size)*size;return [start,start+size-1];};
  const wanted=range(subnet);
  for(const x of networks)for(const c of x.IPAM?.Config||[]){if(!c.Subnet || c.Subnet.includes(':'))continue;
    const r=range(c.Subnet);need(wanted[1]<r[0] || r[1]<wanted[0],'AGO_FIXTURE_SUBNET_CONFLICT');}
  return subnet;
}
export class AuthOnlyEngine {
  constructor(id) {
    this.id = id; this.names = names(id); this.containers = new Set(); this.networkId = null;
    need(process.platform === 'win32' && root.toLowerCase() === 'c:\\users\\hp\\school-queue-management-system', 'AGO_PLATFORM');
    need(!['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'].some(k => process.env[k]), 'AGO_DOCKER_OVERRIDE');
  }
  async #request(method, target, body, raw = false) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const request = http.request({ socketPath: '//./pipe/dockerDesktopLinuxEngine', path: '/v1.56' + target, method,
        timeout: 20000, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} }, response => {
        let size = 0; const chunks = [];
        response.on('data', b => { size += b.length; if (size > 2097152) request.destroy(Error('AGO_ENGINE_BOUND')); else chunks.push(b); });
        response.on('end', () => {
          if (response.statusCode < 200 || response.statusCode >= 300) { reject(Error('AGO_ENGINE_STATUS')); return; }
          if (raw) { resolve(Buffer.concat(chunks)); return; }
          const text = Buffer.concat(chunks).toString('utf8');
          try { resolve(text ? JSON.parse(text) : null); } catch { reject(Error('AGO_ENGINE_JSON')); }
        });
      });
      request.on('timeout', () => request.destroy(Error('AGO_ENGINE_TIMEOUT')));
      request.on('error', () => reject(Error('AGO_ENGINE_REQUEST')));
      request.end(data);
    });
  }
  async inspect(id) {
    need(this.containers.has(id), 'AGO_NOT_OWNED');
    const x = await this.#request('GET', `/containers/${id}/json`);
    need(x.Id === id && x.Name.startsWith('/' + this.names.prefix) && x.Config.Labels[label] === this.id, 'AGO_OWNED_IDENTITY');
    need(!x.HostConfig.Privileged && !Object.keys(x.HostConfig.PortBindings || {}).length && !x.HostConfig.VolumesFrom?.length, 'AGO_OWNED_PRIVILEGES');
    need([authImage, pgImage, nodeImage].includes(x.Image), 'AGO_OWNED_IMAGE');
    need(Object.keys(x.NetworkSettings.Networks).every(k => [this.names.network, 'none'].includes(k)), 'AGO_OWNED_NETWORK');
    need(x.Mounts.every(m => m.Type === 'tmpfs' && ['/tmp','/var/run/postgresql'].includes(m.Destination)), 'AGO_OWNED_MOUNT');
    return x;
  }
  guardBody(name, body) {
    need(name.startsWith(this.names.prefix) && /^[a-z0-9-]+$/.test(name) && body.Labels?.[label] === this.id, 'AGO_CREATE_IDENTITY');
    need([authImage, authTag, pgImage, nodeImage].includes(body.Image), 'AGO_CREATE_IMAGE');
    need(Object.keys(body.Labels).length===1 && !Object.hasOwn(body.Labels,'com.supabase.cli.project') && !Object.hasOwn(body.Labels,'com.docker.compose.project'),'AGO_PROJECT_LABELS');
    if([authImage,authTag].includes(body.Image)){const env=environment(body.Env);need(/^postgres:\/\/postgres:[0-9a-f]{48}@db:5432\/postgres\?sslmode=disable&search_path=auth$/.test(env.GOTRUE_DB_DATABASE_URL),'AGO_FIXTURE_DATABASE_ONLY');}
    const h = body.HostConfig;
    need(h && !h.Privileged && !h.AutoRemove && !h.Binds?.length && !h.VolumesFrom?.length && !Object.keys(h.PortBindings || {}).length && !h.PublishAllPorts, 'AGO_CREATE_PRIVILEGES');
    need(!h.CapAdd?.length && !h.Devices?.length && !h.DeviceRequests?.length && !h.ExtraHosts?.length && !h.Links?.length,
      'AGO_CREATE_HOST_ACCESS');
    need(h.ReadonlyRootfs && h.CapDrop?.includes('ALL') && h.SecurityOpt?.includes('no-new-privileges'), 'AGO_CREATE_HARDENING');
    need(['none', this.names.network].includes(h.NetworkMode), 'AGO_CREATE_NETWORK');
    need(Object.keys(body.NetworkingConfig?.EndpointsConfig || {}).every(k => k === this.names.network), 'AGO_CREATE_ENDPOINT');
    need(!body.Volumes && !h.ContainerIDFile && !['host', 'container'].some(v => [h.PidMode, h.IpcMode, h.UTSMode].some(mode => mode?.startsWith(v))), 'AGO_CREATE_NAMESPACE');
    need(!h.LogConfig || ['json-file', 'local', 'none'].includes(h.LogConfig.Type), 'AGO_CREATE_LOG_DRIVER');
    need(!h.Mounts?.length && !body.Volumes && Object.keys(h.Tmpfs || {}).every(p => ['/tmp','/var/run/postgresql'].includes(p)), 'AGO_CREATE_MOUNT');
  }
  async create(name, body) {
    this.guardBody(name, body);
    if(body.Image===authTag){const image=await this.#request('GET','/images/'+encodeURIComponent(authTag)+'/json');need(image.Id===authImage,'AGO_CACHED_AUTH_TAG_CHANGED');}
    const x = await this.#request('POST', '/containers/create?name=' + encodeURIComponent(name), body);
    need(/^[0-9a-f]{64}$/.test(x.Id), 'AGO_CREATED_ID'); this.containers.add(x.Id);
    await this.inspect(x.Id); return x.Id;
  }
  async action(id, operation, value) {
    const item = await this.inspect(id);
    if (operation === 'stop') { if (item.State.Running) await this.#request('POST', `/containers/${id}/stop?t=5`); }
    else if (operation === 'start') await this.#request('POST', `/containers/${id}/start`);
    else if (operation === 'rename') { need(value.startsWith(this.names.prefix) && /^[a-z0-9-]+$/.test(value), 'AGO_RENAME'); await this.#request('POST', `/containers/${id}/rename?name=${encodeURIComponent(value)}`); }
    else if (operation === 'disconnect') { need(this.networkId && item.NetworkSettings.Networks[this.names.network], 'AGO_DISCONNECT'); await this.#request('POST', `/networks/${this.networkId}/disconnect`, { Container: id, Force: false }); }
    else if (operation === 'connect') { need(this.networkId && !Object.keys(item.NetworkSettings.Networks).length, 'AGO_CONNECT'); await this.#request('POST', `/networks/${this.networkId}/connect`, { Container: id, EndpointConfig: { Aliases: value } }); }
    else throw Error('AGO_ACTION_DENIED');
  }
  async infrastructure() {
    // Uniqueness is Engine-enforced for names; never reuse an existing resource.
    const old = await this.#request('GET', '/networks?filters=' + encodeURIComponent(JSON.stringify({ name: [this.names.network] })));
    need(!old.some(x => x.Name === this.names.network), 'AGO_RESOURCE_EXISTS');
    // Historical disposable networks are retained. Use one explicit, checked /24
    // instead of consuming another default /16 or changing global daemon pools.
    this.subnet=fixtureSubnet(this.id,await this.#request('GET','/networks'));
    const network = await this.#request('POST', '/networks/create', { Name: this.names.network, Driver: 'bridge', Internal: true, Labels: { [label]: this.id },
      IPAM:{Driver:'default',Config:[{Subnet:this.subnet}]} });
    this.networkId = network.Id;
    const observed = await this.#request('GET', `/networks/${this.networkId}`);
    need(observed.Internal && observed.Labels[label] === this.id && observed.Name === this.names.network && observed.IPAM.Config?.length===1 && observed.IPAM.Config[0].Subnet===this.subnet, 'AGO_NETWORK_IDENTITY');
  }
  async verifyNetwork(){
    const x=await this.#request('GET',`/networks/${this.networkId}`);
    const named=await this.#request('GET','/networks/'+encodeURIComponent(this.names.network));
    need(x.Id===this.networkId && named.Id===this.networkId && x.Name===this.names.network && x.Internal && x.Labels[label]===this.id && x.IPAM.Config?.length===1 && x.IPAM.Config[0].Subnet===this.subnet,'AGO_NETWORK_IDENTITY');
  }
  async probe(id, kind) {
    const x=await this.inspect(id); let cmd;
    if(kind==='db-ready') { need(x.Image===pgImage,'AGO_PROBE_IMAGE'); cmd=['pg_isready','-h','/tmp','-U','postgres']; }
    else if(kind==='db-bootstrap') { need(x.Image===pgImage,'AGO_PROBE_IMAGE'); cmd=['psql','-X','-w','-qAt','-v','ON_ERROR_STOP=1','-h','/tmp','-U','postgres','-d','postgres','-c',
      "create role anon; create role authenticated; create role service_role; create schema auth; create table public.fixture_witness(id integer primary key,value text); insert into public.fixture_witness values(1,'preserve');"]; }
    else if(kind==='db-state') { need(x.Image===pgImage,'AGO_PROBE_IMAGE'); cmd=['psql','-X','-w','-qAt','-h','/tmp','-U','postgres','-d','postgres','-c',
      "select json_build_object('migrations',(select coalesce(json_agg(version order by version),'[]') from auth.schema_migrations),'users',(select count(*) from auth.users),'witness',(select md5(string_agg(value,',' order by id)) from public.fixture_witness))"]; }
    else { need(kind==='auth-http' && x.Image===nodeImage,'AGO_PROBE_KIND'); cmd=['node','-e',
      "const h=require('http');const get=p=>new Promise((ok,no)=>h.get('http://auth:9999'+p,r=>{let s='';r.on('data',b=>{s+=b;if(s.length>65536)r.destroy()});r.on('end',()=>ok({status:r.statusCode,body:JSON.parse(s)}))}).on('error',no));Promise.all([get('/health'),get('/settings')]).then(([a,b])=>console.log(JSON.stringify({health:a.status,settings:b.status,google:b.body.external.google}))).catch(()=>process.exit(1));"]; }
    const created=await this.#request('POST',`/containers/${id}/exec`,{AttachStdout:true,AttachStderr:true,Cmd:cmd});
    const raw=await this.#request('POST',`/exec/${created.Id}/start`,{Detach:false,Tty:false},true);
    const status=await this.#request('GET',`/exec/${created.Id}/json`);
    need(status.ContainerID===id && !status.Running,'AGO_EXEC_IDENTITY');
    // Docker multiplexed stdout is decoded only in private memory.
    const chunks=[];let at=0;
    while(at<raw.length){need(at+8<=raw.length,'AGO_EXEC_FRAME');const size=raw.readUInt32BE(at+4);need(at+8+size<=raw.length,'AGO_EXEC_FRAME');chunks.push(raw.subarray(at+8,at+8+size));at+=8+size;}
    const text=Buffer.concat(chunks).toString('utf8').trim();
    if(kind==='db-ready')return status.ExitCode===0;
    need(status.ExitCode===0,'AGO_PROBE_FAILED');
    if(kind==='db-bootstrap')return true;
    try{return JSON.parse(text);}catch{throw Error('AGO_PROBE_JSON');}
  }
  async logs(id) { await this.inspect(id); return (await this.#request('GET', `/containers/${id}/logs?stdout=true&stderr=true&tail=100`, undefined, true)).toString('utf8'); }
  async image(id) { need([authImage, pgImage, nodeImage].includes(id), 'AGO_IMAGE_DENIED'); const item = await this.#request('GET', `/images/${id}/json`); need(item.Id === id && !item.Config.Volumes, 'AGO_IMAGE_PREREQUISITE'); }
}

