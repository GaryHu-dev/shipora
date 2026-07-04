const KEY = "shipora_session";

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
