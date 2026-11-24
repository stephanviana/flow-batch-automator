export function cloneScenePlan(pattern) {
  return {
    scenes: [...new Set(pattern)].map((id) => ({
      id,
      image: {
        prompt: `Produto sintético na cena ${id}.`,
        negative_prompt: 'Sem texto ou interface.',
        aspect_ratio: '9:16',
      },
    })),
    takes: { hook: pattern[0], body: pattern[1], cta: pattern[2] },
  };
}
