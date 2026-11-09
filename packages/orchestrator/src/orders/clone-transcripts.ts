import type { Preparation } from '@flow-batch/protocol';
import { HttpError } from '../security/errors.js';

export function verifyClonedTranscripts(
  variations: Preparation['variations'],
): void {
  const originals = new Map<
    string,
    NonNullable<Preparation['variations'][number]['cloneVideo']>['transcript']
  >();
  for (const variation of variations) {
    const clone = variation.cloneVideo;
    if (clone?.mode !== 'preserve-copy') continue;
    const previous = originals.get(clone.materialId);
    if (
      previous &&
      (['hook', 'body', 'cta'] as const).some(
        (stage) => previous[stage] !== clone.transcript?.[stage],
      )
    )
      throw new HttpError(
        400,
        'Variações do mesmo vídeo devem manter a mesma transcrição original.',
      );
    originals.set(clone.materialId, clone.transcript);
  }
}
