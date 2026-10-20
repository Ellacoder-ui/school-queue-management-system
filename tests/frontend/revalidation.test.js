import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRecoveryTask} from '../../src/lib/revalidation.js'
test('focus visibility and reconnect coalesce; hidden and stopped recovery tasks make no request',()=>{
  const timers=new Map();let calls=0,visible=true,id=0
  const task=createRecoveryTask(()=>calls++,{visible:()=>visible,setTimer:fn=>{timers.set(++id,fn);return id},clearTimer:key=>timers.delete(key)})
  task.schedule();task.schedule();task.schedule();assert.equal(timers.size,1)
  let [key,fn]=[...timers][0];timers.delete(key);fn();assert.equal(calls,1)
  visible=false;task.schedule();[key,fn]=[...timers][0];timers.delete(key);fn();assert.equal(calls,1)
  task.schedule();task.stop();assert.equal(timers.size,0);task.schedule();assert.equal(timers.size,0)
})
