import { installInstructions } from './test-support/instruction-package.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { localClient } from './orders.mjs';
import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

// An isolated Compose project and synthetic state; never attach an existing volume.
const project = `flow-batch-validation-${randomBytes(4).toString('hex')}`;
const directory = resolve('.cache', project);
const destination = join(directory, 'extension');
mkdirSync(destination, { recursive: true });
installInstructions(join(directory, 'instructions'));
const environment = {
  ...process.env,
  WIN_EXTENSION_DIR: destination,
  FLOW_LIBRARY_DIR: join(directory, 'instructions'),
};
const log = join(directory, 'docker.log');

function docker(args) {
  try {
    const output = execFileSync('docker', args, {
      env: environment,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    });
    appendFileSync(log, output);
    return output.trim();
  } catch (error) {
    appendFileSync(log, `${error.stdout ?? ''}\n${error.stderr ?? ''}\n`);
    throw new Error(`Docker validation failed. See ${log}`, { cause: error });
  }
}

function compose(...args) {
  return docker(['compose', '-p', project, ...args]);
}
function executeNode(source) {
  return compose(
    'exec',
    '-T',
    'orchestrator',
    'node',
    '--input-type=module',
    '-e',
    source,
  );
}

try {
  compose('config', '--quiet');
  compose('up', '-d', '--build', '--wait', '--wait-timeout', '60');
  const container = JSON.parse(
    docker(['inspect', compose('ps', '-q', 'orchestrator')]),
  )[0];
  assert.equal(container.Config.User, '1000:1000');
  assert.equal(container.HostConfig.ReadonlyRootfs, true);
  assert.equal(
    container.NetworkSettings.Ports['4319/tcp'][0].HostIp,
    '127.0.0.1',
  );
  assert.equal(
    container.Mounts.some((mount) => mount.Destination === '/destination'),
    false,
  );
  assert.equal(
    container.Mounts.find((mount) => mount.Destination === '/data').RW,
    true,
  );
  const syncContainer = JSON.parse(
    docker(['inspect', compose('ps', '-a', '-q', 'sync-extension')]),
  )[0];
  assert.equal(syncContainer.State.ExitCode, 0);
  assert.equal(syncContainer.HostConfig.NetworkMode, 'none');
  assert.equal(syncContainer.HostConfig.ReadonlyRootfs, true);
  assert.equal(syncContainer.Mounts.length, 1);

  for (const [path, expected] of [
    ['/health/live', { status: 'alive' }],
    ['/health', { status: 'ready', sqlite: 'available' }],
  ]) {
    const response = await fetch(`http://127.0.0.1:4319${path}`, {
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
  }
  const forbidden = await fetch('http://127.0.0.1:4319/health', {
    headers: { Origin: 'https://example.com' },
  });
  assert.equal(forbidden.status, 403);

  const reference = readFileSync(
    new URL('./fixtures/reference.png', import.meta.url),
  );
  const session = await fetch('http://127.0.0.1:4319/orders');
  const cookie = session.headers.get('set-cookie').split(';')[0];
  const imported = await fetch('http://127.0.0.1:4319/manage/materials', {
    method: 'POST',
    headers: {
      cookie,
      Origin: 'http://127.0.0.1:4319',
      'X-Flow-Management': '1',
      'Content-Type': 'application/octet-stream',
      'X-Flow-Filename': 'fixture.png',
    },
    body: reference,
  });
  assert.equal(imported.status, 200);
  const material = await imported.json();
  let api = await localClient();
  const order = await api('/manage/orders', {
    id: randomUUID(),
    name: 'Docker order fixture',
    products: [
      {
        id: randomUUID(),
        name: 'Produto fixture',
        information: 'Fixture sintética',
        materials: [material.id],
        referenceId: material.id,
        groups: [{ id: randomUUID(), format: 'factory', count: 1 }],
      },
    ],
  });

  executeNode(`import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync('/data/flow-batch.sqlite');
    db.exec("INSERT INTO application_metadata (key, value) VALUES ('container-test', 'preserved')");
    console.log(JSON.stringify({wal: db.prepare('PRAGMA journal_mode').get().journal_mode}));
    db.close();`);
  const marker = join(destination, '.flow-batch-foundation.json');
  const before = statSync(marker).mtimeMs;
  assert.equal(
    JSON.parse(readFileSync(join(destination, 'manifest.json'), 'utf8'))
      .manifest_version,
    3,
  );
  const build = JSON.parse(readFileSync(marker, 'utf8')).build;

  // Synthetic queue state in this test project's own SQLite volume only.
  executeNode(`import { DatabaseSync } from 'node:sqlite';
    import { randomUUID,webcrypto } from 'node:crypto';
    import { taskInputSchema } from '@flow-batch/protocol';
    import { ClientStore } from './dist/persistence/clients.js';
    import { QueueDatabase } from './dist/queue/database.js';
    import { QueueRepository } from './dist/queue/repository.js';
    const db=new DatabaseSync('/data/flow-batch.sqlite');
    const keys=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
    const jwk=await webcrypto.subtle.exportKey('jwk',keys.publicKey);
    const clients=new ClientStore(db);
    const receipt=await clients.request('a'.repeat(32),{kty:'EC',crv:'P-256',x:jwk.x,y:jwk.y});
    clients.decide(receipt.requestId,true);
    const repository=new QueueRepository(new QueueDatabase(db));
    const makeTask=(take)=>taskInputSchema.parse({taskKey:randomUUID(),product:'Docker fixture',video:'Queue restart',format:'9:16',take,references:[],original:{imagePrompt:'original prompt',videoPrompt:'video prompt',copy:'  original copy  '},executor:'simulation',simulation:{durationMs:100,scenario:'success'},maxAttempts:3});
    const tasks=repository.enqueue(receipt.clientId,randomUUID(),[makeTask('Hook'),makeTask('CTA')]);
    repository.control(receipt.clientId,true);
    if(!repository.claim(tasks[0].id,randomUUID())) throw new Error('Could not persist dispatch intent');
    console.log('Synthetic queue dispatch intent and unsent task persisted');
    db.close();`);

  compose('down'); // Deliberately preserve SQLite across container recreation.
  docker(['volume', 'inspect', `${project}_sqlite_data`]);
  compose('up', '-d', '--wait', '--wait-timeout', '60');
  assert.ok(
    statSync(marker).mtimeMs > before,
    'sync must run again without --build',
  );
  assert.equal(JSON.parse(readFileSync(marker, 'utf8')).build, build);
  const persisted = executeNode(`import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync('/data/flow-batch.sqlite');
    console.log(db.prepare("SELECT value FROM application_metadata WHERE key = 'container-test'").get().value);
    db.close();`);
  assert.equal(persisted, 'preserved');
  api = await localClient();
  assert.equal(
    (await api(`/manage/orders/${order.number}`)).order.id,
    order.id,
  );
  assert.deepEqual(
    await api(`/manage/materials/${material.id}`, undefined, true),
    reference,
  );
  await api(`/manage/orders/${order.id}/cancel`, {});
  assert.equal(
    (await api('/manage/cleanup', { ids: [material.id] })).removed,
    1,
  );

  const queue = JSON.parse(
    executeNode(`import { DatabaseSync } from 'node:sqlite';
    const db=new DatabaseSync('/data/flow-batch.sqlite',{readOnly:true});
    const rows=db.prepare('SELECT state,input,attempt_count FROM queue_tasks ORDER BY sequence').all();
    console.log(JSON.stringify({states:rows.map(row=>row.state),attempts:rows.map(row=>row.attempt_count),copies:rows.map(row=>JSON.parse(row.input).original.copy),running:db.prepare('SELECT running FROM queue_controls').get().running}));
    db.close();`),
  );
  assert.deepEqual(queue, {
    states: ['uncertain', 'queued'],
    attempts: [1, 0],
    copies: ['  original copy  ', '  original copy  '],
    running: 0,
  });
  console.log(
    'Docker: build, health, loopback, isolation, sync on both starts, SQLite/material persistence, cleanup and uncertain/pending queue recovery passed.',
  );
  console.log(`Synthetic test volume preserved: ${project}_sqlite_data`);
  console.log(`Logs and extension: ${directory}`);
} finally {
  compose('down');
}
