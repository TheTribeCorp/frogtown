import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';

type InstallChoice = {
  outcome: 'accepted' | 'dismissed';
  platform: string;
};

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
}

function isAppInstalled() {
  const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    standaloneNavigator.standalone === true
  );
}

export function PwaInstallButton() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    setInstalled(isAppInstalled());

    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setShowGuide(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (installed || !installPrompt) {
      setShowGuide((current) => !current);
      return;
    }

    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setInstalled(true);
        setShowGuide(false);
      } else {
        setShowGuide(true);
      }
    } catch {
      setShowGuide(true);
    } finally {
      setInstallPrompt(null);
    }
  };

  return (
    <div className="ft-entry-web-install">
      <button
        className="ft-entry-download-button ft-entry-install-action"
        type="button"
        onClick={handleInstall}
        aria-expanded={showGuide}
        aria-controls="frogtown-install-guide"
        data-testid="button-install-frogtown-web"
      >
        <Download aria-hidden="true" />
        <span>
          <strong>{installed ? 'Frogtown installed' : 'Install web app'}</strong>
          <small>{installed ? 'Open it from your home screen' : 'Add to your home screen · no store needed'}</small>
        </span>
      </button>
      {showGuide && (
        <div
          id="frogtown-install-guide"
          className="ft-entry-install-guide"
          role="status"
          data-testid="status-frogtown-install-guide"
        >
          <p>This installs Frogtown’s website as a home-screen web app, not as a native APK.</p>
          <ol>
            <li><strong>Android:</strong> open Frogtown in Chrome, tap ⋮, then choose <em>Install app</em> or <em>Add to Home screen</em>.</li>
            <li><strong>iPhone:</strong> open Frogtown in Safari, tap Share, then <em>Add to Home Screen</em>.</li>
          </ol>
        </div>
      )}
    </div>
  );
}
