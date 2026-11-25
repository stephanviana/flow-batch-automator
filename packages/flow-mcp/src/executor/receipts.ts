import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { FlowBrowserError } from '../contracts.js';

export class AttemptReceipts {
  constructor(private readonly home: string) {}

  async record(attemptId: string): Promise<void> {
    z.uuid().parse(attemptId);
    const directory = join(this.home, 'attempts');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(
        join(directory, `${attemptId}.json`),
        JSON.stringify({ attemptId, receivedAt: Date.now() }),
        { flag: 'wx', mode: 0o600 },
      );
    } catch {
      throw new FlowBrowserError(
        'attempt_receipt_failed',
        'A tentativa já foi recebida ou seu recibo não pôde ser persistido. Confira o histórico antes de qualquer novo envio.',
      );
    }
  }

  async reference(assetId: string): Promise<Uint8Array> {
    z.uuid().parse(assetId);
    return readFile(join(this.home, 'references', `${assetId}.bin`));
  }
}
