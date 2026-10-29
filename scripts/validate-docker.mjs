import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

// An isolated Compose project and synthetic state; never attach an existing volume.
const project = `flow-batch-validation-${randomBytes(4).toString('hex')}`;
const directory = resolve('.cache', project);
const destination = join(directory, 'extension');
mkdirSync(destination, { recursive: true });
const environment = {
  ...process.env,
  WIN_EXTENSION_DIR: destination,
  INPUT_DIR: resolve('inputs'),
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
    container.Mounts.find((mount) => mount.Destination === '/inputs').RW,
    false,
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
  console.log(
    'Docker: build, health, loopback, isolation, sync on both starts and SQLite persistence passed.',
  );
  console.log(`Synthetic test volume preserved: ${project}_sqlite_data`);
  console.log(`Logs and extension: ${directory}`);
} finally {
  compose('down');
}
