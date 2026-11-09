import type { DatabaseSync } from 'node:sqlite';
import type { LibraryRevision } from '@flow-batch/protocol';
import type { ProductionOrder } from '../orders/repository.js';
import type { LibraryStore } from './store.js';
import { instructionPaths, animationText } from './routing.js';
import { ORDER_EXECUTION_POLICY } from '../agent-client/workflow.js';
import { resolvedFiles } from './resolution.js';

export class LibraryBindings {
  constructor(
    private readonly database: DatabaseSync,
    readonly library: LibraryStore,
  ) {}
  capture(order: ProductionOrder): LibraryRevision {
    return this.library.capture([
      ...new Set(
        order.products.flatMap((product) =>
          product.groups.map((group) => group.format),
        ),
      ),
    ]);
  }
  templates(revision: LibraryRevision): string {
    return animationText(revision.files);
  }
  bind(
    orderId: string,
    leaseId: string,
    captured?: LibraryRevision,
  ): LibraryRevision {
    const row = this.database
      .prepare(
        'SELECT revision FROM order_library_bindings WHERE order_id=? AND lease_id=?',
      )
      .get(orderId, leaseId);
    if (row) return this.library.revision(String(row.revision));
    const revision = captured ?? this.library.capture();
    this.database
      .prepare(
        'INSERT INTO order_library_bindings(order_id,lease_id,revision) VALUES (?,?,?)',
      )
      .run(orderId, leaseId, revision.revision);
    return revision;
  }
  context(order: ProductionOrder, leaseId: string): object {
    const revision = this.bind(order.id, leaseId);
    const formats = [
      ...new Set(
        order.products.flatMap((product) =>
          product.groups.map((group) => group.format),
        ),
      ),
    ];
    const paths = instructionPaths(revision.files, formats);
    const files = resolvedFiles(revision.files);
    return {
      libraryId: revision.libraryId,
      revision: revision.revision,
      instructions: paths.map((path) => ({ path, text: files[path] })),
      rules:
        'Leia todas as instruções retornadas e os materiais reais. Para consultar outro documento na preparação, use flow_library_read com a revision desta reserva; edições locais só passam a valer em novas reservas. As regras comuns e a base dos formatos selecionados já estão reunidas; não leia outros formatos do catálogo. O servidor renderiza automaticamente os templates de animação desta mesma revisão. Se houver incompatibilidade, informe o diagnóstico da API; não investigue o código da aplicação. ' +
        ORDER_EXECUTION_POLICY,
    };
  }
}
