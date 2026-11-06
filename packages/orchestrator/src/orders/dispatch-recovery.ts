import { z } from 'zod';
import {
  dispatchCommandSchema,
  dispatchFailureSchema,
  importImageCount,
  type DispatchCommand,
} from '@flow-batch/protocol';
import {
  contentHash,
  type OrderRepository,
  type ProductionOrder,
} from './repository.js';
import type { ClientStore } from '../persistence/clients.js';
import { HttpError } from '../security/errors.js';

const recordSchema = z.object({
  body: z.string(),
  body_hash: z.string(),
  state: z.string(),
  message: z.string(),
  failure: z.string().nullable(),
});
const batchSchema = z.object({
  status: z.string(),
  project_id: z.string().nullable(),
  creation_attempt_id: z.string().nullable(),
  revision: z.number(),
});
interface RecoveryContext {
  order: ProductionOrder;
  command: DispatchCommand;
  record: z.infer<typeof recordSchema>;
  batch: z.infer<typeof batchSchema> | undefined;
  queuedTasks: number;
  taskStates: { id: string; state: string; revision: number }[];
}
export interface DispatchReview {
  orderNumber: number;
  dispatchId: string;
  clientId: string;
  product: string;
  images: number;
  videos: number;
  preparationHash: string | null;
  reviewHash: string;
  canResume: boolean;
  canClose: boolean;
  closeReason: string;
  reason: string;
  batchStatus: string | null;
  failure: z.infer<typeof dispatchFailureSchema> | null;
}
export class DispatchRecovery {
  constructor(
    private readonly repository: OrderRepository,
    private readonly clients: ClientStore,
  ) {}
  private inspect(number: number, id: string): RecoveryContext {
    const order = this.repository.get(number);
    const raw = this.repository.database
      .prepare(
        "SELECT c.body,c.body_hash,CASE WHEN x.dispatch_id IS NULL THEN c.state ELSE 'cancelled' END AS state,c.message,c.failure,d.batch_id FROM dispatch_commands c JOIN order_dispatches d ON d.dispatch_id=c.id LEFT JOIN dispatch_closures x ON x.dispatch_id=c.id WHERE d.order_id=? AND c.id=?",
      )
      .get(order.id, id);
    if (!raw) throw new HttpError(404, 'Despacho não pertence a este pedido.');
    const record = recordSchema.parse(raw),
      command = dispatchCommandSchema.parse(JSON.parse(record.body));
    const batch = batchSchema
      .optional()
      .parse(
        this.repository.database
          .prepare(
            'SELECT status,project_id,creation_attempt_id,revision FROM flow_batches WHERE id=? AND client_id=?',
          )
          .get(String(raw.batch_id), command.clientId),
      );
    const taskStates = this.repository.database
      .prepare(
        'SELECT id,state,revision FROM queue_tasks WHERE batch_id=? ORDER BY sequence',
      )
      .all(String(raw.batch_id))
      .map((task) => ({
        id: String(task.id),
        state: String(task.state),
        revision: Number(task.revision),
      }));
    return {
      order,
      command,
      record,
      batch,
      queuedTasks: taskStates.length,
      taskStates,
    };
  }
  private closeReason(context: RecoveryContext): string {
    if (context.record.state !== 'blocked')
      return 'Este grupo não está bloqueado ou já foi encerrado.';
    if (context.batch?.status === 'creating')
      return 'A criação do projeto ainda está em andamento. Confira o resultado antes de encerrar.';
    if (
      context.taskStates.some(
        (task) => !['completed', 'failed', 'cancelled'].includes(task.state),
      )
    )
      return 'Há takes pendentes, em execução ou com resultado incerto. Revise-os antes de encerrar o grupo.';
    return '';
  }

  private reason(context: RecoveryContext): string {
    const { record, batch, command, order, queuedTasks } = context;
    if (record.state !== 'blocked') return 'Este despacho não está bloqueado.';
    if (queuedTasks)
      return 'O grupo já possui takes registrados. Confira os resultados no Flow; esta operação não repete takes.';
    if (
      !batch ||
      batch.status !== 'draft' ||
      batch.project_id ||
      !batch.creation_attempt_id ||
      batch.revision < 2
    )
      return 'Não há confirmação de falha anterior à criação. Confira o projeto no Flow; resultados incertos não permitem esta retomada.';
    const failure = record.failure
      ? dispatchFailureSchema.parse(JSON.parse(record.failure))
      : null;
    if (
      failure
        ? failure.sent
        : record.message !==
          'O projeto não foi criado. Confira o acesso ao Flow e solicite revisão do pedido pelo chat.'
    )
      return 'O registro não comprova que a criação deixou de ser enviada. É necessária revisão no Flow.';
    if (
      !order.preparation?.manifests.some(
        (manifest) => contentHash(manifest) === contentHash(command.manifest),
      )
    )
      return 'Os materiais do despacho não correspondem à preparação atual.';
    if (order.materials.some((material) => !material.available))
      return 'Há materiais indisponíveis no pedido.';
    const client = this.clients.get(command.clientId);
    if (!client?.authorizedAt || client.revokedAt)
      return 'A extensão original precisa estar autorizada.';
    return '';
  }
  review(number: number, id: string): DispatchReview {
    const context = this.inspect(number, id),
      { order, command, record, batch, queuedTasks } = context;
    const reason = this.reason(context);
    const closeReason = this.closeReason(context);
    return {
      orderNumber: number,
      dispatchId: id,
      clientId: command.clientId,
      product: command.manifest.tasks[0]!.product,
      images: importImageCount(command.manifest),
      videos: command.manifest.tasks.length,
      preparationHash: order.preparationHash,
      reviewHash: contentHash({
        preparation: order.preparationHash,
        body: record.body_hash,
        state: record.state,
        message: record.message,
        failure: record.failure,
        batch,
        queuedTasks,
        taskStates: context.taskStates,
      }),
      canResume: reason === '',
      canClose: closeReason === '',
      closeReason,
      reason:
        reason ||
        'Falha anterior ao envio da criação e nenhum take registrado. Uma retomada explícita pode preparar somente este grupo.',
      batchStatus: batch?.status ?? null,
      failure: record.failure
        ? dispatchFailureSchema.parse(JSON.parse(record.failure))
        : null,
    };
  }
  resume(
    number: number,
    id: string,
    reviewHash: string,
    preparationHash: string,
  ): ProductionOrder {
    return this.repository.transaction(() => {
      const context = this.inspect(number, id),
        database = this.repository.database;
      if (context.order.preparationHash !== preparationHash)
        throw new HttpError(
          409,
          'A preparação mudou. Revise o pedido novamente.',
        );
      if (
        database
          .prepare(
            'SELECT sequence FROM dispatch_recoveries WHERE dispatch_id=? AND review_hash=?',
          )
          .get(id, reviewHash)
      )
        return this.repository.get(context.order.id);
      const review = this.review(number, id);
      if (review.reviewHash !== reviewHash)
        throw new HttpError(
          409,
          'O despacho mudou desde a revisão. Consulte-o novamente.',
        );
      if (!review.canResume) throw new HttpError(409, review.reason);
      const now = Date.now(),
        command = context.command;
      const authorized = dispatchCommandSchema.parse({
        ...command,
        authorization: {
          ...command.authorization,
          approvedAt: now,
          expiresAt: now + 86_400_000,
        },
      });
      database
        .prepare(
          'INSERT INTO dispatch_recoveries(dispatch_id,review_hash,previous_body,previous_message,previous_failure,authorized_at) VALUES (?,?,?,?,?,?)',
        )
        .run(
          id,
          reviewHash,
          context.record.body,
          context.record.message,
          context.record.failure,
          now,
        );
      database
        .prepare(
          "UPDATE dispatch_commands SET body=?,body_hash=?,state='pending',message=?,failure=NULL WHERE id=?",
        )
        .run(
          JSON.stringify(authorized),
          contentHash(authorized),
          'Retomada deste grupo autorizada após revisão; aguardando a extensão.',
          id,
        );
      return this.repository.get(context.order.id);
    });
  }
}
