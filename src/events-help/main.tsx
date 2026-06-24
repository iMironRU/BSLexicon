import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '../help/styles.css';
import '../full-help/styles.css';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Не найден корневой элемент #root');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
