import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { apply, createHandler, inventory, localRequest, PREFIX } from './plugin.mjs';

const launcher = fileURLToPath(new URL('./launch.mjs', import.meta.url));

async function localServer(t, services = {}) {
  const ctx = { ...services, webServer: { port: 0 } };
  const handler = createHandler(ctx);
  const server = http.createServer((req, res) => handler(req, res));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  ctx.webServer.port = port;
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (path, options = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, ...options }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
  return { request, port };
}

function sampleServices(overrides = {}) {
  return {
    agentPresets: { standingKeyFor: async () => 'test-scope' },
    skills: { snapshot: async () => ({ complete: true, skills: [{ name: 'navigation' }] }) },
    loader: { entries: () => [] },
    ...overrides,
  };
}

test('the plugin serves the complete browser entry and its Three.js dependency chain', async t => {
  const { request } = await localServer(t);
  for (const path of ['overlay.js', 'dist/cinematic/', 'dist/cinematic/app.js', 'dist/cinematic/motion.js',
                     'dist/cinematic/vessel.js', 'dist/ship.js', 'dist/vendor/three.module.js', 'dist/vendor/three.core.min.js',
                     'dist/assets/fonts/rajdhani.css', 'dist/cinematic/assets/cinematic.wav']) {
    const response = await request(`${PREFIX}/${path}`);
    assert.equal(response.status, 200, path);
    assert.ok(response.body.length > 0, path);
    assert.equal(response.headers['content-length'], String(response.body.length), path);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
  }
  const head = await request(`${PREFIX}/dist/cinematic/`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.match(head.headers['content-type'], /^text\/html/);
  assert.ok(Number(head.headers['content-length']) > 0);
  assert.equal(head.body.length, 0);
});

test('loopback routes reject foreign origins, host rebinding, writes, and file traversal', async t => {
  const { request, port } = await localServer(t);
  const path = `${PREFIX}/dist/cinematic/`;
  const allowed = await request(path, { headers: { Origin: `http://127.0.0.1:${port}` } });
  assert.equal(allowed.status, 200);
  for (const headers of [{ Host: `example.invalid:${port}` }, { Origin: 'https://example.invalid' },
                         { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await request(path, { headers })).status, 403);
  }
  assert.equal(localRequest({ headers: { host: `127.0.0.1:${port}` }, socket: { remoteAddress: '192.0.2.1' } }, port), false);
  assert.equal((await request(path, { method: 'POST' })).status, 405);
  for (const relative of ['../package.json', '%2e%2e/package.json', 'dist/%2e%2e/package.json',
                          'dist%5cvendor%5cthree.module.js', 'dist/cinematic/app.js%00',
                          'integration/launch.mjs', 'package.json', 'dist/vendor/THREE-LICENSE.txt']) {
    const response = await request(`${PREFIX}/${relative}`);
    assert.equal(response.status, 404, relative);
    assert.match(response.body.toString(), /Asset not found/);
  }
});

test('inventory exposes deduplicated names without skill contents or MCP credentials', async t => {
  let requestedScope;
  const marker = 'fixture-private-content';
  const services = sampleServices({
    skills: { snapshot: async options => {
      requestedScope = options.scope;
      return { complete: true, skills: [
        { name: 'navigation', content: marker, path: `/private/${marker}` },
        { name: 'analysis', description: marker }, { name: 'navigation' }, { name: '' },
      ] };
    } },
    loader: { entries: () => [
      { options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'filesystem', token: marker } } },
      { options: { name: 'mcp-client' }, fiber: { config: { serverName: 'git', env: { TOKEN: marker } } } },
      { options: { name: 'mcp-client', config: { serverName: 'git' } } },
      { disabled: true, options: { name: 'mcp-client', config: { serverName: 'disabled' } } },
      { options: { name: 'mcp-client', disabled: true, config: { serverName: 'disabled-option' } } },
      { options: { name: 'mcp-client', group: true, config: { serverName: 'group' } } },
      { options: { name: 'another-plugin', config: { serverName: 'unrelated' } } },
    ] },
  });
  const { request } = await localServer(t, services);
  const response = await request(`${PREFIX}/inventory`);
  assert.equal(response.status, 200);
  assert.equal(requestedScope, 'test-scope');
  assert.deepEqual(JSON.parse(response.body), {
    mode: 'live', skills: ['analysis', 'navigation'],
    mcps: [{ name: 'filesystem', label: 'MCP SERVER' }, { name: 'git', label: 'MCP SERVER' }],
    skillCount: 2, mcpCount: 2,
  });
  assert.ok(!response.body.includes(marker));
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('inventory cancellation aborts the service read and incomplete scans are unavailable', async () => {
  let receivedSignal;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const external = new AbortController();
  const result = inventory(sampleServices({ skills: { snapshot: ({ signal }) => {
    receivedSignal = signal;
    entered();
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  } } }), 1000, external.signal);
  await started;
  external.abort();
  const cancelled = await result;
  assert.equal(receivedSignal.aborted, true);
  assert.equal(cancelled.mode, 'unavailable');
  assert.deepEqual([cancelled.skills, cancelled.mcps], [[], []]);
  const partial = await inventory(sampleServices({ skills: { snapshot: async () => ({ complete: false, skills: [{ name: 'partial' }] }) } }));
  assert.equal(partial.mode, 'unavailable');
  assert.equal(partial.skillCount, 0);
});

test('plugin registration injects the enabled state and serves its overlay under one prefix', () => {
  let registered;
  let inject;
  const prior = process.env.FANCY_DSH_ENABLED;
  process.env.FANCY_DSH_ENABLED = '0';
  try {
    apply({
      webServer: { register: route => { registered = route; } },
      effect: callback => callback(),
      on: (name, callback) => { assert.equal(name, 'webserver/index-inject'); inject = callback; },
    });
    const table = [];
    inject(table);
    assert.equal(registered.kind, 'prefix');
    assert.equal(registered.path, PREFIX);
    assert.equal(typeof registered.handler, 'function');
    const configuration = table.find(row => row.name === '__FANCY_DSH_BOOT__');
    assert.equal(configuration.value.enabled, false);
    assert.equal(typeof configuration.value.instance, 'string');
    assert.ok(table.some(row => row.kind === 'script-src' && row.src === `${PREFIX}/overlay.js`));
  } finally {
    if (prior === undefined) delete process.env.FANCY_DSH_ENABLED;
    else process.env.FANCY_DSH_ENABLED = prior;
  }
});

async function fakeInstallation(t, enabled = true) {
  const directory = await mkdtemp(join(tmpdir(), 'fancy-dsh-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fakeCLI = join(directory, 'cli.mjs');
  const stateFile = join(directory, 'state.json');
  const dshHome = join(directory, 'dsh-home');
  await writeFile(fakeCLI, `
    const args = process.argv.slice(2);
    const result = { args, enabled: process.env.FANCY_DSH_ENABLED, home: process.env.DSH_HOME };
    if (args.includes('--fixture-wait')) {
      setInterval(() => {}, 1000);
      console.log(JSON.stringify({ ...result, ready: true, pid: process.pid }));
    } else {
      console.log(JSON.stringify(result));
      process.exit(Number(args.find(arg => arg.startsWith('--exit='))?.slice(7) || 0));
    }
  `);
  await writeFile(stateFile, JSON.stringify({ enabled, command: [process.execPath, fakeCLI], dshHome,
    nativeHost: join(directory, 'absent-native-host') }));
  const env = { ...process.env, FANCY_DSH_STATE: stateFile, DSH_HOME: dshHome };
  const run = (args, environment = {}) => spawnSync(process.execPath, [launcher, ...args], {
    encoding: 'utf8', timeout: 5000,
    env: { ...env, ...environment },
  });
  const start = args => spawn(process.execPath, [launcher, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  return { run, start, stateFile, dshHome };
}

test('launcher forwards DSH arguments and exit status while setting the startup switch', async t => {
  const { run, dshHome } = await fakeInstallation(t);
  const result = run(['run', 'two words', '--output-format', 'json', '--no-startup', '--exit=7']);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 7, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    args: ['run', 'two words', '--output-format', 'json', '--exit=7'], enabled: '0', home: dshHome,
  });
});

test('startup preferences persist independently from a one-time override and default web launch', async t => {
  const { run, stateFile } = await fakeInstallation(t);
  const off = run(['startup', 'off']);
  assert.equal(off.status, 0, off.stderr);
  assert.match(off.stdout, /startup: off/);
  assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).enabled, false);
  const normal = run([]);
  assert.equal(normal.status, 0, normal.stderr);
  assert.deepEqual(JSON.parse(normal.stdout).args, ['web']);
  assert.equal(JSON.parse(normal.stdout).enabled, '0');
  const override = run(['--startup', '--version']);
  assert.equal(override.status, 0, override.stderr);
  assert.deepEqual(JSON.parse(override.stdout).args, ['--version']);
  assert.equal(JSON.parse(override.stdout).enabled, '1');
  assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).enabled, false);
  assert.equal(run(['startup', 'unknown']).status, 64);
});

test('launcher preserves startup-like arguments after the argument separator', async t => {
  const { run } = await fakeInstallation(t);
  const args = ['run', '--', '--no-startup', 'two words'];
  const result = run(args);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).args, args);
  assert.equal(JSON.parse(result.stdout).enabled, '1');
});

test('only a normal web invocation receives the native-window no-open flag', { skip: process.platform !== 'darwin' }, async t => {
  const { run, stateFile } = await fakeInstallation(t);
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  // An existing executable makes the native path eligible; the fake CLI never emits a window URL.
  state.nativeHost = process.execPath;
  await writeFile(stateFile, JSON.stringify(state));
  const web = run(['web']);
  assert.equal(web.status, 0, web.stderr);
  assert.deepEqual(JSON.parse(web.stdout).args, ['web', '--no-open']);
  for (const args of [['plugin', '--profile', 'web'], ['web', '--dump-config'], ['web', '--dump-default-config']]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).args, args);
  }
});

test('compatibility patch applies to this DSH web profile while preserving command arguments', async t => {
  const { run, stateFile, dshHome } = await fakeInstallation(t);
  const compatibilityPatch = `${stateFile}.compatibility.yml`;
  await writeFile(compatibilityPatch, '[]\n');
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  state.compatibilityPatch = compatibilityPatch;
  await writeFile(stateFile, JSON.stringify(state));
  for (const [args, expected] of [
    [[], ['web', '--patch', compatibilityPatch]],
    [['web'], ['web', '--patch', compatibilityPatch]],
    [['--profile', 'web'], ['--patch', compatibilityPatch, '--profile', 'web']],
    [['web', '--no-open'], ['web', '--patch', compatibilityPatch, '--no-open']],
    [['web', '--port', '3081'], ['web', '--patch', compatibilityPatch, '--port', '3081']],
    [['web', '--', '--no-startup', 'two words'], ['web', '--patch', compatibilityPatch, '--', '--no-startup', 'two words']],
    [['web', '--help'], ['web', '--help']],
    [['plugin', '--profile', 'web'], ['plugin', '--profile', 'web']],
  ]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    const forwarded = JSON.parse(result.stdout);
    assert.deepEqual(forwarded.args, expected);
    assert.equal(forwarded.enabled, '1');
  }
  const otherHome = `${dshHome}-other`;
  const otherProfile = run(['web'], { DSH_HOME: otherHome });
  assert.equal(otherProfile.status, 0, otherProfile.stderr);
  assert.deepEqual(JSON.parse(otherProfile.stdout).args, ['web']);
  assert.equal(JSON.parse(otherProfile.stdout).home, otherHome);
});

test('external interrupt and termination preserve conventional launcher exit codes', { skip: process.platform === 'win32' }, async t => {
  const { start } = await fakeInstallation(t);
  for (const [signal, expected] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    const child = start(['run', '--fixture-wait']);
    const lines = createInterface({ input: child.stdout });
    const exited = once(child, 'close', { signal: AbortSignal.timeout(5000) });
    let cliPID;
    const cleanup = () => {
      lines.close();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (cliPID) { try { process.kill(-cliPID, 'SIGKILL'); } catch {} }
      cliPID = undefined;
    };
    t.after(cleanup);
    try {
      const [line] = await once(lines, 'line', { signal: AbortSignal.timeout(3000) });
      const ready = JSON.parse(line);
      assert.equal(ready.ready, true);
      assert.ok(Number.isInteger(ready.pid) && ready.pid > 0);
      cliPID = ready.pid;
      child.kill(signal);
      const [code, exitSignal] = await exited;
      assert.equal(code, expected, signal);
      assert.equal(exitSignal, null, signal);
    } finally {
      cleanup();
    }
  }
});
