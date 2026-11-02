import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import { fixture } from './support.js';
import { image } from './orders-support.js';
import { OrderRepository } from '../src/orders/repository.js';
import { MaterialFiles } from '../src/orders/material-files.js';

test('verified bytes allow immediate cleanup without outstanding file activity', async (t) => {
  const f = await fixture(t);
  const repository = new OrderRepository(f.database);
  const files = new MaterialFiles(
    f.config.materialsDirectory,
    repository.materials,
  );
  for (let iteration = 0; iteration < 20; iteration++) {
    const material = await files.import(Readable.from(image), 'ref.png');
    f.database
      .prepare('UPDATE materials SET created_at=1 WHERE id=?')
      .run(material.id);
    assert.deepEqual((await files.verifiedBytes(material.id)).bytes, image);
    assert.equal((await files.cleanup([material.id])).removed, 1);
    await setImmediate();
    assert.equal(repository.materials.get(material.id).available, false);
  }
});
