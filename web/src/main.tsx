import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens.css';

function Placeholder() {
  return <main style={{ padding: 32 }}>Folga</main>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Placeholder />
  </StrictMode>,
);
