function completeClone(variation) {
  variation.cloneVideo.scenePlan = {
    scenes: [{ id: 'continuous', image: variation.hookImage }],
    takes: { hook: 'continuous', body: 'continuous', cta: 'continuous' },
  };
  delete variation.hookImage;
  if (variation.cloneVideo.mode === 'preserve-copy')
    variation.cloneVideo.transcript = { ...variation.copy };
  variation.cloneVideo.analysis =
    'Quadro azul sintético observado na referência; adaptação de teste, sem execução paga.';
  variation.cloneVideo.directions = {
    hook: 'Keep only hands visible, with off-camera voice.',
    body: 'Keep the product on the counter.',
    cta: 'Use the same initial frame and speak naturally.',
  };
}

export function completeCloningPreparation(preparation) {
  for (const product of preparation.products)
    for (const variation of product.variations) {
      variation.hookImage = {
        prompt: 'Foto sintética do produto nas mãos.',
        negative_prompt: 'Sem texto.',
        aspect_ratio: '9:16',
      };
      if (variation.format !== 'clone')
        variation.presenterImage = {
          prompt: 'Produto sintético apoiado no balcão.',
          negative_prompt: 'Sem bandeja.',
          aspect_ratio: '9:16',
        };
      variation.copy = {
        hook: 'Conheça $& e $$ deste produto.',
        body: 'Veja os detalhes.',
        cta: 'Confira no carrinho.',
      };
      if (variation.cloneVideo) completeClone(variation);
    }
  return preparation;
}
