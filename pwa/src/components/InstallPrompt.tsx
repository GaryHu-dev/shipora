import { useEffect, useState } from "react";
import "./InstallPrompt.css";

const DISMISS_KEY = "shipora_install_dismissed";
export const SHOW_INSTALL_EVENT = "shipora:show-install";

export function isStandalone(): boolean {
  const mm = window.matchMedia?.("(display-mode: standalone)")?.matches;
  const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
  return Boolean(mm || iosStandalone);
}
function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Manual re-open from the header — always available, even after dismissing.
    const forceShow = () => { if (!isStandalone()) { sessionStorage.removeItem(DISMISS_KEY); setShow(true); } };
    window.addEventListener(SHOW_INSTALL_EVENT, forceShow);

    const onBIP = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      if (!isStandalone() && !sessionStorage.getItem(DISMISS_KEY)) setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onBIP);

    // Auto-show once per session (until installed) — dismissal only lasts the session.
    let t: ReturnType<typeof setTimeout> | undefined;
    if (!isStandalone() && !sessionStorage.getItem(DISMISS_KEY) && isIOS()) {
      t = setTimeout(() => setShow(true), 800);
    }
    return () => {
      window.removeEventListener(SHOW_INSTALL_EVENT, forceShow);
      window.removeEventListener("beforeinstallprompt", onBIP);
      if (t) clearTimeout(t);
    };
  }, []);

  if (!show) return null;

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setShow(false);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    dismiss();
  }

  const ios = isIOS() && !deferred;

  return (
    <div className="install" role="dialog" aria-label="Add to Home Screen">
      <span className="ic" aria-hidden="true" />
      <div className="txt">
        {ios ? (
          <>Add <b>StockProof</b> to your Home Screen — tap <b>Share&nbsp;⬆︎</b>, then <b>Add to Home Screen</b>.</>
        ) : (
          <>Install <b>StockProof</b> for quick one-tap access.</>
        )}
      </div>
      {!ios && <button className="add" onClick={install}>Add</button>}
      <button className="x" onClick={dismiss} aria-label="Dismiss">×</button>
    </div>
  );
}
