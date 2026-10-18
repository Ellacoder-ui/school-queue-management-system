// Docker Engine API proxy used only while creating a disposable routing project.
// Forces explicit loopback bindings; credentials/configuration never reach disk.
import http from 'node:http'
import net from 'node:net'
import {spawn} from 'node:child_process'
import path from 'node:path'

const [workdir, project, network] = process.argv.slice(2)
if (!/^sq-routing-(fresh|upgrade)-[0-9a-f]{8}$/.test(project ?? '') || ![`${project}-loopback`,`supabase_network_${project}`].includes(network)
  || !path.resolve(workdir).includes(`${path.sep}.local-routing${path.sep}`)) throw Error('Invalid disposable identity')
const pipe = '\\\\.\\pipe\\docker_engine'
let rewritten = 0
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    let body
    if (req.method === 'POST' && /\/containers\/create$/.test(url.pathname)) {
      const name = url.searchParams.get('name')
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const config = JSON.parse(Buffer.concat(chunks))
      const mounts=JSON.stringify([config.HostConfig?.Binds,config.HostConfig?.Mounts,config.HostConfig?.VolumesFrom])
      const ownNamed=name?.startsWith('supabase_')&&name.endsWith(`_${project}`)
      // CLI's ephemeral SQL initializer has no name or data mounts. Require its
      // isolated network, trusted image, no host privilege and no published ports.
      const noMounts=![config.HostConfig?.Binds,config.HostConfig?.Mounts,config.HostConfig?.VolumesFrom].some(v=>v?.length)
      const ownInitializer=!name&&[network,`container:supabase_db_${project}`].includes(config.HostConfig?.NetworkMode)
        && /(?:^|\/)supabase\/(postgres|pg_prove|realtime):/.test(config.Image??'')
        && (mounts.includes(project)||noMounts)&&!config.HostConfig?.Privileged
        && !Object.keys(config.HostConfig?.PortBindings??{}).length
      if ((!ownNamed&&!ownInitializer)||mounts.includes('school-queue-local')) {
        const safe=v=>typeof v==='string'&&/^[a-zA-Z0-9_.:/-]+$/.test(v)?v:'unavailable'
        process.stderr.write(`ERROR: startup identity rejected: name=${safe(name)} network=${safe(config.HostConfig?.NetworkMode)} image=${safe(config.Image)} own-volume=${mounts.includes(project)}\n`)
        throw Error('Foreign container creation refused')
      }
      for (const bindings of Object.values(config.HostConfig?.PortBindings ?? {})) {
        for (const binding of bindings ?? []) binding.HostIp = '127.0.0.1'
      }
      body = Buffer.from(JSON.stringify(config))
      rewritten++
    }
    if (req.method === 'DELETE' && /\/volumes\//.test(url.pathname)) throw Error('Volume deletion refused')
    const headers = {...req.headers}
    if (body) { headers['content-length'] = body.length; delete headers['transfer-encoding'] }
    const upstream = http.request({socketPath:pipe, path:req.url, method:req.method, headers}, response => {
      res.writeHead(response.statusCode, response.headers)
      response.pipe(res)
    })
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Docker proxy failed') })
    upstream.on('upgrade', (response, socket, head) => {
      res.socket.write(`HTTP/1.1 ${response.statusCode} Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n`)
      if (head.length) res.socket.write(head)
      socket.pipe(res.socket); res.socket.pipe(socket)
    })
    if (body) upstream.end(body); else req.pipe(upstream)
  } catch { res.writeHead(403); res.end('Disposable startup guard rejected request') }
})
// Docker attaches to its one-off initializer before starting it. Forward the
// HTTP upgrade stream unchanged; the connection stays on the local named pipe.
server.on('upgrade',(req,socket,head)=>{
 const upstream=net.createConnection(pipe,()=>{
  upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`+
   req.rawHeaders.reduce((s,v,i)=>s+v+(i%2?'\r\n':': '),'')+'\r\n')
  if(head.length)upstream.write(head)
  socket.pipe(upstream);upstream.pipe(socket)
 })
 upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy())
 socket.on('close',()=>upstream.destroy())
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const env = {...process.env, DOCKER_HOST:`tcp://127.0.0.1:${server.address().port}`}
delete env.DOCKER_CONTEXT
delete env.DOCKER_TLS_VERIFY
delete env.DOCKER_CERT_PATH
const child = spawn(process.execPath, [path.resolve('node_modules/supabase/dist/supabase.js'), 'start', '--workdir', workdir,
  '--network-id',network,'--exclude','studio,postgres-meta,storage-api,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor'],
  {env, stdio:['ignore','pipe','pipe']})
// Parent captures output and never prints credential-bearing status.
child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr)
const code = await new Promise(resolve => { child.on('error',()=>resolve(1)); child.on('exit',resolve) })
server.closeAllConnections(); server.close()
if (!code && !rewritten) throw Error('Docker host override ignored; no guarded containers created')
process.exitCode = code || 0
