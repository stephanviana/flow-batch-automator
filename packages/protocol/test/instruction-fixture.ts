import type * as FixtureModule from '../../../scripts/test-support/instruction-package.mjs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
export const instructions = createRequire(import.meta.url)(
  resolve('../../scripts/test-support/instruction-package.mjs'),
) as typeof FixtureModule;
