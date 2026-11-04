import { existsSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  libraryBackupSchema,
  libraryFileSchema,
  libraryFilesSchema,
  libraryRevisionSchema,
  type LibraryBackup,
  type LibraryFiles,
  type LibraryRevision,
} from '@flow-batch/protocol';
import { HttpError } from '../security/errors.js';
import {
  atomicWrite,
  directory,
  draftFiles,
  readText,
  writeDraft,
} from './files.js';
import { validateLibrary } from './routing.js';

const metadataSchema = z.strictObject({
  version: z.literal(1),
  libraryId: z.uuid(),
  current: z.string().regex(/^[a-f0-9]{64}$/),
});
export function filesHash(files: LibraryFiles): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ),
    )
    .digest('hex');
}
function revisionHash(revision: Omit<LibraryRevision, 'revision'>): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        revision.libraryId,
        revision.createdAt,
        revision.message,
        filesHash(revision.files),
      ]),
    )
    .digest('hex');
}
export class LibraryStore {
  constructor(
    readonly root: string,
    seed: LibraryFiles,
  ) {
    directory(root);
    directory(join(root, '.historico'));
    for (const name of ['instrucoes', 'fluxos', 'swipes'])
      directory(join(root, name));
    if (!existsSync(join(root, 'biblioteca.json'))) {
      const existing = draftFiles(root);
      const files = { ...seed, ...existing };
      validateLibrary(files);
      writeDraft(root, files);
      this.publishFiles(files, randomUUID(), 'Biblioteca inicial');
    }
    this.current();
  }
  private metadata(): z.infer<typeof metadataSchema> {
    return metadataSchema.parse(
      JSON.parse(readText(join(this.root, 'biblioteca.json'))),
    );
  }
  revision(id: string): LibraryRevision {
    z.string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(id);
    const path = join(this.root, '.historico', `${id}.json`);
    if (!existsSync(path))
      throw new HttpError(404, 'Revisão da biblioteca não encontrada.');
    const revision = libraryRevisionSchema.parse(JSON.parse(readText(path)));
    if (revision.revision !== id || revisionHash(revision) !== id)
      throw new HttpError(
        409,
        'A revisão da biblioteca foi alterada fora do histórico.',
      );
    return revision;
  }
  current(): LibraryRevision {
    return this.revision(this.metadata().current);
  }
  draft(): { files: LibraryFiles; hash: string } {
    const files = draftFiles(this.root);
    return { files, hash: filesHash(files) };
  }
  private checkDraft(expected: string): LibraryFiles {
    const draft = this.draft();
    if (draft.hash !== expected)
      throw new HttpError(
        409,
        'O rascunho mudou. Atualize a biblioteca antes de continuar.',
      );
    return draft.files;
  }
  status(): object {
    const current = this.current(),
      draft = this.draft();
    return {
      libraryId: current.libraryId,
      revision: current.revision,
      draftHash: draft.hash,
      changed: draft.hash !== filesHash(current.files),
      files: Object.keys(draft.files).sort(),
      revisions: this.history().map(({ files: _files, ...revision }) => ({
        ...revision,
        fileCount: Object.keys(_files).length,
      })),
    };
  }
  history(): LibraryRevision[] {
    const libraryId = this.metadata().libraryId;
    return readdirSync(join(this.root, '.historico'))
      .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      .map((name) => this.revision(name.slice(0, -5)))
      .filter((revision) => revision.libraryId === libraryId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  save(path: string, text: string, expected: string): object {
    libraryFileSchema.parse(path);
    const files = this.checkDraft(expected);
    libraryFilesSchema.parse({ ...files, [path]: text });
    writeDraft(this.root, { [path]: text });
    return this.status();
  }
  private publishFiles(
    files: LibraryFiles,
    libraryId: string,
    message: string,
  ): LibraryRevision {
    const body = { libraryId, createdAt: Date.now(), message, files };
    const revision = libraryRevisionSchema.parse({
      ...body,
      revision: revisionHash(body),
    });
    atomicWrite(
      join(this.root, '.historico', `${revision.revision}.json`),
      JSON.stringify(revision),
    );
    atomicWrite(
      join(this.root, 'biblioteca.json'),
      JSON.stringify(
        { version: 1, libraryId, current: revision.revision },
        null,
        2,
      ) + '\n',
    );
    return revision;
  }
  publish(expected: string, message: string): LibraryRevision {
    const files = this.checkDraft(expected);
    validateLibrary(files);
    return this.publishFiles(files, this.current().libraryId, message);
  }
  private replaceDraft(files: LibraryFiles): void {
    const archive = join(this.root, '.rascunhos', randomUUID());
    directory(archive);
    const staged = join(archive, '.novo');
    directory(staged);
    writeDraft(staged, files);
    const archived: string[] = [],
      installed: string[] = [];
    try {
      for (const folder of ['instrucoes', 'fluxos', 'swipes']) {
        directory(join(staged, folder));
        if (existsSync(join(this.root, folder))) {
          renameSync(join(this.root, folder), join(archive, folder));
          archived.push(folder);
        }
        renameSync(join(staged, folder), join(this.root, folder));
        installed.push(folder);
      }
    } catch (error) {
      for (const folder of installed)
        renameSync(join(this.root, folder), join(staged, folder));
      for (const folder of archived)
        renameSync(join(archive, folder), join(this.root, folder));
      throw error;
    }
  }
  restore(id: string, expected: string): object {
    this.checkDraft(expected);
    this.replaceDraft(this.revision(id).files);
    return this.status();
  }
  export(): LibraryBackup {
    const current = this.current();
    return libraryBackupSchema.parse({
      version: 1,
      libraryId: current.libraryId,
      current: current.revision,
      revisions: this.history(),
      draft: this.draft().files,
    });
  }
  preview(raw: unknown): {
    backup: LibraryBackup;
    changes: string[];
    conflicts: string[];
  } {
    const backup = libraryBackupSchema.parse(raw);
    const ids = new Set<string>();
    for (const revision of backup.revisions) {
      if (
        revision.libraryId !== backup.libraryId ||
        revision.revision !== revisionHash(revision) ||
        ids.has(revision.revision)
      )
        throw new HttpError(400, 'Histórico de backup inconsistente.');
      ids.add(revision.revision);
    }
    if (!ids.has(backup.current))
      throw new HttpError(400, 'Backup sem a revisão publicada.');
    validateLibrary(
      backup.revisions.find((revision) => revision.revision === backup.current)!
        .files,
    );
    const current = this.draft().files;
    const changes = [
      ...new Set([...Object.keys(current), ...Object.keys(backup.draft)]),
    ].filter((path) => current[path] !== backup.draft[path]);
    return {
      backup,
      changes,
      conflicts: changes.filter((path) => current[path] !== undefined),
    };
  }
  import(raw: unknown, expected: string): object {
    this.checkDraft(expected);
    const { backup } = this.preview(raw);
    for (const revision of backup.revisions) {
      const path = join(this.root, '.historico', `${revision.revision}.json`);
      if (!existsSync(path)) atomicWrite(path, JSON.stringify(revision));
      else this.revision(revision.revision);
    }
    this.replaceDraft(backup.draft);
    atomicWrite(
      join(this.root, 'biblioteca.json'),
      JSON.stringify(
        { version: 1, libraryId: backup.libraryId, current: backup.current },
        null,
        2,
      ) + '\n',
    );
    return this.status();
  }
}
