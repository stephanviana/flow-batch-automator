import type { ClientStore } from '../persistence/clients.js';
import { HttpError } from '../security/errors.js';
import { DispatchRecovery } from './dispatch-recovery.js';
import type { OrderRepository, ProductionOrder } from './repository.js';

export interface DispatchClosureInput {
  reviewHash: string;
  preparationHash: string;
  note: string;
}

export class DispatchClosure {
  constructor(
    private readonly repository: OrderRepository,
    private readonly clients: ClientStore,
  ) {}

  close(
    number: number,
    dispatchId: string,
    input: DispatchClosureInput,
  ): ProductionOrder {
    return this.repository.transaction(() => {
      const order = this.repository.get(number);
      if (!order.dispatches.some((dispatch) => dispatch.id === dispatchId))
        throw new HttpError(404, 'Grupo não pertence a este pedido.');
      const previous = this.repository.database
        .prepare(
          'SELECT review_hash,preparation_hash,note FROM dispatch_closures WHERE dispatch_id=?',
        )
        .get(dispatchId);
      if (previous) {
        if (
          previous.review_hash !== input.reviewHash ||
          previous.preparation_hash !== input.preparationHash ||
          previous.note !== input.note
        )
          throw new HttpError(
            409,
            'Este grupo já foi encerrado. Atualize o diagnóstico.',
          );
        return order;
      }
      const review = new DispatchRecovery(this.repository, this.clients).review(
        number,
        dispatchId,
      );
      if (
        review.reviewHash !== input.reviewHash ||
        review.preparationHash !== input.preparationHash
      )
        throw new HttpError(
          409,
          'O grupo mudou desde a revisão. Atualize o diagnóstico antes de encerrar.',
        );
      if (!review.canClose) throw new HttpError(409, review.closeReason);
      this.repository.database
        .prepare(
          'INSERT INTO dispatch_closures(dispatch_id,review_hash,preparation_hash,note,closed_at) VALUES (?,?,?,?,?)',
        )
        .run(
          dispatchId,
          input.reviewHash,
          input.preparationHash,
          input.note,
          Date.now(),
        );
      return this.repository.get(number);
    });
  }
}
