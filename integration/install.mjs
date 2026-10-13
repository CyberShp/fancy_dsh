#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const argv=process.argv.slice(2);
function option(name,fallback){const i=argv.indexOf(name);if(i<0)return fallback;if(!argv[i+1]||argv[i+1].startsWith('--'))throw Error(`${name} needs a value`);return path.resolve(argv[i+1]);}
const home=os.homedir(), install=option('--install-dir',path.join(home,'.local/share/fancy-dsh'));
const stateFile=path.join(install,'state.json'), runtime=path.join(install,'runtime');
const hash=text=>createHash('sha256').update(text).digest('hex');
const writeJSON=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{mode:0o600});
const isOurs=file=>{try{return fs.readFileSync(file,'utf8').includes('# fancy-dsh managed launcher');}catch{return false;}};
function yamlFor(cli){return createRequire(cli)('yaml');}

async function webCompatibility(cli,dshHome,userPatches){
  const cliRequire=createRequire(fs.realpathSync(cli));
  const profileRequire=createRequire(path.join(dshHome,'profiles/web/package.json'));
  const patches=[];
  const moduleName='@deepseek-ai/dsh-host-webserver';
  const cliModule=cliRequire.resolve(moduleName),profileModule=profileRequire.resolve(moduleName);
  if(fs.realpathSync(cliModule)!==fs.realpathSync(profileModule)){
    const [cliExports,profileExports]=await Promise.all([import(pathToFileURL(cliModule).href),import(pathToFileURL(profileModule).href)]);
    const supportsIndex=module=>typeof (module.WebServer||module.default)?.prototype?.renderIndex==='function';
    if(!supportsIndex(profileExports)&&supportsIndex(cliExports))patches.push(`- id: webserver\n  disabled: true\n- insert:\n    - id: fancy-dsh-webserver\n      name: ${JSON.stringify(pathToFileURL(cliModule).href)}\n      inject: [webStartup]\n      config:\n        host: !!js ctx.webStartup.host ?? '127.0.0.1'\n        port: !!js ctx.webStartup.port ?? 3080\n`);
  }
  // Cordis replaces the whole config object. Keep any user connection config intact.
  const hasConnectionConfig=rows=>Array.isArray(rows)&&rows.some(row=>row&&typeof row==='object'&&(
    (row.id==='connection'&&Object.hasOwn(row,'config'))||hasConnectionConfig(row.insert)||(row.group&&hasConnectionConfig(row.config))
  ));
  if(!hasConnectionConfig(userPatches)){
    const connection='@deepseek-ai/dsh-client-connection';
    const cliConnection=cliRequire.resolve(connection),profileConnection=profileRequire.resolve(connection);
    if(fs.realpathSync(cliConnection)!==fs.realpathSync(profileConnection)){
      const [cliExports,profileExports]=await Promise.all([import(pathToFileURL(cliConnection).href),import(pathToFileURL(profileConnection).href)]);
      const current=cliExports.Config?.dict?.maxRequestBodyBytes?.meta?.default;
      const previous=profileExports.Config?.dict?.maxRequestBodyBytes?.meta?.default;
      if(Number.isSafeInteger(current)&&Number.isSafeInteger(previous)&&current>previous)patches.push(`- id: connection\n  name: '@deepseek-ai/dsh-client-connection'\n  config:\n    trustedHosts: !!js ctx.webRuntime.trustedHosts\n    maxRequestBodyBytes: ${current}\n`);
    }
  }
  return patches.length?`# fancy-dsh managed web compatibility\n${patches.join('')}`:null;
}

function uninstall(){
  if(!fs.existsSync(stateFile)){console.log('Normandy is not installed.');return;}
  const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  const current=fs.readFileSync(state.patchPath,'utf8');
  const YAML=yamlFor(state.command.at(-1)),doc=YAML.parseDocument(current);
  if(doc.errors.length||!Array.isArray(doc.toJSON()))throw Error('The DSH profile has invalid YAML. Restore from the recorded backup manually.');
  const items=doc.toJSON();
  for(let i=items.length-1;i>=0;i--){
    const inserted=items[i]?.insert;if(!Array.isArray(inserted))continue;
    let removed=false;
    for(let j=inserted.length-1;j>=0;j--){
      if(inserted[j]?.id!=='fancy-dsh-startup'||inserted[j]?.name!==state.pluginURL)continue;
      doc.deleteIn([i,'insert',j]);removed=true;
    }
    if(removed&&doc.getIn([i,'insert'])?.items?.length===0){
      if(Object.keys(items[i]).length===1)doc.deleteIn([i]);
      else doc.deleteIn([i,'insert']);
    }
  }
  const backup=fs.readFileSync(state.patchBackup,'utf8'),baseline=YAML.parseDocument(backup);
  const originalRestored=!baseline.errors.length&&isDeepStrictEqual(doc.toJSON(),baseline.toJSON());
  fs.writeFileSync(state.patchPath,originalRestored?backup:doc.toString());
  for(const file of state.launchers)if(isOurs(file))fs.unlinkSync(file);
  if(state.shellFile&&fs.existsSync(state.shellFile)){const text=fs.readFileSync(state.shellFile,'utf8');fs.writeFileSync(state.shellFile,text.replace(state.shellBlock,''));}
  fs.renameSync(stateFile,path.join(install,`state.uninstalled-${Date.now()}.json`));
  console.log('Normandy startup removed. Existing DSH settings and runtime data are preserved.');
}

async function installNow(){
  if(process.platform!=='darwin')throw Error('This installer currently supports macOS. The web preview runs separately.');
  const dshHome=option('--dsh-home',process.env.DSH_HOME?path.resolve(process.env.DSH_HOME):path.join(home,'.dsh'));
  const cli=option('--dsh-cli',path.join(dshHome,'profiles/node_modules/@deepseek-ai/dsh/lib/bin.js'));
  if(!fs.existsSync(cli))throw Error('DSH CLI was not found. Pass --dsh-cli /absolute/path/to/@deepseek-ai/dsh/lib/bin.js');
  const YAML=yamlFor(cli);
  const patchPath=path.join(dshHome,'profiles/web/cordis.patch.yml');
  if(!fs.existsSync(patchPath))throw Error('The DSH web profile is missing. Initialize it with the official DSH CLI first.');
  const original=fs.readFileSync(patchPath,'utf8'),doc=YAML.parseDocument(original);
  if(doc.errors.length||!Array.isArray(doc.toJSON()))throw Error('Expected a valid list in the DSH web profile patch.');
  const compatibility=await webCompatibility(cli,dshHome,doc.toJSON());
  const previous=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):null;
  const pluginURL=pathToFileURL(path.join(runtime,'integration/plugin.mjs')).href;
  const found=doc.toJSON().some(row=>row?.insert?.some?.(item=>item.id==='fancy-dsh-startup'));
  if(found&&!previous)throw Error('A Normandy plugin entry already exists. Resolve the existing installation before installing.');
  const bin=option('--bin-dir',path.join(home,'.local/bin'));
  const launchers=['dsh','dsh-normandy'].map(name=>path.join(bin,name));
  for(const file of launchers)if(fs.existsSync(file)&&!isOurs(file))throw Error(`An existing command would be overwritten: ${file}`);
  const files=JSON.parse(fs.readFileSync(path.join(root,'release-files.json'),'utf8'));
  for(const relative of files)if(!fs.existsSync(path.join(root,relative)))throw Error(`Release file missing: ${relative}`);
  const staged=path.join(install,`runtime-build-${process.pid}`);fs.mkdirSync(staged,{recursive:true,mode:0o700});
  for(const relative of files){const dest=path.join(staged,relative);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,relative),dest);}
  const nativeHost=path.join(install,'NormandyWindow'),nativeBuild=nativeHost+'.next';
  execFileSync('/usr/bin/swiftc',['-O',path.join(staged,'integration/NormandyWindow.swift'),'-o',nativeBuild],{stdio:'inherit'});
  if(fs.existsSync(runtime))fs.renameSync(runtime,path.join(install,`runtime-previous-${Date.now()}`));
  fs.renameSync(staged,runtime);fs.renameSync(nativeBuild,nativeHost);fs.chmodSync(nativeHost,0o755);
  const compatibilityPatch=compatibility===null?null:path.join(install,'web-compat.yml');
  if(compatibilityPatch)fs.writeFileSync(compatibilityPatch,compatibility,{mode:0o600});
  const patchBackup=previous?.patchBackup||path.join(install,`cordis.patch-${Date.now()}.backup`);
  if(!previous)fs.writeFileSync(patchBackup,original,{mode:0o600});
  if(!found)doc.add({insert:[{id:'fancy-dsh-startup',name:pluginURL}]});
  const patch=doc.toString();fs.writeFileSync(patchPath,patch);
  fs.mkdirSync(bin,{recursive:true});
  const node=(process.env.PATH||'').split(path.delimiter).map(dir=>path.join(dir,'node')).find(file=>{try{return fs.realpathSync(file)===fs.realpathSync(process.execPath);}catch{return false;}})||process.execPath;
  const shellQuote=value=>`'${value.replaceAll("'",`'\\''`)}'`;
  for(const file of launchers)fs.writeFileSync(file,`#!/bin/sh\n# fancy-dsh managed launcher\nexec ${shellQuote(node)} ${shellQuote(path.join(runtime,'integration/launch.mjs'))} "$@"\n`,{mode:0o755});
  let shellFile=previous?.shellFile||null,shellBlock=previous?.shellBlock||'';
  if(!argv.includes('--no-shell')&&!(process.env.PATH||'').split(path.delimiter).includes(bin)){
    shellFile=path.join(home,'.zshrc');shellBlock=`\n# fancy-dsh PATH\nexport PATH=${shellQuote(bin)}:"$PATH"\n# end fancy-dsh PATH\n`;
    const text=fs.existsSync(shellFile)?fs.readFileSync(shellFile,'utf8'):'';
    if(!text.includes('# fancy-dsh PATH'))fs.appendFileSync(shellFile,shellBlock);
  }
  writeJSON(stateFile,{version:1,enabled:previous?.enabled??true,command:[node,cli],dshHome,patchPath,patchBackup,installedPatchHash:hash(patch),pluginURL,nativeHost,launchers,shellFile,shellBlock,compatibilityPatch});
  console.log('Installed Normandy startup. Run dsh to open DSH.');
  console.log('Controls: dsh startup on|off|status; dsh --no-startup; dsh web --no-open');
}

try{
  if(argv.includes('--help'))console.log('node integration/install.mjs [--dsh-cli PATH] [--uninstall]\nOptions: --dsh-home PATH --install-dir PATH --bin-dir PATH --no-shell');
  else if(argv.includes('--uninstall'))uninstall();
  else await installNow();
}catch(error){console.error(`Normandy install: ${error.message}`);process.exitCode=1;}
