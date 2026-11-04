# Animação — Fábrica, POV, Vendedora e clonagem

Estes templates recebem a fala aprovada do [agente de copy](copy.md).
A referência desta etapa é a **imagem gerada para o take**, usada como frame
inicial. Nos formatos com duas imagens, o CTA usa a imagem gerada no Body.
No Full POV e Full Vendedora, Body e CTA usam diretamente a imagem gerada no
gancho. Os vídeos têm falas próprias; cada take começa na sua imagem vinculada,
sem prolongar automaticamente o último frame do vídeo anterior. A foto original do produto continua na etapa anterior de imagem.

O padrão atual é Omni 1.1 Flash Frames, somente frame inicial, 8 s/720p. Não
presuma lip-sync, duração da fala ou qualidade real comprovados só porque o texto
passou na validação. O modelo e os parâmetros persistidos no take governam o envio.

## REGRA CRÍTICA — DIÁLOGO NÃO É DIREÇÃO VISUAL

As falas das copys servem SOMENTE para áudio, lip-sync, expressão facial e gestos naturais.

NUNCA transforme palavras ou conceitos citados na fala em elementos visuais novos.

Isso vale especialmente para termos comerciais ou de interface, como:

- TikTok / TikTok Shop;
- carrinho laranja;
- clicar / botão;
- oferta / preço / desconto;
- urgência;
- notificação / sino;
- qualquer CTA verbal.

Esses termos devem permanecer SOMENTE NA FALA.

O vídeo deve parecer uma filmagem live-action real capturada pela câmera, e não uma peça editada com motion graphics.

A imagem de referência define o universo visual completo da cena. Preserve os objetos físicos, produtos, ambiente, textos, rótulos e sinalizações que já existirem fisicamente na referência. Não introduza novos elementos gráficos, simbólicos ou de interface por causa da copy.

Todo prompt técnico gerado deve terminar com o bloco ANTI-OVERLAY correspondente abaixo.

## Montagem sem placeholders na saída

Substitua `{{fala}}` pelo texto exato de uma cena, sem aspas ornamentais. No template
de fábrica e de POV, substitua `{{duracao_segundos}}` pela duração do take: 8 no padrão
atual. Para outra duração solicitada, revise primeiro a fala para caber nesse tempo;
não acelere a locução nem altere parâmetros de takes existentes.

Os marcadores só existem neste template. `original.videoPrompt` deve conter o
texto completo já renderizado, com o bloco final `Visual exclusions` integral e
sem placeholders. Campos editoriais ou o mapa de fontes não entram na fala. A fala
já deve estar dimensionada conforme a regra de duração de `copy.md`; se estiver
curta ou longa, revise a copy antes de renderizar o prompt. A direção de ritmo
não autoriza o modelo a acrescentar, repetir ou cortar palavras para ocupar tempo.

## Fábrica — gancho com trabalhadores visíveis

Aplicável aos quatro formatos de fábrica quando o frame contém a equipe. A
coreografia preserva a composição e a lógica física específica do formato.

```text
Animate the reference image as one continuous {{duracao_segundos}}-second live-action shot with a fully locked static camera, preserving the exact framing, perspective, and viewing angle.

All visible workers look at the camera, point at the products, and energetically shout the exact same line together in chorus:

{{fala}}

Every visible worker starts the line promptly and speaks simultaneously in perfect unison with synchronized lip movements, at a clear natural pace across most of the shot. Finish with only a brief natural pause while presenting the products. Do not leave a long silent celebration, stretch syllables, rush, add, omit or repeat words.

Workers move naturally. Keep the camera and static structural elements stable. Any visible functional mechanism should operate realistically, and any interacting products should move accordingly.

Treat the spoken line as audio and lip-sync direction only. Never visualize, illustrate, or literalize words from the dialogue. Keep the reference image as the complete visual world; preserve existing physical scene elements and do not introduce new screen-layer graphics or symbolic elements. Raw live-action footage only. Keep everything else the same.

Visual exclusions: overlays, motion graphics, animated graphics, embellishments, shopping-cart icons, CTA buttons, notification icons, bell icons, app interface, UI, HUD, pop-ups, banners, lower thirds, captions, subtitles, floating text, speech bubbles, stickers, emojis, arrows, price graphics, discount graphics, promotional badges, decorative animations, particles, transitions, graphic VFX.
```

## Vendedora — gancho, Body e CTA

No Full Vendedora, este mesmo template também pode renderizar o gancho, porque a
apresentadora é a pessoa visível da cena. Isso não transforma o gancho em coro.
Foi acrescentada a restrição de não estender os braços ou inflar a escala do
produto, para compatibilizar o gesto com as regras visuais V27.
No gancho, a fala pede reação imediata; no Body, explicação; no CTA, fechamento.
O template acompanha a função da fala sem acrescentar novos placeholders.
No Full Vendedora, uma única imagem do gancho é compartilhada com Body e CTA.
Nos formatos mistos, este template usa a imagem do Body, compartilhada com CTA.
Não aproximar o produto da lente nem trocar identidade, roupa ou cenário.

```text
Animate the reference image as one continuous, unbroken live-action shot with no scene cuts.

The presenter maintains eye contact and uses subtle gestures synchronized with the speech. Match her performance to the line's function: an immediate expressive reaction for an opening, a clear explanatory delivery for product arguments, or a direct confident delivery for a purchase invitation. Use only her single natural voice, with no chorus or additional speaker. Preserve the product's support and placement from the reference: products resting directly on the fixed counter stay on that counter; products held directly in her hands stay close to the torso with relaxed arms. Keep the complete product unit intact and at its original physical scale. Do not lift the entire counter display, extend products toward the lens, or introduce any tray, basket, serving board, portable display base, accessory or bonus item absent from the reference.

The presenter says in Brazilian Portuguese with accurate lip-sync:

{{fala}}

Begin the exact line promptly, speak naturally through most of the shot, and finish with only a brief natural pause. Do not add, omit or repeat words, stretch syllables, rush the delivery or insert long silent pauses. Subtle handheld UGC camera.

Treat the spoken line as audio and lip-sync direction only. Never visualize, illustrate, or literalize words from the dialogue. Mentions of TikTok, TikTok Shop, shopping carts, clicking, offers, prices, discounts, urgency, notifications, or any CTA remain spoken audio only and must not create visual elements. Keep the reference image as the complete visual world; preserve existing physical scene elements and do not introduce new screen-layer graphics or symbolic elements. Raw live-action UGC footage only. Keep everything else the same.

Visual exclusions: overlays, motion graphics, animated graphics, embellishments, shopping-cart icons, CTA buttons, notification icons, bell icons, app interface, UI, HUD, pop-ups, banners, lower thirds, captions, subtitles, floating text, speech bubbles, stickers, emojis, arrows, price graphics, discount graphics, promotional badges, decorative animations, particles, transitions, graphic VFX.
```

## POV — primeira pessoa no gancho ou nos três takes

No POV + Vendedora, este template aplica-se ao gancho; no Full POV, aos três
takes, com a mesma imagem gerada no gancho e a mesma voz.
A pessoa cujas mãos aparecem fala fora do enquadramento. A voz é uma instrução ao
mesmo modelo de vídeo, sem serviço de TTS, coro, apresentadora adicional ou rosto
inventado. A qualidade do áudio ainda depende de validação na conta real.

```text
Animate the reference image as one continuous {{duracao_segundos}}-second live-action shot in strict first-person POV, preserving the exact product identity, internal kit structure, true-to-life scale, framing and environment.

Only the same two adult feminine hands remain visible, subtly presenting the complete product. Preserve its original support: products resting directly on the fixed counter stay on that counter, with the hands gently touching or pointing at visible details; handheld products remain naturally held near their original position. Keep realistic contact, stable proportions and gentle movements. Do not lift a large supported kit, separate its components, introduce a tray, basket or portable base, or invent a function or demonstration absent from the initial image. Do not add a face, mouth, presenter, extra person, additional hands or visible face in reflections. No scene cuts, product transformation, exaggerated demonstration or artificial camera movement.

The person interacting with the product speaks naturally off-camera in Brazilian Portuguese, saying exactly:

{{fala}}

Use one natural voice at a clear conversational pace, starting promptly and covering most of the shot with only a brief natural pause at the end. No chorus and no visible lip-sync. Do not add, omit or repeat words, stretch syllables, rush the narration or substitute silent hand movements for the spoken line. Preserve the first-person viewpoint and subtle handheld UGC realism throughout the shot.

Treat the spoken line as audio direction only. Mentions of TikTok, TikTok Shop, shopping carts, clicking, offers, prices, discounts, urgency, notifications or any CTA remain spoken audio only. Preserve physical scene elements, labels and markings from the reference and introduce no screen-layer graphics or symbolic elements. Raw live-action footage only.

Visual exclusions: overlays, motion graphics, animated graphics, embellishments, shopping-cart icons, CTA buttons, notification icons, bell icons, app interface, UI, HUD, pop-ups, banners, lower thirds, captions, subtitles, floating text, speech bubbles, stickers, emojis, arrows, price graphics, discount graphics, promotional badges, decorative animations, particles, transitions, graphic VFX.
```

## Clonagem — direção adaptada do vídeo de referência

No formato `clone`, o agente assiste ao vídeo selecionado no grupo e preenche
`cloneVideo.analysis` e `cloneVideo.directions` para cada take. O compilador usa
as direções como texto, sem invocar IA. Elas devem preservar os objetos e o apoio
da imagem gerada; Body e CTA começam com exatamente a mesma imagem. A fala fica
somente em `copy`, e as direções identificam quem fala, enquadramento e gestos.

```text
Animate the reference image as one continuous {{duracao_segundos}}-second live-action shot in 9:16, preserving the exact product identity, complete kit structure, true-to-life scale, physical support and scene elements of the initial frame.

Adapted scene and performance direction:
{{direcao}}

The speaker identified in the direction begins promptly and says exactly this line in Brazilian Portuguese, at a natural clear pace through most of the shot, ending with only a brief natural pause. Do not add, omit or repeat words, stretch syllables, rush or insert long silent gaps:

{{fala}}

Use only the people and physical objects already visible in the initial frame. Preserve the product on its counter or in the same hands; do not lift a large supported kit or invent trays, baskets or portable bases. When only hands are visible, use off-camera voice with no visible lip-sync or added face. Do not add a chorus unless the visible group and the adapted direction explicitly require it.

Treat the dialogue as audio direction only. Do not visualize spoken references to shopping carts, prices, promotions, clicking or platform interfaces. Keep all action physically plausible and preserve the generated initial image as the complete visual world. Do not reproduce the reference video's overlays, captions, logos added in editing, graphic effects or transitions.

Visual exclusions: overlays, motion graphics, animated graphics, embellishments, shopping-cart icons, CTA buttons, notification icons, bell icons, app interface, UI, HUD, pop-ups, banners, lower thirds, captions, subtitles, floating text, speech bubbles, stickers, emojis, arrows, price graphics, discount graphics, promotional badges, decorative animations, particles, transitions, graphic VFX.
```
