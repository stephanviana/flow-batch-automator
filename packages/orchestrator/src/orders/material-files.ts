import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, createReadStream } from 'node:fs';
import {
  mkdir,
  link,
  unlink,
  lstat,
  realpath,
  readFile,
} from 'node:fs/promises';
import { resolve } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MATERIAL_LIMIT, type Material } from '@flow-batch/protocol';
import type { MaterialStore } from './material-store.js';
import { HttpError } from '../security/errors.js';

function detectMime(prefix: Buffer, name: string): Material['mime'] {
  if (
    prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image/png';
  if (prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255)
    return 'image/jpeg';
  if (
    prefix.toString('ascii', 0, 4) === 'RIFF' &&
    prefix.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  if (prefix.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  if (/\.(txt|md|json)$/i.test(name) && !prefix.includes(0))
    return /\.json$/i.test(name) ? 'application/json' : 'text/plain';
  throw new HttpError(400, 'Use JPEG, PNG, WebP, PDF, TXT, Markdown ou JSON.');
}

export class MaterialFiles {
  constructor(
    readonly directory: string,
    readonly store: MaterialStore,
  ) {}

  private async root(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if ((await realpath(this.directory)) !== resolve(this.directory))
      throw new HttpError(409, 'Armazenamento de materiais inválido.');
  }

  async import(stream: Readable, name: string): Promise<Material> {
    await this.root();
    const temporary = resolve(this.directory, `.${randomUUID()}.upload`);
    const digest = createHash('sha256');
    let size = 0,
      prefix = Buffer.alloc(0);
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done): void {
        size += chunk.length;
        if (size > MATERIAL_LIMIT)
          return done(new HttpError(413, 'Cada material deve ter até 8 MB.'));
        digest.update(chunk);
        if (prefix.length < 512)
          prefix = Buffer.concat([
            prefix,
            chunk.subarray(0, 512 - prefix.length),
          ]);
        done(null, chunk);
      },
    });
    try {
      await pipeline(
        stream,
        meter,
        createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
      );
      if (!size) throw new HttpError(400, 'O material está vazio.');
      const mime = detectMime(prefix, name),
        sha256 = digest.digest('hex');
      this.store.byHash(sha256);
      try {
        await link(temporary, resolve(this.directory, sha256));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      return this.store.preserve({ name, mime, size, sha256 });
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  private async resolveMaterial(
    id: string,
  ): Promise<{ material: Material; filename: string }> {
    const material = this.store.get(id);
    if (!material.available)
      throw new HttpError(
        410,
        'Material removido. Importe a referência novamente para uma nova preparação.',
      );
    await this.root();
    const filename = resolve(this.directory, material.sha256);
    try {
      const stat = await lstat(filename);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size !== material.size
      )
        throw new Error('Invalid asset');
    } catch {
      throw new HttpError(
        409,
        'Cópia do material indisponível no armazenamento local.',
      );
    }
    return { material, filename };
  }

  async read(id: string): Promise<{ material: Material; stream: Readable }> {
    const { material, filename } = await this.resolveMaterial(id);
    return { material, stream: createReadStream(filename) };
  }

  async verifiedBytes(
    id: string,
  ): Promise<{ material: Material; bytes: Buffer }> {
    const { material, filename } = await this.resolveMaterial(id);
    const bytes = await readFile(filename);
    if (createHash('sha256').update(bytes).digest('hex') !== material.sha256)
      throw new HttpError(
        409,
        'O conteúdo do material não corresponde ao arquivo importado.',
      );
    return { material, bytes };
  }

  async cleanup(ids: string[]): Promise<{ removed: number; bytes: number }> {
    await this.root();
    let removed = 0,
      bytes = 0;
    for (const id of ids) {
      const candidate = this.store
        .candidates()
        .find((material) => material.id === id);
      if (!candidate) continue;
      this.store.database
        .prepare("UPDATE materials SET state='deleting' WHERE id=?")
        .run(id);
      try {
        await unlink(resolve(this.directory, candidate.sha256));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new HttpError(
            409,
            'Não foi possível remover a cópia local. Tente a limpeza novamente.',
          );
      }
      this.store.database
        .prepare("UPDATE materials SET state='deleted' WHERE id=?")
        .run(id);
      removed++;
      bytes += candidate.size;
    }
    return { removed, bytes };
  }
}
