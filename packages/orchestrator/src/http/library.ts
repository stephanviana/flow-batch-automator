import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  PREPARATION_CONTRACT,
  libraryFileSchema,
  orderPublicationSchema,
  preparationFormatLabels,
  preparationFormatSchema,
  usesSingleImage,
} from '@flow-batch/protocol';
import type { LocalSessions } from '../security/local-session.js';
import type { LibraryStore } from '../library/store.js';

const expectation = z.string().regex(/^[a-f0-9]{64}$/);
export function registerLibrary(
  app: FastifyInstance,
  sessions: LocalSessions,
  library: LibraryStore,
): void {
  app.get('/manage/agent/capabilities', async (request) => {
    sessions.require(request);
    return {
      contract: PREPARATION_CONTRACT,
      library: library.current().revision,
      formats: preparationFormatSchema.options.map((format) => ({
        format,
        label: preparationFormatLabels[format],
        images: usesSingleImage(format) ? 1 : 2,
        videos: 3,
      })),
      publicationSchema: z.toJSONSchema(orderPublicationSchema),
      workflow:
        'Reserve o pedido, leia o contexto completo e os materiais reais, crie a preparação, publique e apresente a prévia. Despache somente após autorização explícita no chat para o hash exato. Não analise o código da aplicação para preparar pedidos.',
    };
  });
  app.get('/manage/library', async (request) => {
    sessions.require(request);
    return library.status();
  });
  app.post('/manage/library/file', async (request) => {
    sessions.require(request);
    const { path, revision } = z
      .strictObject({
        path: libraryFileSchema,
        revision: expectation.optional(),
      })
      .parse(request.body);
    const files = revision
      ? library.revision(revision).files
      : library.draft().files;
    return { path, text: files[path] ?? '' };
  });
  app.post(
    '/manage/library/save',
    { bodyLimit: 1_048_576 },
    async (request) => {
      sessions.require(request);
      const { path, text, expectedDraftHash } = z
        .strictObject({
          path: libraryFileSchema,
          text: z.string().max(262144),
          expectedDraftHash: expectation,
        })
        .parse(request.body);
      return library.save(path, text, expectedDraftHash);
    },
  );
  app.post('/manage/library/publish', async (request) => {
    sessions.require(request);
    const { expectedDraftHash, message } = z
      .strictObject({
        expectedDraftHash: expectation,
        message: z.string().max(500).default('Atualização da biblioteca'),
      })
      .parse(request.body);
    const { files, ...revision } = library.publish(expectedDraftHash, message);
    return { ...revision, fileCount: Object.keys(files).length };
  });
  app.post('/manage/library/restore', async (request) => {
    sessions.require(request);
    const { revision, expectedDraftHash } = z
      .strictObject({ revision: expectation, expectedDraftHash: expectation })
      .parse(request.body);
    return library.restore(revision, expectedDraftHash);
  });
  app.get('/manage/library/export', async (request, reply) => {
    sessions.require(request);
    reply.header(
      'Content-Disposition',
      'attachment; filename="flow-biblioteca.json"',
    );
    return library.export();
  });
  app.post(
    '/manage/library/import-preview',
    { bodyLimit: 67_108_864 },
    async (request) => {
      sessions.require(request);
      const { backup, changes, conflicts } = library.preview(request.body);
      return {
        expectedDraftHash: library.draft().hash,
        libraryId: backup.libraryId,
        revision: backup.current,
        revisions: backup.revisions.length,
        changes,
        conflicts,
      };
    },
  );
  app.post(
    '/manage/library/import',
    { bodyLimit: 67_108_864 },
    async (request) => {
      sessions.require(request);
      const { backup, expectedDraftHash } = z
        .strictObject({ backup: z.unknown(), expectedDraftHash: expectation })
        .parse(request.body);
      return library.import(backup, expectedDraftHash);
    },
  );
}
