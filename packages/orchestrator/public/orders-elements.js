export function element(parent, tag, text = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  parent.append(node);
  return node;
}
export function field(parent, title, tag, attributes = {}) {
  const label = element(parent, 'label', title);
  const input = element(label, tag);
  input.setAttribute('aria-label', title);
  Object.assign(input, attributes);
  return input;
}
