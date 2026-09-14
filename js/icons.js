// Kleine Inline-SVG-Icons (lit-html Templates). 16×16, currentColor.
import { html, svg as s } from '../vendor/lit-html/lit-html.js';

const svg = (inner, cls = '') => html`<svg class="icon ${cls}" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const icons = {
  play:    () => svg(s`<path d="M4 2.5v11l9-5.5z" fill="currentColor" stroke="none"/>`),
  pause:   () => svg(s`<rect x="3" y="2.5" width="3.5" height="11" fill="currentColor" stroke="none"/><rect x="9.5" y="2.5" width="3.5" height="11" fill="currentColor" stroke="none"/>`),
  stop:    () => svg(s`<rect x="3" y="3" width="10" height="10" rx="1" fill="currentColor" stroke="none"/>`),
  check:   () => svg(s`<path d="M2.5 8.5l3.5 3.5 7.5-8"/>`),
  x:       () => svg(s`<path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/>`),
  plus:    () => svg(s`<path d="M8 3v10M3 8h10"/>`),
  trash:   () => svg(s`<path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 8.5h6.6l.7-8.5"/>`),
  edit:    () => svg(s`<path d="M11 2.5l2.5 2.5-8 8H3v-2.5z"/>`),
  up:      () => svg(s`<path d="M8 13V3M3.5 7.5L8 3l4.5 4.5"/>`),
  down:    () => svg(s`<path d="M8 3v10M3.5 8.5L8 13l4.5-4.5"/>`),
  reset:   () => svg(s`<path d="M3 8a5 5 0 1 0 1.5-3.6"/><path d="M3 2.5v3h3"/>`),
  copy:    () => svg(s`<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>`),
  link:    () => svg(s`<path d="M6.5 9.5l3-3M7 4.5l1.2-1.2a2.5 2.5 0 0 1 3.5 3.5L10.5 8M9 11.5l-1.2 1.2a2.5 2.5 0 0 1-3.5-3.5L5.5 8"/>`),
  more:    () => svg(s`<circle cx="3" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="13" cy="8" r="1.2" fill="currentColor" stroke="none"/>`),
  drag:    () => svg(s`<circle cx="6" cy="4" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="4" r="1" fill="currentColor" stroke="none"/><circle cx="6" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="6" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="12" r="1" fill="currentColor" stroke="none"/>`),
  flag:    () => svg(s`<path d="M3.5 14V2.5h8l-2 3 2 3h-8"/>`),
  user:    () => svg(s`<circle cx="8" cy="5.5" r="3"/><path d="M2.5 14a5.5 5.5 0 0 1 11 0"/>`),
  external:() => svg(s`<path d="M9 3h4v4M13 3l-6 6M11 9v4H3V5h4"/>`),
  info:    () => svg(s`<circle cx="8" cy="8" r="6"/><path d="M8 7v4M8 5v.5"/>`),
  eye:     () => svg(s`<path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>`),
  eyeOff:  () => svg(s`<path d="M2 2l12 12M6.5 6.6A2 2 0 0 0 9.4 9.4M4 4.6C2.4 5.8 1.5 8 1.5 8s2.5 4.5 6.5 4.5c1.2 0 2.3-.4 3.2-.9M7 3.6c.3 0 .7-.1 1-.1 4 0 6.5 4.5 6.5 4.5s-.6 1.1-1.7 2.2"/>`),
  lock:    () => svg(s`<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/>`),
  unlock:  () => svg(s`<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 0 1 5.8-1"/>`),
  chevron: () => svg(s`<path d="M4 6l4 4 4-4"/>`),
  trophy:  () => svg(s`<path d="M5 2.5h6v4a3 3 0 0 1-6 0zM5 3.5H2.5v1.5A2.5 2.5 0 0 0 5 7.5M11 3.5h2.5v1.5A2.5 2.5 0 0 1 11 7.5M8 9.5v2M5.5 13.5h5"/>`),
};
