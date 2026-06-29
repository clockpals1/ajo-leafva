import React, { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext";
import api, { formatErr } from "../api";

export default function Login() {
  const { login, setUser } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const nextPath = new URLSearchParams(location.search).get("next");

  // ── Tab: "password" | "code" ──
  const [tab, setTab] = useState("password");

  // ── Password login ──
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const goAfterLogin = (u) => {
    if (nextPath) { nav(nextPath); return; }
    nav(u.role === "admin" || u.role === "super_admin" ? "/admin" : "/dashboard");
  };

  const submitPassword = async (e) => {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      const u = await login(email, password);
      goAfterLogin(u);
    } catch (e) {
      setErr(formatErr(e?.response?.data?.detail) || "Login failed. Check your email and password.");
    } finally { setLoading(false); }
  };

  // ── Code login ──
  const [codeEmail, setCodeEmail] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);

  const requestCode = async (e) => {
    e.preventDefault();
    setCodeErr(""); setCodeBusy(true);
    try {
      await api.post("/auth/request-login-code", { email: codeEmail });
      setCodeSent(true);
    } catch (e) {
      setCodeErr(formatErr(e?.response?.data?.detail) || "Failed to send code. Try again.");
    } finally { setCodeBusy(false); }
  };

  const verifyCode = async (e) => {
    e.preventDefault();
    setCodeErr(""); setCodeBusy(true);
    try {
      const { data } = await api.post("/auth/verify-login-code", { email: codeEmail, code });
      if (data.token) localStorage.setItem("ajo_token", data.token);
      setUser(data.user);
      goAfterLogin(data.user);
    } catch (e) {
      setCodeErr(formatErr(e?.response?.data?.detail) || "Incorrect or expired code.");
    } finally { setCodeBusy(false); }
  };

  const TAB_STYLE = (active) => ({
    flex: 1, padding: "8px 0", fontSize: "14px", fontWeight: "600",
    borderBottom: active ? "2px solid var(--primary)" : "2px solid transparent",
    color: active ? "var(--primary)" : "var(--muted)",
    background: "none", cursor: "pointer", transition: "all .15s",
  });

  return (
    <div className="min-h-screen bg-app flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 mb-10" data-testid="back-home">
          <div className="w-8 h-8 rounded-full" style={{background:"var(--primary)"}}></div>
          <div className="font-display text-xl">Ajo</div>
        </Link>
        <h1 className="font-display text-3xl mb-2">Welcome back</h1>
        {nextPath?.startsWith("/join/") ? (
          <p className="text-sm mb-6 px-3 py-2.5 rounded-lg" style={{background:"#fef9c3",color:"#854d0e"}}>
            Sign in to continue joining the group — you'll be taken right back.
          </p>
        ) : (
          <p className="text-sm mb-6" style={{color:"var(--muted)"}}>Sign in to your account.</p>
        )}

        {/* Tab switcher */}
        <div className="flex mb-6" style={{borderBottom:"2px solid var(--border)"}}>
          <button type="button" style={TAB_STYLE(tab==="password")} onClick={()=>{setTab("password");setErr("");}}>
            🔑 Password
          </button>
          <button type="button" style={TAB_STYLE(tab==="code")} onClick={()=>{setTab("code");setCodeErr("");}}>
            📧 Email code
          </button>
        </div>

        {/* ── Password tab ── */}
        {tab === "password" && (
          <form onSubmit={submitPassword} className="space-y-4" data-testid="login-form">
            <div>
              <label className="label-eyebrow block mb-2">Email</label>
              <input type="email" required value={email} onChange={e=>setEmail(e.target.value)}
                className="w-full bg-white border rounded-md px-4 py-3 outline-none focus:ring-2"
                style={{borderColor:"var(--border)"}} data-testid="login-email" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label-eyebrow">Password</label>
                <Link to="/forgot-password" className="text-xs underline" style={{color:"var(--muted)"}}>
                  Forgot password?
                </Link>
              </div>
              <input type="password" required value={password} onChange={e=>setPassword(e.target.value)}
                className="w-full bg-white border rounded-md px-4 py-3 outline-none focus:ring-2"
                style={{borderColor:"var(--border)"}} data-testid="login-password" />
            </div>
            {err && <div className="text-sm text-red-700" data-testid="login-error">{err}</div>}
            <button disabled={loading} className="btn-primary w-full" data-testid="login-submit">
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}

        {/* ── Email code tab ── */}
        {tab === "code" && (
          <div>
            {!codeSent ? (
              <form onSubmit={requestCode} className="space-y-4">
                <p className="text-sm" style={{color:"var(--muted)"}}>
                  Enter your email and we'll send a 6-digit code. No password needed.
                </p>
                <div>
                  <label className="label-eyebrow block mb-2">Email</label>
                  <input type="email" required value={codeEmail} onChange={e=>setCodeEmail(e.target.value)}
                    className="w-full bg-white border rounded-md px-4 py-3 outline-none focus:ring-2"
                    style={{borderColor:"var(--border)"}} placeholder="you@example.com" autoFocus />
                </div>
                {codeErr && <div className="text-sm text-red-700">{codeErr}</div>}
                <button disabled={codeBusy} className="btn-primary w-full">
                  {codeBusy ? "Sending…" : "Send login code"}
                </button>
              </form>
            ) : (
              <form onSubmit={verifyCode} className="space-y-4">
                <div className="rounded-xl p-4 text-sm" style={{background:"#f0fdf4",border:"1px solid #bbf7d0",color:"#166534"}}>
                  ✅ Code sent to <strong>{codeEmail}</strong>. Check your inbox (and spam folder). Expires in 15 minutes.
                </div>
                <div>
                  <label className="label-eyebrow block mb-2">6-digit code</label>
                  <input
                    type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required
                    value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,""))}
                    className="w-full bg-white border rounded-md px-4 py-3 outline-none focus:ring-2 text-center text-2xl font-bold tracking-widest"
                    style={{borderColor:"var(--border)"}} placeholder="______" autoFocus
                  />
                </div>
                {codeErr && <div className="text-sm text-red-700">{codeErr}</div>}
                <button disabled={codeBusy || code.length < 6} className="btn-primary w-full">
                  {codeBusy ? "Verifying…" : "Sign in with code"}
                </button>
                <button type="button" onClick={()=>{setCodeSent(false);setCode("");setCodeErr("");}}
                  className="w-full text-sm text-center" style={{color:"var(--muted)"}}>
                  ← Use a different email
                </button>
              </form>
            )}
          </div>
        )}

        <p className="mt-8 text-sm text-center" style={{color:"var(--muted)"}}>
          New here? <Link to="/register" className="underline" data-testid="link-register">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
