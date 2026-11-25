export const PROJECT = '11111111-1111-4111-8111-111111111111';
export const SOURCE = 'source-image';
export const GENERATED = 'generated-image';
export const OPERATION = 'video-operation';
export const VIDEO = 'video-media';
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=',
  'base64',
);
export const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from('ftypisom'),
  Buffer.alloc(20),
]);

export function envelope(rpcId: string): string {
  let payload: unknown[];
  if (rpcId === 'maseQ') payload = [['reference-image']];
  else if (rpcId === 'ogiZ0b') {
    const details = Array<unknown>(14).fill(null);
    details[13] = 'https://flow-content.google/image/image-file';
    payload = [
      [['image-operation', null, null, ['Image', [1, 0]], PROJECT]],
      [
        [
          GENERATED,
          null,
          'image-operation',
          null,
          null,
          null,
          [details, null, [1, 1]],
        ],
      ],
    ];
  } else {
    const details = Array<unknown>(14).fill(null);
    details[8] = [3];
    const clip = Array<unknown>(13).fill(null);
    clip[8] = 'https://flow-content.google/video/video-file';
    payload = [[OPERATION, PROJECT, VIDEO, null, null, details, null, [clip]]];
  }
  return `)]}'\n${JSON.stringify([['wrb.fr', rpcId, JSON.stringify(payload)]])}`;
}

export function generationHtml(
  credits = 12,
  imageModelAvailable = true,
): string {
  return `<!doctype html><html lang="en"><style>[hidden]{display:none!important} .page-container{height:200px;overflow:auto} flow-grid-tile-container{display:block;height:50px} .ProseMirror{min-height:40px;white-space:pre-wrap}</style>
  <button onclick="location.href='/project/${PROJECT}'">New project</button>
  <button aria-label="Flow Agent" aria-pressed="false">Flow Agent</button>
  <button aria-label="Add media menu" onclick="document.querySelector('#uploads').hidden=false">Add</button>
  <div id="uploads" hidden><button role="menuitem" onclick="document.querySelector('#file').click();document.querySelector('#uploads').hidden=true">Upload</button></div>
  <input id="file" type="file" hidden>
  <button aria-label="Settings trigger" onclick="document.querySelector('#settings').hidden=false">Settings</button>
  <div class="cdk-overlay-pane" id="settings" hidden>
    <div role="radiogroup">${radios(['Image', 'Video'], 'Image', 'mode')}</div>
    <div role="radiogroup">${radios(['Frames', 'Ingredients'], 'Frames', 'strategy')}</div>
    <div role="radiogroup">${radios(['9:16', '16:9'], '16:9', 'aspect')}</div>
    <button id="model-trigger" aria-label="Select model family" onclick="document.querySelector('#models').hidden=false">Model</button>
    <div id="models" hidden>${(imageModelAvailable ? ['Nano Banana Pro'] : [])
      .concat(['Nano Banana 2.1', 'Omni 1.1 Flash', 'Veo 3.1 - Lite'])
      .map(
        (name) =>
          `<button role="menuitem" onclick="document.querySelector('#model-trigger').textContent=this.textContent;document.querySelector('#models').hidden=true">${name}</button>`,
      )
      .join('')}</div>
    <div role="radiogroup">${radios(['360p', '720p'], '360p', 'resolution')}</div>
    <div role="radiogroup">${radios(['4s', '6s', '8s', '10s'], '4s', 'duration')}</div>
    <div role="radiogroup">${radios(['x1', 'x2'], 'x2', 'variants')}</div>
    <a href="https://support.google.com/" id="quote">0 credits</a>
  </div>
  <button aria-label="Add ingredients to the prompt box" onclick="showPicker()">Ingredients</button>
  <button aria-label="Start" onclick="showPicker()">Start</button>
  <div role="listbox" aria-label="Asset list" id="picker" hidden></div>
  <div class="ProseMirror" role="textbox" contenteditable="true"></div>
  <button aria-label="Start generation" id="generate">Generate</button>
  <div class="page-container" id="grid"></div>
  <script>
    window.editorValue='';
    document.querySelector('.ProseMirror').addEventListener('input',event=>{window.editorValue+=event.data??'\\n';});
    window.counts={images:0,videos:0}; window.prompts=[]; window.kind='image';
    const picture='data:image/png;base64,${PNG.toString('base64')}';
    function image(id){const tile=document.createElement('flow-grid-tile-container');tile.setAttribute('aria-label','Repeated title');tile.innerHTML='<flow-image-tile><img data-media-id="'+id+'" src="'+picture+'#'+id+'"></flow-image-tile>';document.querySelector('#grid').prepend(tile);}
    image('${SOURCE}');
    function showPicker(){const picker=document.querySelector('#picker');picker.replaceChildren();for(const img of document.querySelectorAll('#grid img')){const option=document.createElement('button');option.setAttribute('role','option');const clone=img.cloneNode();clone.removeAttribute('data-media-id');option.append(clone);option.onclick=()=>picker.hidden=true;picker.append(option);}picker.hidden=false;}
    async function rpc(id){await fetch('/_/AiSandboxAngularFrontend/data/batchexecute?rpcids='+id,{method:'POST',body:'synthetic'});}
    document.querySelector('#file').onchange=async()=>{await rpc('maseQ');image('reference-image');};
    document.querySelector('#generate').onclick=async()=>{window.prompts.push(window.editorValue);window.editorValue='';document.querySelector('.ProseMirror').textContent='';if(window.kind==='image'){window.counts.images++;await rpc('ogiZ0b');image('${GENERATED}');}else{window.counts.videos++;await rpc('eb1hJf');setTimeout(()=>rpc('jwpduf'),300);}};
    document.querySelectorAll('[role=radio]').forEach(radio=>radio.onclick=()=>{radio.parentElement.querySelectorAll('[role=radio]').forEach(peer=>peer.setAttribute('aria-checked',String(peer===radio)));if(radio.dataset.group==='mode'){window.kind=radio.textContent==='Image'?'image':'video';document.querySelector('#quote').textContent=(window.kind==='image'?0:${credits})+' credits';}});
    document.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelectorAll('#settings,#models,#picker,#uploads').forEach(element=>element.hidden=true);});
  </script></html>`;
}

function radios(names: string[], selected: string, group: string): string {
  return names
    .map(
      (name) =>
        `<button type="button" role="radio" data-group="${group}" aria-checked="${name === selected}">${name}</button>`,
    )
    .join('');
}
