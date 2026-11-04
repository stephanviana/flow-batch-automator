import { spawnSync } from 'node:child_process';

for (const format of ['pov', 'full-pov', 'seller']) {
  const result = spawnSync(
    process.execPath,
    ['scripts/validate-browser.mjs', `--format=${format}`],
    {
      stdio: 'inherit',
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '.cache/browsers' },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
