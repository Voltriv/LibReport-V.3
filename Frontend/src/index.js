import React from 'react';
import ReactDOM from 'react-dom/client';
import './tailwind.css';
import App from './App';
import { initTheme } from './theme';
import { NotificationProvider } from './notifications/NotificationProvider';
import "@fontsource/lora";
import "@fontsource/lora/700.css";
import "@fontsource/merriweather";
import "@fontsource/merriweather/700.css";

initTheme();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <NotificationProvider>
      <App />
    </NotificationProvider>
  </React.StrictMode>
);

// Web vitals disabled to keep bundle lean during development.
