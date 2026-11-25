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
export function cdnUrl(value: unknown, kind: 'image' | 'video'): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname === 'flow-content.google' &&
      !url.port &&
      !url.username &&
      !url.password &&
      new RegExp(`^/${kind}/[a-zA-Z0-9_-]+$`).test(url.pathname)
      ? value
      : null;
  } catch {
    return null;
  }
}
