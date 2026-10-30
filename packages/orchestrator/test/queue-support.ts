import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import {
  taskInputSchema,
  type TaskInput,
  type QueueProgress,
} from '@flow-batch/protocol';
import { fixture, pair, approve } from './support.js';
import { QueueDatabase } from '../src/queue/database.js';
import { QueueRepository } from '../src/queue/repository.js';
import { QueueMutations } from '../src/queue/mutations.js';

export function taskInput(overrides: Partial<TaskInput> = {}): TaskInput {
  return taskInputSchema.parse({
    taskKey: randomUUID(),
    product: 'Product',
    video: 'Video',
    format: '9:16',
    take: 'Hook',
    references: [{ root: 'inputs', relativePath: 'product/reference.png' }],
    original: {
      imagePrompt: ' {"prompt": "original"}\n',
      videoPrompt: ' Video\nprompt ',
      copy: ' Hook\nBody\nCTA ',
    },
    executor: 'simulation',
    simulation: { durationMs: 100, scenario: 'success' },
    maxAttempts: 3,
    ...overrides,
  });
}
export async function queueFixture(t: TestContext): Promise<
  Awaited<ReturnType<typeof fixture>> & {
    clientId: string;
    repository: QueueRepository;
    mutations: QueueMutations;
    queueDatabase: QueueDatabase;
  }
> {
  const f = await fixture(t);
  const receipt = await pair(f);
  await approve(f, receipt);
  const queueDatabase = new QueueDatabase(f.database);
  return {
    ...f,
    clientId: receipt.clientId,
    queueDatabase,
    repository: new QueueRepository(queueDatabase),
    mutations: new QueueMutations(queueDatabase),
  };
}
export function progress(
  taskId: string,
  attemptId: string,
  state: 'submitted' | 'generating' | 'download_pending' | 'completed',
): QueueProgress {
  const base = {
    type: 'queue-progress' as const,
    taskId,
    attemptId,
    generationId: `sim-${attemptId}`,
  };
  return state === 'completed'
    ? {
        ...base,
        state,
        result: {
          simulated: true,
          outputFile: null,
          description: 'Test simulation',
        },
      }
    : { ...base, state };
}
