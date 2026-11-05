import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  PREPARATION_CONTRACT,
  instructionFileSchema,
  orderPublicationSchema,
  preparationFormatLabels,
  preparationFormatSchema,
  usesSingleImage,
} from '@flow-batch/protocol';
import type { LocalSessions } from '../security/local-session.js';
import type { LibraryStore } from '../library/store.js';

export function registerLibrary(
  app: FastifyInstance,
  sessions: LocalSessions,
  library: LibraryStore,
): void {
  app.get('/manage/agent/capabilities', async (request) => {
    sessions.require(request);
    return {
      contract: PREPARATION_CONTRACT,
      library: library.status(),
      formats: preparationFormatSchema.options.map((format) => ({
        format,
        label: preparationFormatLabels[format],
        images: usesSingleImage(format) ? 1 : 2,
        videos: 3,
      })),
      publicationSchema: z.toJSONSchema(orderPublicationSchema),
      workflow:
        'Reserve o pedido, leia o contexto e os materiais reais, crie e publique a preparação. As instruções vêm exclusivamente da pasta local configurada. Cada reserva captura seus arquivos automaticamente. Consumo exige autorização no chat para o hash exato. Não analise o código da aplicação.',
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
        path: instructionFileSchema,
        revision: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
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
          path: instructionFileSchema,
          text: z.string().max(262144),
          expectedDraftHash: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .parse(request.body);
      return library.save(path, text, expectedDraftHash);
    },
  );
  app.get('/manage/library/export', async (request, reply) => {
    sessions.require(request);
    reply.header(
      'Content-Disposition',
      'attachment; filename="flow-instrucoes.json"',
    );
    return library.export();
  });
}
