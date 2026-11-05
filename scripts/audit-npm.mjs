import { auditPackage } from './npm/audit.mjs';
import { releaseMetadata } from './npm/manifest.mjs';
try {
  const release = await releaseMetadata();
  console.log(
    JSON.stringify(await auditPackage(release.artifact, release), null, 2),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
