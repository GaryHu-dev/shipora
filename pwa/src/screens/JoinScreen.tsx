import { useState } from "react";
import { join, ApiError } from "../api/client";
import { saveSession } from "../auth/session";
import "./JoinScreen.css";

export default function JoinScreen({ joinToken, onJoined }: { joinToken: string | null; onJoined: () => void }) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { sessionToken, user } = await join(joinToken!, name.trim());
      saveSession(sessionToken, user.name);
      onJoined();
    } catch (err) {
      const code = err instanceof ApiError ? ` (${err.status})` : "";
      setError(`加入失败${code},请重试`);
    } finally {
      setSubmitting(false);
    }
  }

  if (!joinToken) {
    return (
      <div className="join">
        <h1>加入发货团队</h1>
        <p className="error">无效的邀请链接,请重新扫码。</p>
      </div>
    );
  }

  return (
    <form className="join" onSubmit={submit}>
      <h1>加入发货团队</h1>
      <label htmlFor="name">你的名字</label>
      <input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如:李四" />
      <button type="submit" disabled={submitting || !name.trim()}>加入</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
