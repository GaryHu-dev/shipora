import { HashRouter, Routes, Route, Navigate, useNavigate, useParams } from "react-router-dom";
import JoinScreen from "./screens/JoinScreen";
import OrdersScreen from "./screens/OrdersScreen";
import OrderDetailScreen from "./screens/OrderDetailScreen";
import { getSession, clearSession } from "./auth/session";
import "./App.css";

function Header() {
  const nav = useNavigate();
  const session = getSession();
  if (!session) return null;
  return (
    <div className="app-header">
      <span className="who">👤 {session.name}</span>
      <button onClick={() => { clearSession(); nav("/join"); }}>退出</button>
    </div>
  );
}

function JoinRoute() {
  const nav = useNavigate();
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

export default function App() {
  return (
    <HashRouter>
      <Header />
      <Routes>
        <Route path="/join" element={<JoinRoute />} />
        <Route path="/" element={<OrdersRoute />} />
        <Route path="/orders/:id" element={<DetailRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
