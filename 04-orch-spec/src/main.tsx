import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { StoreProvider } from './store';
import { AuthProvider } from './auth';
import { ConfirmProvider } from './components/Confirm';

// In einem versteckten iframe (stille Token-Erneuerung durch MSAL) die App
// NICHT starten — sonst verbraucht sie die Antwort, die das Hauptfenster liest.
if (window.self !== window.top) {
  document.getElementById('root')!.textContent = '';
} else ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <StoreProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </StoreProvider>
    </AuthProvider>
  </React.StrictMode>
);
