import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { StoreProvider } from './store';
import { AuthProvider } from './auth';

// Do NOT start the app in a hidden iframe (silent token renewal by MSAL) —
// otherwise it consumes the response that the main window reads.
if (window.self !== window.top) {
  document.getElementById('root')!.textContent = '';
} else ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <StoreProvider>
        <App />
      </StoreProvider>
    </AuthProvider>
  </React.StrictMode>
);
