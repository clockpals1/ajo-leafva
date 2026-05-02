import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { formatErr } from "../api";

export default function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      await register(name, email, password);
      nav("/dashboard");
    } catch (e) {
      setErr(formatErr(e?.response?.data?.detail) || "Registration failed");
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-app flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 mb-10" data-testid="back-home">
          <div className="w-8 h-8 rounded-full" style={{ background: "var(--primary)" }}></div>
          <div className="font-display text-xl">Ajo</div>
        </Link>
        <h1 className="font-display text-3xl mb-2">Create your account</h1>
        <p className="text-sm mb-8" style={{ color: "var(--muted)" }}>
          Sign up to join an Ajo group once an admin assigns you or invites you.
        </p>
        <form onSubmit={submit} className="space-y-4" data-testid="register-form">
          <div>
            <label className="label-eyebrow block mb-2">Full name</label>
            <input required value={name} onChange={(e)=>setName(e.target.value)}
              className="w-full bg-white border rounded-md px-4 py-3 outline-none"
              style={{ borderColor: "var(--border)" }} data-testid="register-name" />
          </div>
          <div>
            <label className="label-eyebrow block mb-2">Email</label>
            <input type="email" required value={email} onChange={(e)=>setEmail(e.target.value)}
              className="w-full bg-white border rounded-md px-4 py-3 outline-none"
              style={{ borderColor: "var(--border)" }} data-testid="register-email" />
          </div>
          <div>
            <label className="label-eyebrow block mb-2">Password</label>
            <input type="password" required minLength={6} value={password} onChange={(e)=>setPassword(e.target.value)}
              className="w-full bg-white border rounded-md px-4 py-3 outline-none"
              style={{ borderColor: "var(--border)" }} data-testid="register-password" />
          </div>
          {err && <div className="text-sm text-red-700" data-testid="register-error">{err}</div>}
          <button disabled={loading} className="btn-primary w-full" data-testid="register-submit">
            {loading ? "Creating..." : "Create account"}
          </button>
        </form>
        <p className="mt-6 text-sm text-center" style={{ color: "var(--muted)" }}>
          Already have an account? <Link to="/login" className="underline" data-testid="link-login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
