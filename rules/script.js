import { initAuth } from '../js/auth.js';
import {
  initNav,
  initScrollProgress,
  initReveal,
  initCopyButtons,
  bindServerAddresses
} from '../js/ui.js';

initAuth();
bindServerAddresses();
initNav();
initScrollProgress();
initCopyButtons();
initReveal();
