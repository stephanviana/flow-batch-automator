import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  PREPARATION_CONTRACT,
  instructionFileSchema,
  orderSubmissionSchema,
  preparationFormatLabels,
  preparationFormatSchema,
  usesSingleImage,
} from '@flow-batch/protocol';
import type { LocalSessions } from '../security/local-session.js';
import type { LibraryStore } from '../library/store.js';
import { ORDER_EXECUTION_POLICY } from '../agent-client/workflow.js';
import { LIBRARY_DOCUMENT, resolvedFiles } from '../library/document.js';

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
      publicationSchema: z.toJSONSchema(orderSubmissionSchema),
      workflow:
        'Reserve o pedido, leia o contexto e os materiais reais, crie e publique a preparação. As instruções vêm exclusivamente da pasta local configurada. Cada reserva captura seus arquivos automaticamente. Não analise o código da aplicação. ' +
        ORDER_EXECUTION_POLICY,
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
        path: instructionFileSchema.default(LIBRARY_DOCUMENT),
        revision: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .parse(request.body);
    const files = revision
      ? library.revision(revision).files
      : library.draft().files;
    return { path, text: files[path] ?? resolvedFiles(files)[path] ?? '' };
  });
  app.post(
    '/manage/library/save',
    { bodyLimit: 16_777_216 },
    async (request) => {
      sessions.require(request);
      const { path, text, expectedDraftHash } = z
        .strictObject({
          path: instructionFileSchema.default(LIBRARY_DOCUMENT),
          text: z.string().max(8_388_608),
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
