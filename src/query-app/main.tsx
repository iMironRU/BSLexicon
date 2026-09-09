import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../app/monaco/setup'; // self-host Monaco: до первого рендера Editor
import { App } from './App';
import '../app/styles.css';  // базовые токены + toast
import '../help/styles.css'; // футер, оффлайн-индикатор
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Не найден корневой элемент #root');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
