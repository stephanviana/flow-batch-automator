import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { repositoryRoot } from './manifest.mjs';

const secrets = [
  [
    'private-key',
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/,
  ],
  ['npm-token', /\bnpm_[A-Za-z0-9]{36,}\b/],
  [
    'github-token',
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{40,})\b/,
  ],
  ['cloud-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bAIza[A-Za-z0-9_-]{35}\b/],
  ['api-secret', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}\b/],
  ['credential-url', /https?:\/\/[^\s/"'<>:@]+:[^\s/"'<>@]+@/],
];
const privateFiles =
  /(?:^|\/)(?:\.git|\.env(?:\.[^/]*)?|\.npmrc|\.netrc|\.aws|\.ssh|\.flow-batch-backups|\.modules\.yaml|\.pnpm-workspace-state-v1\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|lock\.yaml)(?:\/|$)|\.(?:sqlite(?:-wal|-shm)?|db|pem|key|p12|pfx|map|tsbuildinfo)$/i;
const personalPath =
  /(?:\/(?:home|Users)\/|\/mnt\/[a-z]\/Users\/|[A-Z]:[\\/]+Users[\\/]+)(?!USER(?:[\\/]|\b)|SEU_USUARIO(?:[\\/]|\b)|username(?:[\\/]|\b)|node(?:[\\/]|\b)|root(?:[\\/]|\b)|runner(?:[\\/]|\b)|example(?:[\\/]|\b))[A-Za-z0-9_.-]+/i;
export async function localPrivateLiterals() {
  const values = [repositoryRoot.replace(/\/$/, ''), homedir()];
  for (const [name, value] of Object.entries(process.env))
    if (
      /(?:TOKEN|SECRET|PASSWORD|API_KEY|AUTH_KEY)$/.test(name) &&
      value?.length >= 16
    )
      values.push(value);
  try {
    for (const line of (
      await readFile(join(repositoryRoot, '.env'), 'utf8')
    ).split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      if (match && /(?:TOKEN|SECRET|PASSWORD|KEY|DIR|PATH)$/.test(match[1])) {
        const value = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
        if (value.length >= 12) values.push(value);
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return [
    ...new Set(
      values.flatMap((value) => [
        value,
        value.replaceAll('\\', '\\\\'),
        encodeURI(value),
        value.replaceAll(/[/:\\]/g, '+'),
      ]),
    ),
  ];
}
function inspectText(value, label, literals, issues) {
  if (
    personalPath.test(value) ||
    /@file\+[^\s]*\+(?:home|Users)\+/i.test(value)
  )
    issues.push(`${label}: personal-path`);
  for (const [kind, pattern] of secrets)
    if (pattern.test(value)) issues.push(`${label}: ${kind}`);
  if (literals.some((literal) => literal && value.includes(literal)))
    issues.push(`${label}: local-private-value`);
}
export function inspectEntries(entries, literals, issues = []) {
  for (const [index, entry] of entries.entries()) {
    // Do not echo suspicious names or matched values: both can contain credentials.
    const safeLabel = `entry-${index}`;
    if (privateFiles.test(entry.path))
      issues.push(`${safeLabel}: forbidden-file`);
    inspectText(entry.path, safeLabel, literals, issues);
    inspectText(entry.link, safeLabel, literals, issues);
    inspectText(`${entry.owner}/${entry.group}`, safeLabel, literals, issues);
    inspectText(entry.metadata ?? '', safeLabel, literals, issues);
    if (
      [entry.owner, entry.group].some(
        (value) => value && !['root', '0'].includes(value),
      )
    )
      issues.push(`${safeLabel}: owner-metadata`);
    if (entry.type !== '0') continue;
    if (/\.(?:tgz|gz|zip|tar|7z)$/i.test(entry.path))
      issues.push(`${safeLabel}: unexpected-archive`);
    else
      inspectText(entry.content.toString('utf8'), safeLabel, literals, issues);
  }
  return issues;
}
