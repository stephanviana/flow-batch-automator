import { existsSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  libraryBackupSchema,
  instructionFileSchema,
  preparationFormatSchema,
  type PreparationFormat,
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
import { consolidatedDocument, validateLibrary } from './routing.js';
import {
  documentText,
  documentSections,
  LIBRARY_DOCUMENT,
} from './document.js';

const metadataSchema = z.strictObject({
  version: z.literal(1),
  libraryId: z.uuid(),
  current: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
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
  constructor(readonly root: string) {
    directory(root);
    directory(join(root, '.historico'));
    if (!existsSync(join(root, 'biblioteca.json'))) {
      atomicWrite(
        join(root, 'biblioteca.json'),
        JSON.stringify(
          { version: 1, libraryId: randomUUID(), current: null },
          null,
          2,
        ) + '\n',
      );
      if (
        !existsSync(join(root, 'instrucoes')) &&
        !existsSync(join(root, LIBRARY_DOCUMENT))
      )
        writeDraft(root, { [LIBRARY_DOCUMENT]: documentText() });
    }
    this.metadata();
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
    const id = this.metadata().current;
    if (!id)
      throw new HttpError(
        409,
        'Pacote ainda não configurado. Importe suas instruções antes de preparar pedidos.',
      );
    return this.revision(id);
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
  status(): {
    libraryId: string;
    revision: string | null;
    draftHash: string;
    changed: boolean;
    files: string[];
    configured: boolean;
    problem: string | null;
    format: 'document' | 'files';
  } {
    const metadata = this.metadata(),
      draft = this.draft();
    let problem: string | null = null;
    try {
      validateLibrary(draft.files);
    } catch (error) {
      problem =
        error instanceof Error ? error.message : 'Configuração incompleta.';
    }
    return {
      libraryId: metadata.libraryId,
      revision: metadata.current,
      draftHash: draft.hash,
      changed:
        !metadata.current || draft.hash !== filesHash(this.current().files),
      files: Object.keys(draft.files).sort(),
      configured: problem === null,
      problem,
      format:
        draft.files[LIBRARY_DOCUMENT] === undefined ? 'files' : 'document',
    };
  }
  capture(
    formats: PreparationFormat[] = preparationFormatSchema.options,
  ): LibraryRevision {
    const draft = this.draft();
    validateLibrary(draft.files, formats);
    if (this.draft().hash !== draft.hash)
      throw new HttpError(
        409,
        'Os arquivos de instruções mudaram durante a leitura. Tente reservar novamente.',
      );
    if (
      this.metadata().current &&
      filesHash(this.current().files) === draft.hash
    )
      return this.current();
    return this.publishFiles(
      draft.files,
      this.metadata().libraryId,
      'Captura automática das instruções',
    );
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
    instructionFileSchema.parse(path);
    const files = this.checkDraft(expected);
    if (files[LIBRARY_DOCUMENT] !== undefined && path !== LIBRARY_DOCUMENT)
      throw new HttpError(
        409,
        'Atualize biblioteca.md; as demais instruções são seções desse documento.',
      );
    libraryFilesSchema.parse({ ...files, [path]: text });
    if (path === LIBRARY_DOCUMENT) {
      if (Object.keys(files).some((file) => file !== LIBRARY_DOCUMENT))
        throw new HttpError(
          409,
          'Converta os arquivos separados antes de salvar biblioteca.md.',
        );
      documentSections(text);
    }
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
    return this.publishFiles(files, this.metadata().libraryId, message);
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
      for (const folder of [LIBRARY_DOCUMENT, 'instrucoes']) {
        if (existsSync(join(this.root, folder))) {
          renameSync(join(this.root, folder), join(archive, folder));
          archived.push(folder);
        }
        if (existsSync(join(staged, folder))) {
          renameSync(join(staged, folder), join(this.root, folder));
          installed.push(folder);
        }
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
  importDocument(text: string, expected: string): object {
    this.checkDraft(expected);
    const files = libraryFilesSchema.parse({ [LIBRARY_DOCUMENT]: text });
    validateLibrary(files);
    this.replaceDraft(files);
    return this.status();
  }
  convert(expected: string): object {
    const files = this.checkDraft(expected);
    if (files[LIBRARY_DOCUMENT] !== undefined) return this.status();
    return this.importDocument(consolidatedDocument(files), expected);
  }
  export(): LibraryBackup {
    const metadata = this.metadata();
    return libraryBackupSchema.parse({
      version: 1,
      libraryId: metadata.libraryId,
      current: metadata.current,
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
    if (backup.current !== null && !ids.has(backup.current))
      throw new HttpError(400, 'Backup sem a revisão publicada.');
    backup.draft = Object.fromEntries(
      Object.entries(backup.draft).filter(
        ([path]) => instructionFileSchema.safeParse(path).success,
      ),
    );
    validateLibrary(backup.draft);
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
