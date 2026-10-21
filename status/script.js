import { initAuth } from '../js/auth.js';
import {
  initNav,
  initScrollProgress,
  initReveal,
  initCopyButtons,
  bindServerAddresses
} from '../js/ui.js';
import { mountStatusWidgets } from '../js/server-status.js';

initAuth();
bindServerAddresses();
initNav();
initScrollProgress();
initCopyButtons();
initReveal();
mountStatusWidgets();
