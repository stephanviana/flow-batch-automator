# Animação — templates derivados da Copy V10

Estes templates recebem a fala aprovada do [agente de copy](copy.md).
A referência desta etapa é a **imagem gerada para o take**, usada como frame
inicial. No CTA, use exatamente a imagem gerada no Body da mesma variação;
não gere outra vendedora. Os vídeos têm falas próprias e compartilham o mesmo
frame inicial. A foto original do produto continua na etapa anterior de imagem.

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
sem placeholders. Campos editoriais ou o mapa de fontes não entram na fala.

## Fábrica — gancho com trabalhadores visíveis

Aplicável aos quatro formatos de fábrica quando o frame contém a equipe. A
coreografia preserva a composição e a lógica física específica do formato.

```text
Animate the reference image as one continuous {{duracao_segundos}}-second live-action shot with a fully locked static camera, preserving the exact framing, perspective, and viewing angle.

All visible workers look at the camera, point at the products, and energetically shout the exact same line together in chorus:

{{fala}}

Every visible worker speaks simultaneously in perfect unison with synchronized lip movements. After speaking, they keep naturally presenting and celebrating the products.

Workers move naturally. Keep the camera and static structural elements stable. Any visible functional mechanism should operate realistically, and any interacting products should move accordingly.

Treat the spoken line as audio and lip-sync direction only. Never visualize, illustrate, or literalize words from the dialogue. Keep the reference image as the complete visual world; preserve existing physical scene elements and do not introduce new screen-layer graphics or symbolic elements. Raw live-action footage only. Keep everything else the same.

Visual exclusions: overlays, motion graphics, animated graphics, embellishments, shopping-cart icons, CTA buttons, notification icons, bell icons, app interface, UI, HUD, pop-ups, banners, lower thirds, captions, subtitles, floating text, speech bubbles, stickers, emojis, arrows, price graphics, discount graphics, promotional badges, decorative animations, particles, transitions, graphic VFX.
```

## Vendedora — Body e CTA

No Full Vendedora, este mesmo template também pode renderizar o gancho, porque a
apresentadora é a pessoa visível da cena. Isso não transforma o gancho em coro.
Foi acrescentada a restrição de não estender os braços ou inflar a escala do
produto, para compatibilizar o gesto com as regras visuais V27.

```text
Animate the reference image as one continuous, unbroken live-action shot with no scene cuts.

The presenter maintains eye contact and uses subtle gestures synchronized with the speech. Preserve the product's support and placement from the reference: products resting directly on the fixed counter stay on that counter; products held directly in her hands stay close to the torso with relaxed arms. Keep the complete product unit intact and at its original physical scale. Do not lift the entire counter display, extend products toward the lens, or introduce any tray, basket, serving board, portable display base, accessory or bonus item absent from the reference.

The presenter says in Brazilian Portuguese with accurate lip-sync:

{{fala}}

Subtle handheld UGC camera.

Treat the spoken line as audio and lip-sync direction only. Never visualize, illustrate, or literalize words from the dialogue. Mentions of TikTok, TikTok Shop, shopping carts, clicking, offers, prices, discounts, urgency, notifications, or any CTA remain spoken audio only and must not create visual elements. Keep the reference image as the complete visual world; preserve existing physical scene elements and do not introduce new screen-layer graphics or symbolic elements. Raw live-action UGC footage only. Keep everything else the same.

Visual exclusions: overlays, motion graphics, animated graphics, embellishments, shopping-cart icons, CTA buttons, notification icons, bell icons, app interface, UI, HUD, pop-ups, banners, lower thirds, captions, subtitles, floating text, speech bubbles, stickers, emojis, arrows, price graphics, discount graphics, promotional badges, decorative animations, particles, transitions, graphic VFX.
```

## POV — gancho em primeira pessoa

A pessoa cujas mãos aparecem fala fora do enquadramento. A voz é uma instrução ao
mesmo modelo de vídeo, sem serviço de TTS, coro, apresentadora adicional ou rosto
inventado. A qualidade do áudio ainda depende de validação na conta real.

```text
Animate the reference image as one continuous {{duracao_segundos}}-second live-action shot in strict first-person POV, preserving the exact product identity, internal kit structure, true-to-life scale, framing and environment.

Only the same adult feminine hands remain visible, naturally holding and subtly presenting the complete product. Keep the product close to its original position, with realistic contact, stable proportions and gentle movements. Do not add a face, mouth, presenter, extra person or additional hands. No scene cuts, product transformation, exaggerated demonstration or artificial camera movement.

The person holding the product speaks naturally off-camera in Brazilian Portuguese, saying exactly:

{{fala}}

Use one natural voice at a clear conversational pace. No chorus and no visible lip-sync. Preserve the first-person viewpoint and subtle handheld UGC realism throughout the shot.

Treat the spoken line as audio direction only. Mentions of TikTok, shopping carts, clicking, offers, prices, urgency or any CTA remain spoken audio only. Preserve physical scene elements from the reference and introduce no screen-layer graphics or symbolic elements. Raw live-action footage only.

Visual exclusions: overlays, motion graphics, animated graphics, embellishments, shopping-cart icons, CTA buttons, notification icons, bell icons, app interface, UI, HUD, pop-ups, banners, lower thirds, captions, subtitles, floating text, speech bubbles, stickers, emojis, arrows, price graphics, discount graphics, promotional badges, decorative animations, particles, transitions, graphic VFX.
```
