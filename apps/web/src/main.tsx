import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ZeroProvider } from '@rocicorp/zero/react';
import { zero } from './zero.ts';
import { App } from './App.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ZeroProvider zero={zero}>
      <App />
    </ZeroProvider>
  </StrictMode>,
);
