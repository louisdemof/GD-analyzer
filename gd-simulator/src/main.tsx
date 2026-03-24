import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useProjectStore } from './store/projectStore'

// SPA redirect: restore path from 404.html redirect query param
const params = new URLSearchParams(window.location.search);
const redirect = params.get('redirect');
if (redirect) {
  history.replaceState(null, '', redirect);
}

// Initialize IndexedDB storage
useProjectStore.getState().initFromDB();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
