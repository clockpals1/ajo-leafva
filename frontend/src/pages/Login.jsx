import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { formatErr } from "../api";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      const u = await login(email, password);
      nav(u.role === "admin" || u.role === "super_admin" ? "/admin" : "/dashboard");
    } catch (e) {
      setErr(formatErr(e?.response?.data?.detail) || "Login failed");
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-app flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 mb-10" data-testid="back-home">
          <div className="w-8 h-8 rounded-full" style={{ background: "var(--primary)" }}></div>
          <div className="font-display text-xl">Ajo</div>
        </Link>
        <h1 className="font-display text-3xl mb-2">Welcome back</h1>
        <p className="text-sm mb-8" style={{ color: "var(--muted)" }}>Sign in to continue.</p>
        <form onSubmit={submit} className="space-y-4" data-testid="login-form">
          <div>
            <label className="label-eyebrow block mb-2">Email</label>
            <input type="email" required value={email} onChange={(e)=>setEmail(e.target.value)}
              className="w-full bg-white border rounded-md px-4 py-3 outline-none focus:ring-2"
              style={{ borderColor: "var(--border)" }} data-testid="login-email" />
          </div>
          <div>
            <label className="label-eyebrow block mb-2">Password</label>
            <input type="password" required value={password} onChange={(e)=>setPassword(e.target.value)}
              className="w-full bg-white border rounded-md px-4 py-3 outline-none focus:ring-2"
              style={{ borderColor: "var(--border)" }} data-testid="login-password" />
          </div>
          {err && <div className="text-sm text-red-700" data-testid="login-error">{err}</div>}
          <button disabled={loading} className="btn-primary w-full" data-testid="login-submit">
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="mt-6 text-sm text-center" style={{ color: "var(--muted)" }}>
          New here? <Link to="/register" className="underline" data-testid="link-register">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
