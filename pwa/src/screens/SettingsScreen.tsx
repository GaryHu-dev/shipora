import { useState } from "react";
import { updateName } from "../api/client";
import { getSession, saveSession, getJoin, saveJoin } from "../auth/session";
import "./SettingsScreen.css";

export default function SettingsScreen({ onBack }: { onBack: () => void }) {
  const session = getSession();
  const [name, setName] = useState(session?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    const next = name.trim();
    if (!next || !session || busy) return;
    setBusy(true);
    try {
      const s = await updateName(session.token, next);
      saveSession(session.token, s);
      const j = getJoin();
      if (j) saveJoin(j.joinToken, s);
      setName(s);
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch { /* ignore */ } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings">
      <div className="top">
        <button className="back" onClick={onBack}>Back</button>
        <h1>Settings</h1>
      </div>

      <div className="card">
        <div className="items-h">Your name</div>
        <p className="desc">Shown on every photo you upload.</p>
        <input
          className="field"
          value={name}
          onChange={(e) => { setName(e.target.value); setSaved(false); }}
          placeholder="e.g. John Smith"
          autoComplete="name"
        />
        <button className="btn" onClick={save} disabled={busy || !name.trim() || name.trim() === session?.name}>
          {busy ? "Saving…" : saved ? "Saved ✓" : "Save"}
        </button>
      </div>
    </div>
  );
}
