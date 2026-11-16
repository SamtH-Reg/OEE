import React from 'react';
import { createRoot } from 'react-dom/client';
import Raiz from './Raiz';
import './styles.css';

createRoot(document.getElementById('root')).render(<Raiz />);

// PWA: el service worker sólo se registra fuera de local. En el PC de trabajo el
// tablero se sirve siempre fresco desde el disco (un SW viejo deja la app
// congelada en un build anterior).
const esLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
if ('serviceWorker' in navigator && !esLocal) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* sin SW se sigue igual */ });
  });
}
