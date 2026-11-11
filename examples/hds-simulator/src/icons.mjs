import icons from './lucide-icons.mjs';

const numberIcons = {
  ChevronUp: [['path', { d: 'm18 15-6-6-6 6' }]],
  ChevronDown: [['path', { d: 'm6 9 6 6 6-6' }]],
};

export function setIcon(element, name) {
  const nodes = icons[name] || numberIcons[name];
  if (!element || !nodes) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  for (const [tag, attributes] of nodes) {
    const child = document.createElementNS(svg.namespaceURI, tag);
    for (const [key, value] of Object.entries(attributes)) child.setAttribute(key, value);
    svg.append(child);
  }
  element.replaceChildren(svg);
  element.dataset.icon = name;
}

export function hydrateIcons() {
  for (const element of document.querySelectorAll('[data-icon]')) setIcon(element, element.dataset.icon);
}
