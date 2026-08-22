const KEY = "stockproof_session";

export interface Session {
  token: string;
  name: string;
}

export function getSession(): Session | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Session;
    if (typeof s.token === "string" && typeof s.name === "string") return s;
    return null;
  } catch {
    return null;
  }
}

export function saveSession(token: string, name: string): void {
  localStorage.setItem(KEY, JSON.stringify({ token, name }));
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
}

// Remember the join credentials so the app can silently re-establish a session
// on later launches (important on iOS, where a home-screen app has its own
// isolated storage and may relaunch without the invite token in the URL).
const JOIN_KEY = "stockproof_join";

export function saveJoin(joinToken: string, name: string): void {
  localStorage.setItem(JOIN_KEY, JSON.stringify({ joinToken, name }));
}

export function getJoin(): { joinToken: string; name: string } | null {
  const raw = localStorage.getItem(JOIN_KEY);
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as { joinToken: string; name: string };
    if (typeof j.joinToken === "string" && typeof j.name === "string") return j;
    return null;
  } catch {
    return null;
  }
}

export function clearJoin(): void {
  localStorage.removeItem(JOIN_KEY);
}
