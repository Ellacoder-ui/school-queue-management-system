// Each owned software-test server uses its own ignored dependency cache.
import {spawn} from 'node:child_process'

export function startTestVite(port, identity, env) {
  if (![5175,5176].includes(port) || !/^[a-z-]+-[0-9a-f]{8}$/.test(identity)) throw new Error('Invalid local Vite test identity')
  const options={cacheDir:`.local-browser/vite-${identity}`,server:{host:'127.0.0.1',port,strictPort:true}}
  const code=`import {createServer} from 'vite'; const server=await createServer(${JSON.stringify(options)}); await server.listen();`
  return spawn(process.execPath,['--input-type=module','--eval',code],{env,windowsHide:true,stdio:'ignore'})
}
