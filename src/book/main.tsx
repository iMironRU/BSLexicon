import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BookApp } from './App';
import '../app/styles.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <StrictMode>
    <BookApp />
  </StrictMode>,
);
