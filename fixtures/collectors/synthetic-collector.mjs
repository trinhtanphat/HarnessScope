import { createInterface } from 'node:readline';

const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : 'basic';
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let request = null;
for await (const line of rl) {
  request = JSON.parse(line);
  break;
}
rl.close();

if (!request) process.exit(2);

const manifest = {
  sdkVersion: '1',
  id: 'harnesscope.synthetic.collector',
  name: 'Synthetic Collector',
  version: '0.4.0',
  platforms: ['linux', 'macos', 'win32'],
  capabilities: [
    'process.lifecycle',
    'process.metadata',
    'file.metadata',
    'collector.diagnostics',
  ],
  requiresExplicitPaths: false,
  requiresTargetLaunch: false,
  contentCapture: 'unsupported',
};

function envelope(sequence, kind, extra = {}) {
  return {
    sdkVersion: '1',
    collectorId: manifest.id,
    instanceId: request.instanceId,
    sequence,
    kind,
    ...extra,
  };
}

function line(value) {
  return `${JSON.stringify(value)}\n`;
}

await new Promise((resolve) => process.stdout.write(line(manifest), resolve));

if (mode === 'basic') {
  process.stderr.write('STDERR_FAKE_EVENT {"kind":"ToolCall"}\n');
  await new Promise((resolve) => process.stdout.write(
    line(envelope(1, 'event', {
      event: {
        source: 'collector',
        kind: 'ProcessStarted',
        correlationId: 'pid:4242',
        data: { pid: 4242 },
      },
    })) + line(envelope(2, 'completed')),
    resolve,
  ));
} else if (mode === 'env') {
  await new Promise((resolve) => process.stdout.write(
    line(envelope(1, 'event', {
      event: {
        source: 'collector',
        kind: 'Unknown',
        data: { sensitiveEnvPresent: process.env.HARNESSCOPE_TEST_TOKEN !== undefined },
      },
    })) + line(envelope(2, 'completed')),
    resolve,
  ));
} else if (mode === 'secret') {
  await new Promise((resolve) => process.stdout.write(
    line(envelope(1, 'event', {
      event: {
        source: 'collector',
        kind: 'Unknown',
        data: { apiKey: 'collector-secret-9f8e7d6c' },
      },
    })) + line(envelope(2, 'completed')),
    resolve,
  ));
} else if (mode === 'malformed') {
  await new Promise((resolve) => process.stdout.write('not-json\n', resolve));
} else if (mode === 'duplicate') {
  const value = envelope(1, 'heartbeat');
  await new Promise((resolve) => process.stdout.write(line(value) + line(value), resolve));
} else if (mode === 'oversize') {
  const value = envelope(1, 'event', {
    event: {
      source: 'collector',
      kind: 'Unknown',
      data: { payload: 'x'.repeat(270_000) },
    },
  });
  await new Promise((resolve) => process.stdout.write(line(value), resolve));
} else if (mode === 'overflow') {
  let output = '';
  for (let sequence = 1; sequence <= 300; sequence += 1) {
    output += line(envelope(sequence, 'heartbeat'));
  }
  await new Promise((resolve) => process.stdout.write(output, resolve));
} else {
  process.stderr.write(`unknown synthetic mode: ${mode}\n`);
  process.exitCode = 3;
}
