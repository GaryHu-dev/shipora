import { useEffect, useState } from "react";
import { HashRouter, Routes, Route, Navigate, useNavigate, useParams } from "react-router-dom";
import JoinScreen from "./screens/JoinScreen";
import OrdersScreen from "./screens/OrdersScreen";
import OrderDetailScreen from "./screens/OrderDetailScreen";
import SettingsScreen from "./screens/SettingsScreen";
import InstallPrompt, { isStandalone, SHOW_INSTALL_EVENT } from "./components/InstallPrompt";
import { join } from "./api/client";
import { getSession, clearSession, getJoin, saveSession, saveJoin, clearJoin } from "./auth/session";
import "./App.css";

function Header() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  const session = getSession();
  if (!session) return null;

  return (
    <div className="app-header">
      <div className="brand"><img className="mark" src="/icon-192.png" alt="" /> StockProof</div>
      <div className="right">
        <span className="who">{session.name}</span>
        <button className="menu-btn" aria-label="Menu" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>☰</button>
        {open && (
          <div className="menu" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { setOpen(false); nav("/settings"); }}>Settings</button>
            {!isStandalone() && (
              <button onClick={() => { setOpen(false); window.dispatchEvent(new Event(SHOW_INSTALL_EVENT)); }}>Add to Home Screen</button>
            )}
            <button className="menu-danger" onClick={() => { setOpen(false); clearSession(); clearJoin(); nav("/join"); }}>Sign out</button>
          </div>
        )}
      </div>
    </div>
  );
}

function JoinRoute() {
  const nav = useNavigate();
  // Already signed in? Skip the join form and go straight to orders.
  // (Sign out first to join as someone else.)
  if (getSession()) return <Navigate to="/" replace />;
  const token = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("token");
  return <JoinScreen joinToken={token} onJoined={() => nav("/")} />;
}

function OrdersRoute() {
  const nav = useNavigate();
  if (!getSession()) return <Navigate to="/join" replace />;
  return <OrdersScreen onOpenOrder={(id) => nav(`/orders/${id}`)} />;
}

function DetailRoute() {
  const nav = useNavigate();
  const { id } = useParams();
  if (!getSession()) return <Navigate to="/join" replace />;
  return <OrderDetailScreen orderId={id!} onBack={() => nav("/")} />;
}

function SettingsRoute() {
  const nav = useNavigate();
  if (!getSession()) return <Navigate to="/join" replace />;
  return <SettingsScreen onBack={() => nav("/")} />;
}

export default function App() {
  const [ready, setReady] = useState(false);

  // On launch, if there's no session but we remember a join token, silently
  // re-establish the session (keeps the iOS home-screen app logged in).
  useEffect(() => {
    let active = true;
    (async () => {
      if (!getSession()) {
        const j = getJoin();
        if (j) {
          try {
            const { sessionToken, user } = await join(j.joinToken, j.name);
            saveSession(sessionToken, user.name);
            saveJoin(j.joinToken, user.name);
          } catch {
            // token expired/invalid — fall through to the join screen
          }
        }
      }
      if (active) setReady(true);
    })();
    return () => { active = false; };
  }, []);

  if (!ready) return <div className="boot">Loading…</div>;

  return (
    <HashRouter>
      <Header />
      <InstallPrompt />
      <Routes>
        <Route path="/join" element={<JoinRoute />} />
        <Route path="/" element={<OrdersRoute />} />
        <Route path="/orders/:id" element={<DetailRoute />} />
        <Route path="/settings" element={<SettingsRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
