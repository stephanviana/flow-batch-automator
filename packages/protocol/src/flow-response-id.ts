export function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}
export function sameId(left: unknown, right: unknown): boolean {
  return (
    validId(left) &&
    validId(right) &&
    left.toLowerCase() === right.toLowerCase()
  );
}
const ASB_HOSTS = new Set(['lh3.googleusercontent.com', 'flow.google.com']);
const ASB_PATH = /^\/asb\/[a-zA-Z0-9_-]+(?:=[a-zA-Z0-9_,=-]+)?$/;

export function cdnUrl(value: unknown, kind: 'image' | 'video'): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.port ||
      url.username ||
      url.password ||
      url.hash
    )
      return null;
    if (
      url.hostname === 'flow-content.google' &&
      new RegExp(`^/${kind}/[a-zA-Z0-9_-]+$`).test(url.pathname)
    )
      return value;
    if (
      !url.search &&
      ASB_HOSTS.has(url.hostname) &&
      ASB_PATH.test(url.pathname)
    )
      return value;
    return null;
  } catch {
    return null;
  }
}
