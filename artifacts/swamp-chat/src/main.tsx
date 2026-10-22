import { createRoot } from 'react-dom/client';
import { ThemeProvider } from 'next-themes';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const serviceWorkerUrl = new URL('service-worker.js', manifestLink?.href || document.baseURI);
    const serviceWorkerScope = new URL('.', serviceWorkerUrl).pathname;

    navigator.serviceWorker
      .register(serviceWorkerUrl, { scope: serviceWorkerScope })
      .catch((error: unknown) => {
        console.warn('Frogtown could not register its web-app service worker.', error);
      });
  });
}

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="frogtown-theme">
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </ThemeProvider>,
);
