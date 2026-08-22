import { useEffect, useState } from "react";
import "./InstallApp.css";

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true
  );
}

function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}

export default function InstallApp() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    function handleBeforeInstall(e) {
      // Chrome/Edge fire this when install criteria are met, but only if we
      // call preventDefault() do we get to control *when* the prompt shows
      // (here: when the person clicks our own button) instead of the
      // browser's own mini-infobar.
      e.preventDefault();
      setDeferredPrompt(e);
    }
    function handleInstalled() {
      setInstalled(true);
      setDeferredPrompt(null);
    }
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  async function handleInstallClick() {
    if (!deferredPrompt) return;
    setInstalling(true);
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    setDismissed(choice.outcome === "dismissed");
    setDeferredPrompt(null);
    setInstalling(false);
  }

  if (installed) {
    return (
      <section className="card">
        <h2 className="section-title">App</h2>
        <p className="install-status install-status--done">✓ Running as an installed app</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2 className="section-title">App</h2>

      {deferredPrompt ? (
        <>
          <p className="text-muted install-hint">
            Install Mini Budget for its own app window (no browser bar) with an icon in your dock/taskbar and full
            offline support.
          </p>
          <button className="btn btn--stamp" onClick={handleInstallClick} disabled={installing}>
            {installing ? "Installing…" : "Install app"}
          </button>
        </>
      ) : isIOS() ? (
        <p className="text-muted install-hint">
          On iPhone/iPad: open this page in <strong>Safari</strong>, tap the Share icon, then{" "}
          <strong>Add to Home Screen</strong>.
        </p>
      ) : dismissed ? (
        <p className="text-muted install-hint">
          No worries — your browser will still offer to install it later (often via an icon in the address bar).
        </p>
      ) : (
        <p className="text-muted install-hint">
          Your browser will offer an install option once it's ready — look for an install icon in the address bar.
          Supported on Chrome and Edge (desktop and Android) and Safari on iOS (via Add to Home Screen, above).
        </p>
      )}
    </section>
  );
}
