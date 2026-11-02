import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { StoreProvider } from './store';
import { ServicesProvider } from './services/store';
import { AuthProvider } from './auth';
import { ConfirmProvider } from './components/Confirm';

// In a hidden iframe (silent token renewal by MSAL) do NOT start
// the app — otherwise it consumes the response that the main window reads.
if (window.self !== window.top) {
  document.getElementById('root')!.textContent = '';
} else ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <StoreProvider>
        <ServicesProvider>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </ServicesProvider>
      </StoreProvider>
    </AuthProvider>
  </React.StrictMode>
);
