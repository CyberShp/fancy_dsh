#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { constants } from 'node:os';

const directory=dirname(fileURLToPath(import.meta.url));
const statePath=process.env.FANCY_DSH_STATE || resolve(directory,'../../state.json');
let state;
try{state=JSON.parse(readFileSync(statePath,'utf8'));}catch{console.error('Normandy is not installed. Run: node integration/install.mjs');process.exit(1);}
let args=process.argv.slice(2);
if(args[0]==='startup'){
  const action=args[1]||'status';
  if(['on','off'].includes(action)){state.enabled=action==='on';writeFileSync(statePath,JSON.stringify(state,null,2)+'\n',{mode:0o600});}
  else if(action!=='status'){console.error('Usage: dsh startup on|off|status');process.exit(64);}
  console.log(`Normandy startup: ${state.enabled?'on':'off'}`);process.exit(0);
}
let enabled=state.enabled;
const separator=args.indexOf('--');
const passthrough=separator<0?[]:args.slice(separator);
let options=separator<0?args:args.slice(0,separator);
if(options.includes('--no-startup'))enabled=false;
if(options.includes('--startup'))enabled=true;
options=options.filter(a=>!['--startup','--no-startup'].includes(a));
if(!options.length&&!passthrough.length)options=['web'];
function isWebInvocation(values){
  if(values[0]==='web')return true;
  let profile;
  for(let i=0;i<values.length;i++){
    const value=values[i];
    if(value==='--profile'){profile=values[++i];continue;}
    if(value.startsWith('--profile=')){profile=value.slice('--profile='.length);continue;}
    if(value==='--patch'){i++;continue;}
    if(value.startsWith('--patch='))continue;
    if(['--help','-h','--version','-V','--dump-config','--dump-default-config'].includes(value))continue;
    break;
  }
  return profile==='web';
}
const web=isWebInvocation(options);
const informational=options.some(a=>['--help','-h','--version','-V','--dump-config','--dump-default-config'].includes(a));
const explicitNoOpen=options.includes('--no-open');
const hostIndex=options.indexOf('--host');
const hostValue=hostIndex>=0?options[hostIndex+1]:options.find(a=>a.startsWith('--host='))?.slice('--host='.length);
const localHost=hostValue===undefined||hostValue==='127.0.0.1';
const sameHome=!process.env.DSH_HOME||resolve(process.env.DSH_HOME)===state.dshHome;
const useWindow=web&&!informational&&!explicitNoOpen&&localHost&&sameHome&&process.platform==='darwin'&&existsSync(state.nativeHost);
const compatibility=web&&!informational&&sameHome&&state.compatibilityPatch&&existsSync(state.compatibilityPatch)?['--patch',state.compatibilityPatch]:[];
const env={...process.env,FANCY_DSH_ENABLED:enabled?'1':'0'};
if(!env.DSH_HOME)env.DSH_HOME=state.dshHome;
const patchedOptions=options[0]==='web'?['web',...compatibility,...options.slice(1)]:[...compatibility,...options];
args=[...patchedOptions,...(useWindow?['--no-open']:[]),...passthrough];
const server=spawn(state.command[0],[...state.command.slice(1),...args],{env,stdio:useWindow?['inherit','pipe','pipe']:'inherit',detached:process.platform!=='win32'});
let host,shutdown=false,shutdownCode=0,serverDone=false,readyBuffer='';
function stopServer(signal='SIGTERM',exitCode=0){
  if(shutdown||serverDone)return;shutdown=true;shutdownCode=exitCode;
  try{process.platform==='win32'?server.kill(signal):process.kill(-server.pid,signal);}catch{}
  const force=setTimeout(()=>{if(!serverDone){try{process.platform==='win32'?server.kill('SIGKILL'):process.kill(-server.pid,'SIGKILL');}catch{}}},5000);force.unref();
}
process.on('SIGINT',()=>stopServer('SIGINT',130));process.on('SIGTERM',()=>stopServer('SIGTERM',143));
server.on('error',error=>{console.error(`Could not start DSH: ${error.message}`);process.exitCode=1;});
server.on('exit',(code,signal)=>{serverDone=true;if(host&&!host.killed)host.kill('SIGTERM');process.exitCode=shutdown?shutdownCode:(code??(signal?128+(constants.signals[signal]||0):0));});
function launchWindow(url){
  if(host||shutdown)return;
  host=spawn(state.nativeHost,[url,'--stay'],{stdio:['ignore','pipe','inherit']});
  host.stdout.on('data',chunk=>{
    const value=chunk.toString();
    if(value.includes('NORMANDY_EVENT complete'))console.log('Normandy ready.');
    else if(value.includes('NORMANDY_EVENT skip'))console.log('Normandy skipped.');
  });
  const fallback=()=>{if(!shutdown&&!serverDone){console.error('The native window could not stay open. Opening DSH in your browser.');spawn('open',[url],{stdio:'ignore'}).unref();}};
  host.on('error',fallback);
  host.on('exit',code=>{if(code===0)stopServer();else if(code!==null)fallback();});
}
if(useWindow){
  for(const [stream,output] of [[server.stdout,process.stdout],[server.stderr,process.stderr]])stream.on('data',chunk=>{
    output.write(chunk);readyBuffer=(readyBuffer+chunk.toString()).slice(-8192);
    const match=readyBuffer.replace(/\x1b\[[0-9;]*m/g,'').match(/dsh web:\s+(http:\/\/127\.0\.0\.1:\d+)/);
    if(match)launchWindow(match[1]);
  });
}
