import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { applyTheme, getStoredMode } from './lib/theme'

// Apply the saved display mode before the first paint so there is no flash of the wrong theme.
applyTheme(getStoredMode())

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
