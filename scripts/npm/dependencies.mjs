import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  distributionManifest,
  parseReleaseJson,
  repositoryRoot,
} from './manifest.mjs';

export function graphPackages(dependencies, packages = new Map()) {
  for (const [name, dependency] of Object.entries(dependencies ?? {})) {
    const children = {
      ...dependency.dependencies,
      ...dependency.optionalDependencies,
    };
    if (dependency.version.startsWith('link:')) {
      graphPackages(children, packages);
      continue;
    }
    if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(dependency.version))
      throw new Error('Unsupported npm production dependency version.');
    const key = `${name}@${dependency.version}`;
    const edges = Object.fromEntries(
      Object.entries(children).map(([child, value]) => [child, value.version]),
    );
    const previous = packages.get(key);
    if (
      previous &&
      Object.entries(edges).some(
        ([name, version]) =>
          previous.edges[name] && previous.edges[name] !== version,
      )
    )
      throw new Error('Conflicting production dependency graph.');
    packages.set(key, {
      name,
      version: dependency.version,
      resolved: dependency.resolved ?? previous?.resolved,
      edges: { ...previous?.edges, ...edges },
    });
    graphPackages(children, packages);
  }
  return packages;
}
export function lockedProductionGraph() {
  const output = execFileSync(
    'pnpm',
    [
      '--filter',
      '@flow-batch/orchestrator',
      'list',
      '--prod',
      '--lockfile-only',
      '--depth',
      'Infinity',
      '--json',
    ],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  const projects = parseReleaseJson(output);
  if (projects.length !== 1 || projects[0].name !== '@flow-batch/orchestrator')
    throw new Error('Missing production lockfile graph.');
  return graphPackages(projects[0].dependencies);
}
function dependencyVersion(lock, owner, name) {
  let parent = owner;
  while (true) {
    const dependency =
      lock.packages[`${parent ? parent + '/' : ''}node_modules/${name}`];
    if (dependency) return dependency.version;
    if (!parent) return undefined;
    const boundary = parent.lastIndexOf('/node_modules/');
    parent = boundary < 0 ? '' : parent.slice(0, boundary);
  }
}
export function verifyDependencyLock(
  lock,
  release,
  expected = lockedProductionGraph(),
) {
  const manifest = distributionManifest(release);
  if (
    lock.lockfileVersion !== 3 ||
    lock.name !== release.name ||
    lock.version !== release.version ||
    JSON.stringify(lock.packages?.['']?.dependencies) !==
      JSON.stringify(manifest.dependencies)
  )
    throw new Error('Invalid npm application lockfile.');
  const installed = new Set();
  for (const [path, dependency] of Object.entries(lock.packages)) {
    if (path === '') continue;
    const name = path.split('node_modules/').at(-1);
    const key = `${name}@${dependency.version}`;
    const url = new URL(dependency.resolved);
    if (
      !/^node_modules\//.test(path) ||
      path.includes('..') ||
      !expected.has(key) ||
      dependency.link ||
      dependency.dev ||
      url.protocol !== 'https:' ||
      url.hostname !== 'registry.npmjs.org' ||
      url.username ||
      url.password ||
      !/^sha512-[A-Za-z0-9+/]+=*$/.test(dependency.integrity)
    )
      throw new Error('Unverified production dependency in npm lockfile.');
    const source = expected.get(key);
    const canonical =
      source.resolved ??
      `https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${dependency.version}.tgz`;
    if (
      url.href !== new URL(canonical).href ||
      Object.entries(source.edges).some(
        ([child, version]) => dependencyVersion(lock, path, child) !== version,
      )
    )
      throw new Error(
        'The npm dependency resolution differs from the pnpm lockfile.',
      );
    installed.add(key);
  }
  if (installed.size !== expected.size)
    throw new Error('The npm dependency graph differs from the pnpm lockfile.');
}
export function productionOverrides(packages) {
  const versions = new Map();
  for (const pkg of packages.values()) {
    if (!versions.has(pkg.name)) versions.set(pkg.name, new Set());
    versions.get(pkg.name).add(pkg.version);
  }
  const overrides = Object.fromEntries(
    [...versions]
      .filter(([, values]) => values.size === 1)
      .map(([name, values]) => [name, [...values][0]]),
  );
  for (const pkg of packages.values()) {
    const edges = Object.fromEntries(
      Object.entries(pkg.edges).filter(
        ([name]) => versions.get(name)?.size > 1,
      ),
    );
    if (!Object.keys(edges).length) continue;
    const unique = versions.get(pkg.name).size === 1;
    overrides[unique ? pkg.name : `${pkg.name}@${pkg.version}`] = {
      ...(unique ? { '.': pkg.version } : {}),
      ...edges,
    };
  }
  return overrides;
}
export async function createDependencyLock(destination, release) {
  const expected = lockedProductionGraph();
  const overrides = productionOverrides(expected);
  const temporary = await mkdtemp(
    join(repositoryRoot, '.cache/npm-resolution-'),
  );
  try {
    await writeFile(
      join(temporary, 'package.json'),
      JSON.stringify({ ...distributionManifest(release), overrides }, null, 2) +
        '\n',
    );
    const options = {
      cwd: temporary,
      stdio: 'inherit',
      env: {
        ...process.env,
        npm_config_cache: join(repositoryRoot, '.cache/npm'),
      },
    };
    execFileSync(
      'npm',
      [
        'install',
        '--package-lock-only',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--registry',
        release.registry,
      ],
      options,
    );
    const lock = parseReleaseJson(
      await readFile(join(temporary, 'package-lock.json'), 'utf8'),
    );
    verifyDependencyLock(lock, release, expected);
    await writeFile(
      join(destination, 'runtime/package-lock.json'),
      JSON.stringify(lock, null, 2) + '\n',
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
