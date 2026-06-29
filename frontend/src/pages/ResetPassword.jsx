import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import api, { formatErr } from "../api";
import { useAuth } from "../AuthContext";
import { ShieldCheck, Eye, EyeOff, CheckCircle2, AlertTriangle } from "lucide-react";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();
  const { setUser } = useAuth();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!token) setErr("No reset token found. Please use the link from your email, or request a new one.");
  }, [token]);

  const rules = [
    { ok: password.length >= 6, label: "At least 6 characters" },
    { ok: /[A-Z]/.test(password) || /[0-9]/.test(password), label: "Contains a number or uppercase letter" },
    { ok: confirm.length > 0 && password === confirm, label: "Passwords match" },
  ];
  const allOk = rules.every(r => r.ok);

  const submit = async (e) => {
    e.preventDefault();
    if (!allOk) { setErr("Please fix the issues above."); return; }
    setErr(""); setBusy(true);
    try {
      const { data } = await api.post("/auth/reset-password", { token, password });
      if (data.token) localStorage.setItem("ajo_token", data.token);
      setUser(data.user);
      setDone(true);
      setTimeout(() => {
        navigate(data.user?.role === "admin" || data.user?.role === "super_admin" ? "/admin" : "/dashboard");
      }, 2000);
    } catch (e) {
      setErr(formatErr(e?.response?.data?.detail));
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="min-h-screen bg-app flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm text-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{background:"var(--primary)15"}}>
            <CheckCircle2 size={32} style={{color:"var(--primary)"}} />
          </div>
          <h2 className="font-display text-2xl mb-2">Password updated!</h2>
          <p className="text-sm" style={{color:"var(--muted)"}}>Taking you to your dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{background:"var(--primary)"}}>
            <ShieldCheck size={28} color="#fff" />
          </div>
          <h1 className="font-display text-3xl mb-1">Set new password</h1>
          <p className="text-sm" style={{color:"var(--muted)"}}>Choose a new password for your account.</p>
        </div>

        {!token && (
          <div className="rounded-xl p-4 mb-4 flex gap-3 items-start" style={{background:"#fef2f2",border:"1px solid #fecaca"}}>
            <AlertTriangle size={16} className="shrink-0 mt-0.5" color="#dc2626" />
            <div className="text-sm text-red-700">
              {err}
              <br/><Link to="/forgot-password" className="underline font-semibold">Request a new reset link →</Link>
            </div>
          </div>
        )}

        {token && (
          <form onSubmit={submit} className="bg-white rounded-2xl shadow-xl p-6 space-y-5">
            <div>
              <label className="block text-sm font-semibold mb-1.5">New password</label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password} onChange={e => setPassword(e.target.value)}
                  className="form-input pr-10 w-full" placeholder="Create a secure password"
                  autoFocus required
                />
                <button type="button" tabIndex={-1}
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100">
                  {showPw ? <EyeOff size={16}/> : <Eye size={16}/>}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">Confirm password</label>
              <input
                type={showPw ? "text" : "password"}
                value={confirm} onChange={e => setConfirm(e.target.value)}
                className="form-input w-full" placeholder="Type it again" required
              />
            </div>
            {password.length > 0 && (
              <ul className="space-y-1.5">
                {rules.map(r => (
                  <li key={r.label} className="flex items-center gap-2 text-xs">
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${r.ok ? "bg-green-100" : "bg-gray-100"}`}>
                      {r.ok ? <CheckCircle2 size={12} color="#16a34a"/> : <span className="w-1.5 h-1.5 rounded-full bg-gray-300 block"/>}
                    </span>
                    <span style={{color: r.ok ? "#16a34a" : "var(--muted)"}}>{r.label}</span>
                  </li>
                ))}
              </ul>
            )}
            {err && (
              <div className="rounded-lg p-3 text-sm text-red-700" style={{background:"#fef2f2"}}>
                {err} <Link to="/forgot-password" className="underline ml-1">Get a new link</Link>
              </div>
            )}
            <button type="submit" disabled={busy || !allOk} className="btn-primary w-full !py-3 text-base font-semibold">
              {busy ? "Saving…" : "Set new password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
