export {
  stableImportId,
  importTaskKey,
  assertImportSize,
  buildImportPlan,
  importFingerprint,
  approveImport,
} from '@flow-batch/protocol';

export function referenceFiles(files: readonly File[]): Map<string, File> {
  const indexed = new Map<string, File>();
  for (const file of files) {
    const path = file.name;
    if (indexed.has(path))
      throw new Error(
        `Referência ambígua: ${path}. Selecione apenas um arquivo para esse caminho.`,
      );
    indexed.set(path, file);
  }
  return indexed;
}
