import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);

// Service worker desactivado: la app se sirve siempre fresca desde el disco.
// (El modo offline para tablets se reactiva cuando se despliegue en planta.)
