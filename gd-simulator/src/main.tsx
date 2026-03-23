import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// SPA redirect: restore path from 404.html redirect query param
const params = new URLSearchParams(window.location.search);
const redirect = params.get('redirect');
if (redirect) {
  history.replaceState(null, '', redirect);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
