import { initAuth } from './auth.js';
import { ITEMS, formatBDT } from './config.js';
import {
  initNav,
  initScrollProgress,
  initReveal,
  initParticles,
  initCopyButtons,
  bindServerAddresses
} from './ui.js';
import { mountStatusWidgets } from './server-status.js';

/* Keep the home CTA price in sync with the cheapest rank in config.js. */
const rankPrices = ITEMS.filter((item) => item.kind === 'rank').map((item) => item.price);
const rankFromNode = document.querySelector('[data-rank-from]');
if (rankFromNode && rankPrices.length) {
  rankFromNode.textContent = formatBDT(Math.min(...rankPrices));
}

initAuth();
bindServerAddresses();
initNav();
initScrollProgress();
initCopyButtons();
initReveal();
initParticles(document.getElementById('bgCanvas'));
mountStatusWidgets();
