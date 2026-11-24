import {
  stableImportId,
  type FlowRevisionApproval,
  type FlowRevisionPreparation,
  type FlowRevisionSubmission,
  type FlowTakeRevision,
  type FlowExecute,
  type PreparationFormat,
  type OrderPublication,
  type TaskDetail,
} from '@flow-batch/protocol';
import { QueueDatabase, type TaskRecord } from '../queue/database.js';
import { FlowRevisionStore } from '../queue/flow-revisions.js';
import { FlowRetries } from '../queue/flow-retries.js';
import { FlowImages } from '../queue/flow-images.js';
import type { LibraryStore } from '../library/store.js';
import { instructionPaths } from '../library/routing.js';
import { resolvedFiles } from '../library/resolution.js';
import {
  contentHash,
  type OrderRepository,
  type ProductionOrder,
} from './repository.js';
import { HttpError } from '../security/errors.js';
import { TAKE_REVISION_EXECUTION_POLICY } from '../agent-client/workflow.js';

type Variation = OrderPublication['products'][number]['variations'][number];
export interface TakeRevisionReview {
  order: Pick<
    ProductionOrder,
    'id' | 'number' | 'name' | 'products' | 'materials'
  >;
  task: TaskDetail['task'];
  original: TaskRecord['input']['original'];
  current: TaskRecord['input']['original'];
  attempts: TaskDetail['attempts'];
  checkpoints: TaskDetail['checkpoints'];
  revisions: TaskDetail['revisions'];
  variation: Variation;
  sourceImage: FlowExecute['sourceImage'];
  canPrepare: boolean;
  blockedReason: string | null;
  context: {
    libraryId: string;
    revision: string;
    instructions: { path: string; text: string | undefined }[];
    rules: string;
  };
}

export class TakeRevisions {
  private readonly queue: QueueDatabase;
  private readonly revisions: FlowRevisionStore;
  constructor(
    private readonly orders: OrderRepository,
    private readonly library: LibraryStore,
  ) {
    this.queue = new QueueDatabase(orders.database);
    this.revisions = new FlowRevisionStore(this.queue);
  }

  private task(taskId: string): { order: ProductionOrder; record: TaskRecord } {
    const row = this.orders.database
      .prepare(
        'SELECT q.client_id,d.order_id FROM queue_tasks q JOIN order_dispatches d ON d.batch_id=q.batch_id WHERE q.id=?',
      )
      .get(taskId);
    if (!row) throw new HttpError(404, 'Take não encontrado neste pedido.');
    return {
      order: this.orders.get(String(row.order_id)),
      record: this.queue.task(taskId, String(row.client_id)),
    };
  }

  private source(record: TaskRecord): NonNullable<FlowExecute['sourceImage']> {
    if (
      record.input.executor !== 'google-flow' ||
      record.summary.state !== 'failed'
    )
      throw new HttpError(409, 'A revisão exige um take com falha confirmada.');
    const reason = new FlowRetries(this.queue).reason(record, true);
    if (reason) throw new HttpError(409, reason);
    const image = new FlowImages(this.orders.database).forAttempt(
      record,
      record.summary.attemptCount + 1,
    );
    if (!image)
      throw new HttpError(
        409,
        'Este take ainda não possui uma imagem confirmada para reutilizar.',
      );
    return image;
  }

  private async variation(
    order: ProductionOrder,
    record: TaskRecord,
  ): Promise<Variation> {
    for (const manifest of order.preparation?.manifests ?? [])
      for (const take of manifest.tasks) {
        const key = await stableImportId([
          'flow-import-v1',
          record.summary.batchId!,
          manifest.id,
          take.id,
        ]);
        if (key !== record.input.taskKey) continue;
        const variation = order.preparation?.products
          .flatMap((product) => product.variations)
          .find((variation) => variation.id === take.output?.groupId);
        if (variation) return variation;
      }
    throw new HttpError(
      409,
      'O take não corresponde a uma variação da preparação registrada.',
    );
  }

  async review(taskId: string): Promise<TakeRevisionReview> {
    const { order, record } = this.task(taskId);
    const variation = await this.variation(order, record);
    let sourceImage: FlowExecute['sourceImage'];
    let blockedReason: string | null = null;
    try {
      sourceImage = this.source(record);
    } catch (error) {
      blockedReason =
        error instanceof Error ? error.message : 'Revisão indisponível.';
    }
    const binding = order.preparation?.library;
    if (!binding)
      throw new HttpError(
        409,
        'A captura de instruções desta preparação não está disponível.',
      );
    const capture = this.library.revision(binding.revision);
    const files = resolvedFiles(capture.files);
    const formats: PreparationFormat[] = [variation.format];
    const detail = this.queue.detail(taskId, record.clientId);
    return {
      order: {
        id: order.id,
        number: order.number,
        name: order.name,
        products: order.products,
        materials: order.materials,
      },
      task: detail.task,
      original: record.input.original,
      current: this.revisions.original(record),
      attempts: detail.attempts,
      checkpoints: detail.checkpoints,
      revisions: detail.revisions,
      variation,
      sourceImage,
      canPrepare: blockedReason === null,
      blockedReason,
      context: {
        libraryId: capture.libraryId,
        revision: capture.revision,
        instructions: instructionPaths(capture.files, formats).map((path) => ({
          path,
          text: files[path],
        })),
        rules:
          'Leia integralmente as instruções capturadas e os materiais do pedido. Revise somente a fala e o prompt de vídeo deste take. Preserve os fatos do produto e a continuidade da variação. A imagem existente e os parâmetros de geração ficam vinculados à versão. ' +
          TAKE_REVISION_EXECUTION_POLICY,
      },
    };
  }

  private existing(taskId: string, input: FlowRevisionPreparation): boolean {
    const hash = contentHash(input.content);
    const previous = this.orders.database
      .prepare(
        'SELECT task_id,content_hash,task_revision FROM queue_flow_revisions WHERE id=?',
      )
      .get(input.requestId);
    if (previous) {
      if (
        previous.task_id !== taskId ||
        previous.content_hash !== hash ||
        previous.task_revision !== input.expectedRevision
      )
        throw new HttpError(
          409,
          'Este identificador de revisão já foi usado com outro conteúdo.',
        );
      return true;
    }
    return false;
  }

  private validateContent(
    variation: Variation,
    record: TaskRecord,
    input: FlowRevisionPreparation,
  ): void {
    const current = this.revisions.original(record);
    if (
      current.copy === input.content.copy &&
      current.videoPrompt === input.content.videoPrompt
    )
      throw new HttpError(
        400,
        'A nova versão deve alterar o conteúdo do take.',
      );
    if (
      variation.cloneVideo?.mode === 'preserve-copy' &&
      input.content.copy !== current.copy
    )
      throw new HttpError(
        409,
        'Este grupo preserva a fala conferida do vídeo de referência. Revise somente a direção de animação.',
      );
  }

  async prepare(
    taskId: string,
    input: FlowRevisionSubmission,
  ): Promise<FlowTakeRevision> {
    const snapshot = this.task(taskId);
    const variation = await this.variation(snapshot.order, snapshot.record);
    return this.orders.transaction(() => {
      const { record } = this.task(taskId);
      if (this.existing(taskId, input))
        return this.finishPreparation(taskId, input);
      if (record.summary.revision !== input.expectedRevision)
        throw new HttpError(
          409,
          'O take mudou. Consulte o diagnóstico novamente.',
        );
      const sourceImage = this.source(record);
      this.validateContent(variation, record, input);
      const attempt = this.queue
        .detail(taskId, record.clientId)
        .attempts.at(-1);
      if (!attempt)
        throw new HttpError(409, 'A tentativa de origem não está disponível.');
      this.orders.database
        .prepare(
          `INSERT INTO queue_flow_revisions(id,task_id,base_attempt_id,task_revision,input_hash,content,content_hash,source_image,created_at)
         SELECT ?,id,?,?,input_hash,?,?,?,? FROM queue_tasks WHERE id=?`,
        )
        .run(
          input.requestId,
          attempt.id,
          input.expectedRevision,
          JSON.stringify(input.content),
          contentHash(input.content),
          JSON.stringify(sourceImage),
          Date.now(),
          taskId,
        );
      return this.finishPreparation(taskId, input);
    });
  }

  private finishPreparation(
    taskId: string,
    input: FlowRevisionSubmission,
  ): FlowTakeRevision {
    if (input.execution)
      return this.authorize(taskId, {
        revisionId: input.requestId,
        userAuthorized: input.execution.userAuthorized,
        startQueue: input.execution.startQueue,
      });
    return this.revisions.get(taskId, input.requestId);
  }

  approve(taskId: string, input: FlowRevisionApproval): FlowTakeRevision {
    return this.orders.transaction(() => this.authorize(taskId, input));
  }

  private authorize(
    taskId: string,
    input: FlowRevisionApproval,
  ): FlowTakeRevision {
    const { record } = this.task(taskId);
    const revision = this.revisions.get(taskId, input.revisionId);
    if (revision.approvedAt !== null) return revision;
    const image = this.source(record);
    this.revisions.assertPending(record, input.revisionId);
    if (contentHash(image) !== contentHash(revision.sourceImage))
      throw new HttpError(
        409,
        'A imagem de origem mudou. Prepare uma nova versão.',
      );
    new FlowRetries(this.queue).schedule(
      record,
      {
        action: 'retry_flow',
        requestId: input.revisionId,
        taskId,
        expectedRevision: revision.taskRevision,
        confirmedFailure: true,
        approve: true,
        startQueue: input.startQueue,
      },
      Date.now(),
      'orders',
      input.revisionId,
    );
    return this.revisions.get(taskId, input.revisionId);
  }
}
