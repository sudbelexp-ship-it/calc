const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
async function main(){
  const controls={};const context={$:id=>controls[id]??={},document:{addEventListener(){}},console,navigator:{},setTimeout,Promise};
  vm.createContext(context);vm.runInContext(fs.readFileSync('browser-queue.js','utf8'),context);
  const countJob={complete:33,total:44,state:'error',start:{},pause:{},count:{},
    bar:{style:{},parentNode:{setAttribute(){}}}};
  context.updateJob(countJob);
  assert.match(countJob.count.textContent,/33 \/ 44.*75%/);
  assert.equal(countJob.bar.style.width,'75%');
  vm.runInContext(`updateJob=()=>{};var ran=[];var outstanding=0;var maxOutstanding=0;var releaseFirst;
  runJob=async j=>{j.state='running';ran.push(j.id);outstanding++;maxOutstanding=Math.max(maxOutstanding,outstanding);if(j.id===1)await new Promise(r=>releaseFirst=r);j.state='done';outstanding--;};
  jobs.push({id:1,state:'ready',badge:{}},{id:2,state:'ready',badge:{}},{id:3,state:'ready',badge:{}});`,context);
  assert.equal(vm.runInContext('ran.length',context),0,'adding must not start work');
  vm.runInContext('startJob(jobs[0]);startJob(jobs[1]);startJob(jobs[2]);pauseJob(jobs[1]);',context);
  assert.equal(vm.runInContext('jobs[1].state',context),'paused');
  vm.runInContext('releaseFirst()',context);await new Promise(setImmediate);
  assert.deepEqual(Array.from(vm.runInContext('ran',context)),[1,3]);
  assert.equal(vm.runInContext('maxOutstanding',context),1,'single inference lane');
  vm.runInContext('startJob(jobs[1])',context);await new Promise(setImmediate);
  assert.deepEqual(Array.from(vm.runInContext('ran',context)),[1,3,2]);
  vm.runInContext("jobs.push({id:4,state:'running',badge:{}});pauseJob(jobs[3]);",context);
  assert.equal(vm.runInContext('jobs[3].state',context),'pausing');
  const storage=fs.readFileSync('browser-storage.js','utf8');
  vm.runInContext(storage.slice(storage.indexOf('async function waitResume'),storage.indexOf("$('outputFolder')")),context);
  await assert.rejects(context.waitResume({isRemoved:()=>false,shouldPause:()=>true}),{name:'PauseError'});
  const pdf=fs.readFileSync('browser-pdf.js','utf8');assert(!pdf.includes('setTimeout'));assert(pdf.includes("intent:'print'"));
  console.log('Passed: no autostart, single lane, pause queued job, resume out of order, page-boundary pause, timer-free PDF rendering');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
