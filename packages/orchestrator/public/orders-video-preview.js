import { element } from './orders-elements.js';

export function referenceVideoPreview(parent, product, material, api) {
  const details = element(parent, 'details');
  element(
    details,
    'summary',
    `${product} · vídeo de referência: ${material.name}`,
  );
  let url = null;
  let generation = 0;
  function dispose() {
    generation++;
    details.querySelector('video')?.pause();
    details.querySelector('video')?.remove();
    if (url) URL.revokeObjectURL(url);
    url = null;
  }
  details.addEventListener('toggle', async () => {
    if (!details.open) {
      dispose();
      return;
    }
    const request = ++generation;
    details.querySelector('.error')?.remove();
    try {
      const blob = await api(
        `/manage/materials/${material.id}`,
        undefined,
        {},
        true,
      );
      if (!details.open || !details.isConnected || request !== generation)
        return;
      url = URL.createObjectURL(blob);
      const video = element(details, 'video', '', 'reference-video');
      video.src = url;
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      video.setAttribute('aria-label', `Referência de ${product}`);
    } catch (error) {
      if (details.open && request === generation)
        element(details, 'p', error.message, 'error');
    }
  });
  return dispose;
}
