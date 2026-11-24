// Serialized in the isolated world. Read only image tiles belonging to the open project.
export function findImageTile(
  projectId: string,
  identifiers: string[],
): string[] {
  if (
    location.origin !== 'https://flow.google.com' ||
    location.pathname.match(/^\/project\/([^/]+)(?:\/|$)/)?.[1] !== projectId
  )
    return [];
  const wanted = new Set(identifiers.map((id) => id.toLowerCase()));
  const mediaIds = new Map<string, string>();
  for (const image of document.querySelectorAll<HTMLImageElement>(
    'flow-image-tile img[data-media-id]',
  )) {
    const id = image.getAttribute('data-media-id');
    if (!id || !/^[a-z0-9_-]{1,128}$/i.test(id)) continue;
    let matches = wanted.has(id.toLowerCase());
    if (!matches) {
      try {
        const url = new URL(image.currentSrc || image.src);
        const file =
          url.origin === 'https://flow-content.google' &&
          url.pathname.match(/^\/image\/([a-z0-9_-]+)$/i)?.[1];
        matches = !!file && wanted.has(file.toLowerCase());
      } catch {
        /* Some virtualized tiles have no image URL yet. */
      }
    }
    if (matches) mediaIds.set(id.toLowerCase(), id);
  }
  return [...mediaIds.values()];
}

export async function projectImageTiles(
  tabId: number,
  projectId: string,
  ids: string[],
): Promise<string[]> {
  const [reply] = await chrome.scripting.executeScript({
    target: { tabId },
    func: findImageTile,
    args: [projectId, ids],
  });
  return reply?.result ?? [];
}
