import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataClient } from '../ui/data-client.js';
import { createTauriBridge } from '../ui/tauri-bridge.js';

function bridgeWith(overrides = {}) {
  return {
    app: { info: async () => ({ ok:true, value:{ version:'0.2.0', platform:'darwin' } }) },
    session: {
      list: async () => ({ ok:true, value:[{ id:'s1', name:'desktop', mode:'desktop' }] }),
      create: async (input) => ({ ok:true, value:{ id:'s2', ...input } })
    },
    timeline: { get: async (id) => ({ ok:true, value:{ session:{ id }, events:[], findings:[] } }) },
    inference: { run: async (id) => ({ ok:true, value:{ session:{ id }, findings:[] } }) },
    compare: { run: async (a,b) => ({ ok:true, value:{ sessionA:{id:a}, sessionB:{id:b} } }) },
    import: {
      har: async () => ({ ok:true, value:{ imported:2 } }),
      procmon: async () => ({ ok:true, value:{ imported:3 } }),
      jsonl: async () => ({ ok:true, value:{ imported:4 } })
    },
    launch: { run: async (_id, request) => ({ ok:true, value:{ exitCode:0, request } }) },
    export: { run: async () => ({ ok:true, value:{ outDir:'/tmp/export' } }) },
    ...overrides
  };
}

test('desktop data client unwraps the versioned bridge and exposes native operations', async () => {
  const client = createDataClient({ bridge: bridgeWith(), fetchImpl: null });
  assert.equal(client.mode, 'desktop');
  assert.deepEqual(await client.appInfo(), { version:'0.2.0', platform:'darwin' });
  assert.equal((await client.listSessions())[0].id, 's1');
  assert.equal((await client.createSession({ name:'new', mode:'desktop' })).name, 'new');
  assert.equal((await client.getTimeline('s1')).session.id, 's1');
  assert.equal((await client.runCompare('s1','s2')).sessionB.id, 's2');
  assert.equal((await client.importEvidence('har','s1')).imported, 2);
  assert.equal((await client.launch('s1',{ target:'node', args:[] })).exitCode, 0);
  assert.equal((await client.exportSession('s1')).outDir, '/tmp/export');
});

test('Tauri bridge maps invoke commands to the Electron-compatible renderer shape', async () => {
  const calls = [];
  const tauri = {
    core: {
      invoke: async (command, args = {}) => {
        calls.push([command, args]);
        return { ok:true, value:{ command, args } };
      }
    }
  };
  const bridge = createTauriBridge(tauri);
  await bridge.app.info();
  await bridge.session.create({ name:'n', mode:'desktop' });
  await bridge.compare.run('a','b');
  await bridge.import.jsonl('s','trace.jsonl','map.yaml');
  await bridge.launch.run('s',{ target:'node', args:[] });
  await bridge.dialog.pickFile([{ name:'HAR', extensions:['har'] }]);
  assert.deepEqual(calls.map(([command]) => command), [
    'app_info', 'session_create', 'compare_run', 'import_jsonl', 'launch_run', 'dialog_pick_file'
  ]);
  assert.deepEqual(calls[1][1], { input:{ name:'n', mode:'desktop' } });
  assert.deepEqual(calls[2][1], { sessionA:'a', sessionB:'b' });
});

test('desktop data client surfaces only safe error code/message from failed envelopes', async () => {
  const bridge = bridgeWith({
    session: { list: async () => ({ ok:false, code:'SESSION_FAILED', message:'Safe UI message' }), create: async () => ({ ok:true, value:{} }) }
  });
  const client = createDataClient({ bridge, fetchImpl: null });
  await assert.rejects(client.listSessions(), (error) => error.code === 'SESSION_FAILED' && error.message === 'Safe UI message' && !String(error.stack).includes('secret vendor stack'));
});

test('browser data client preserves current read/infer HTTP API and marks native actions unavailable', async () => {
  const calls = [];
  const fetchImpl = async (path, options = {}) => {
    calls.push([path, options.method || 'GET']);
    const body = path === '/api/sessions'
      ? [{ id:'browser-1', name:'browser', mode:'desktop' }]
      : path.endsWith('/infer')
        ? { findings:[] }
        : { session:{ id:'browser-1' }, events:[], findings:[] };
    return { ok:true, status:200, async json(){ return body; } };
  };
  const client = createDataClient({ bridge: null, fetchImpl });
  assert.equal(client.mode, 'browser');
  assert.equal((await client.listSessions())[0].id, 'browser-1');
  assert.equal((await client.getTimeline('browser-1')).session.id, 'browser-1');
  await client.runInference('browser-1');
  assert.deepEqual(calls, [
    ['/api/sessions','GET'],
    ['/api/session/browser-1','GET'],
    ['/api/session/browser-1/infer','POST']
  ]);
  await assert.rejects(client.createSession({ name:'x', mode:'desktop' }), (error) => error.code === 'DESKTOP_ONLY');
  await assert.rejects(client.importEvidence('har','browser-1'), (error) => error.code === 'DESKTOP_ONLY');
});
