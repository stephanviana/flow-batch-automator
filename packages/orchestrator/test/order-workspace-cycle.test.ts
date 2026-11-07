import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable } from 'node:stream';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, management } from './support.js';
import { draft, image, publication } from './orders-support.js';
import { OrderRepository } from '../src/orders/repository.js';
import { OrderVisibility } from '../src/orders/visibility.js';
import { MaterialFiles } from '../src/orders/material-files.js';
import {
  checkout,
  orderWorkspace,
  publishWorkspace,
} from '../src/agent-client/workspace.js';
import type { AgentApi } from '../src/agent-client/http.js';

test('reused public numbers use distinct checkout directories and cannot publish an old preparation into the new order', async (t) => {
  const f = await fixture(t),
    headers = await management(f),
    repository = new OrderRepository(f.database);
  const files = new MaterialFiles(
    f.config.materialsDirectory,
    repository.materials,
  );
  const material = await files.import(Readable.from(image), 'foto.png');
  const first = repository.create(draft(material.id));
  const api = (async (
    path: string,
    body?: object,
    binary?: boolean,
  ): Promise<unknown> => {
    const response = await f.app.inject({
      method: body ? 'POST' : 'GET',
      url: path,
      headers,
      ...(body ? { payload: body } : {}),
    });
    if (response.statusCode !== 200) throw new Error(response.json().error);
    return binary ? response.rawPayload : response.json();
  }) as AgentApi;
  const root = join(f.config.materialsDirectory, 'checkout', '1');
  const old = await checkout(api, 1, 'fixture', root);
  const preparation = await publication(old.order, old.leaseId);
  await api(`/manage/orders/${first.id}/prepare`, preparation);
  await writeFile(old.preparationFile, JSON.stringify(preparation));
  const original = await readFile(join(root, 'pedido.json'));
  new OrderVisibility(repository).clear([first.id]);
  const next = repository.create(draft(material.id));
  const fresh = await checkout(api, 1, 'fixture', root);
  assert.equal(fresh.order.id, next.id);
  assert.equal(fresh.directory, orderWorkspace(root, next));
  assert.notEqual(fresh.directory, old.directory);
  assert.deepEqual(await readFile(join(root, 'pedido.json')), original);
  assert.equal(
    JSON.parse(await readFile(join(fresh.directory, 'pedido.json'), 'utf8'))
      .order.id,
    next.id,
  );
  await assert.rejects(
    api(`/manage/orders/${next.id}/prepare`, preparation),
    /reserva|Reserva/,
  );
  await assert.rejects(
    publishWorkspace(api, root),
    /removido|preparação|Preparação/,
  );
  assert.equal(repository.get(next.id).state, 'preparing');
});
