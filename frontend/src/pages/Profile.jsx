import React, { useState } from "react";
import api, { formatErr } from "../api";
import TopNav from "../components/TopNav";
import { useAuth } from "../AuthContext";

export default function Profile() {
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({
    name: user?.name || "", phone: user?.phone || "",
    bank_name: user?.bank_name || "", bank_account_number: user?.bank_account_number || "",
    bank_account_name: user?.bank_account_name || "",
    visibility_preference: user?.visibility_preference || "visible",
  });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault(); setErr(""); setMsg("");
    try {
      const { data } = await api.put("/me/profile", form);
      setUser(data); setMsg("Profile updated.");
    } catch (e) { setErr(formatErr(e?.response?.data?.detail)); }
  };

  return (
    <div className="min-h-screen bg-app">
      <TopNav />
      <main className="max-w-2xl mx-auto px-6 py-10">
        <div className="label-eyebrow mb-2">Profile</div>
        <h1 className="font-display text-3xl mb-8">Your account</h1>
        <form onSubmit={submit} className="card-tactile p-6 space-y-4" data-testid="profile-form">
          {[
            ["name", "Full name", "text"],
            ["phone", "Phone", "tel"],
            ["bank_name", "Bank name", "text"],
            ["bank_account_number", "Account number", "text"],
            ["bank_account_name", "Account name", "text"],
          ].map(([k, l, t]) => (
            <div key={k}>
              <label className="label-eyebrow block mb-1">{l}</label>
              <input type={t} value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})}
                className="w-full bg-white border rounded px-3 py-2" data-testid={`profile-${k}`} />
            </div>
          ))}
          <div>
            <label className="label-eyebrow block mb-1">Visibility preference (admin approval required)</label>
            <select value={form.visibility_preference} onChange={e=>setForm({...form,visibility_preference:e.target.value})}
              className="w-full bg-white border rounded px-3 py-2" data-testid="profile-visibility">
              <option value="visible">Visible to group</option>
              <option value="limited">Limited visibility</option>
              <option value="hidden">Hidden from group (admin still sees)</option>
            </select>
            {user?.visibility_status && (
              <div className="text-xs mt-1" style={{color:"var(--muted)"}}>
                Current preference: <b>{user.visibility_preference}</b> · Status: <b>{user.visibility_status}</b>
              </div>
            )}
          </div>
          {err && <div className="text-red-700 text-sm" data-testid="profile-error">{err}</div>}
          {msg && <div className="text-sm" style={{color:"var(--primary)"}} data-testid="profile-msg">{msg}</div>}
          <button className="btn-primary" data-testid="profile-save">Save changes</button>
        </form>
      </main>
    </div>
  );
}
