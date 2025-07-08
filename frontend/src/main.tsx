import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'


import 'bootstrap/dist/css/bootstrap.min.css';

// Optionnel : Import du bundle JS de Bootstrap (utile pour les composants interactifs comme les modals, dropdowns, etc.)
import 'bootstrap/dist/js/bootstrap.bundle.min.js';

import App from './App.tsx';


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
