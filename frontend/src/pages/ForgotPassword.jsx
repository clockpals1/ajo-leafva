import React, { useState } from "react";
import { Link } from "react-router-dom";
import api, { formatErr } from "../api";
import { Mail, ArrowLeft, CheckCircle2 } from "lucide-react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      await api.post("/auth/forgot-password", { email });
      setDone(true);
    } catch (e) {
      setErr(formatErr(e?.response?.data?.detail) || "Something went wrong. Please try again.");
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
          <h2 className="font-display text-2xl mb-2">Check your email</h2>
          <p className="text-sm mb-6" style={{color:"var(--muted)"}}>
            If <strong>{email}</strong> is registered, we've sent a password reset link. Check your inbox (and spam folder).
          </p>
          <p className="text-xs mb-6" style={{color:"var(--muted)"}}>The link expires in 60 minutes.</p>
          <Link to="/login" className="btn-primary w-full text-center block">Back to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{background:"var(--primary)"}}>
            <Mail size={28} color="#fff" />
          </div>
          <h1 className="font-display text-3xl mb-1">Forgot password?</h1>
          <p className="text-sm" style={{color:"var(--muted)"}}>
            Enter your email and we'll send you a reset link.
          </p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-2xl shadow-xl p-6 space-y-5">
          <div>
            <label className="block text-sm font-semibold mb-1.5">Email address</label>
            <input
              type="email" required
              value={email} onChange={e => setEmail(e.target.value)}
              className="form-input w-full"
              placeholder="you@example.com"
              autoFocus
            />
          </div>
          {err && (
            <div className="rounded-lg p-3 text-sm text-red-700" style={{background:"#fef2f2"}}>{err}</div>
          )}
          <button type="submit" disabled={busy} className="btn-primary w-full !py-3 text-base font-semibold">
            {busy ? "Sending…" : "Send reset link"}
          </button>
          <Link to="/login" className="flex items-center justify-center gap-1.5 text-sm mt-2" style={{color:"var(--muted)"}}>
            <ArrowLeft size={14}/> Back to sign in
          </Link>
        </form>
      </div>
    </div>
  );
}
