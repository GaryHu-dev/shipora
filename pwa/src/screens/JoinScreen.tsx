import { useState } from "react";
import { join, ApiError } from "../api/client";
import { saveSession, saveJoin } from "../auth/session";
import QrScanner from "../components/QrScanner";
import "./JoinScreen.css";

// Pull the join token out of a scanned QR payload (a full join URL, or a bare token).
function extractToken(s: string): string | null {
  const m = s.match(/[?&]token=([^&\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  const t = s.trim();
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t) ? t : null;
}

export default function JoinScreen({ joinToken, onJoined }: { joinToken: string | null; onJoined: () => void }) {
  const [scanned, setScanned] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const token = joinToken || scanned;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { sessionToken, user } = await join(token!, name.trim());
      saveSession(sessionToken, user.name);
      saveJoin(token!, user.name);
      onJoined();
    } catch (err) {
      const code = err instanceof ApiError ? ` (${err.status})` : "";
      setError(`Couldn't join${code}. Please try again.`);
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className="join">
        <img className="logo" src="/icon-192.png" alt="" width={64} height={64} />
        <h1>Join your team</h1>
        <p className="sub">Scan the QR code from your manager to get started.</p>
        <button type="button" className="btn" onClick={() => { setError(null); setScanning(true); }}>Scan QR code</button>
        {error && <p className="error">{error}</p>}
        {scanning && (
          <QrScanner
            onScan={(data) => {
              setScanning(false);
              const t = extractToken(data);
              if (t) setScanned(t);
              else setError("That QR code isn't a StockProof invite. Please try again.");
            }}
            onClose={() => setScanning(false)}
          />
        )}
      </div>
    );
  }

  return (
    <form className="join" onSubmit={submit}>
      <img className="logo" src="/icon-192.png" alt="" width={64} height={64} />
      <h1>Almost there</h1>
      <p className="sub">Add your name so each photo is logged to you.</p>
      <label htmlFor="name">Your name</label>
      <input id="name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. John Smith" autoComplete="name" />
      <button type="submit" className="btn" disabled={submitting || !name.trim()}>{submitting ? "Joining…" : "Continue"}</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
