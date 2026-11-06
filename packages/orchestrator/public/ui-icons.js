const paths = {
  plus: ['M12 5v14M5 12h14'],
  check: ['m5 12 4 4L19 6'],
  chevron: ['m8 4 8 8-8 8'],
  down: ['m6 9 6 6 6-6'],
  trash: ['M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7'],
  refresh: [
    'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2l1 4M4 12l1 4a8 8 0 0 0 13 2',
  ],
  image: [
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z',
    'm3 17 5-5 4 4 4-6 5 7',
    'M8 7h.01',
  ],
  paperclip: [
    'm8 12 7-7a4 4 0 0 1 6 6L10 22a6 6 0 0 1-8-8L13 3a2 2 0 0 1 3 3L5 17',
  ],
  video: [
    'M15 9l6-4v14l-6-4M4 5h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
    'm7 9 4 3-4 3Z',
  ],
  package: ['m12 2 9 5v10l-9 5-9-5V7Z', 'm3 7 9 5 9-5M12 12v10M7.5 4.5l9 5v5'],
  warning: [
    'm10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0Z',
    'M12 9v4M12 17h.01',
  ],
  database: [
    'M21 5c0 2-4 3-9 3S3 7 3 5s4-3 9-3 9 1 9 3ZM3 5v14c0 2 4 3 9 3s9-1 9-3V5M3 12c0 2 4 3 9 3s9-1 9-3',
  ],
  message: [
    'M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L3 21l1.9-5.5a9 9 0 0 1-.9-4A8.5 8.5 0 0 1 12.5 3a8.5 8.5 0 0 1 8.5 8.5Z',
  ],
};

export function icon(parent, name) {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  for (const [key, value] of Object.entries({
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.7',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
    class: 'icon',
  }))
    svg.setAttribute(key, value);
  for (const d of paths[name] ?? []) {
    const path = document.createElementNS(namespace, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  parent.prepend(svg);
  return svg;
}

export function iconButton(
  parent,
  label,
  name,
  className = 'secondary icon-button',
) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.setAttribute('aria-label', label);
  button.title = label;
  icon(button, name);
  parent.append(button);
  return button;
}
