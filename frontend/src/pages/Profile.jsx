import React, { useState } from "react";
import api, { formatErr } from "../api";
import TopNav from "../components/TopNav";
import { useAuth } from "../AuthContext";

export default function Profile() {
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({
    name: user?.name || "", phone: user?.phone || "",
    display_name: user?.display_name || "",
    use_alias: !!user?.use_alias,
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
        <form onSubmit={submit} className="space-y-6" data-testid="profile-form">

          <section className="card-tactile p-6 space-y-4">
            <div className="label-eyebrow">Identity</div>
            <div>
              <label className="text-xs block mb-1" style={{color:"var(--muted)"}}>Full name (admins see this)</label>
              <input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}
                className="w-full bg-white border rounded px-3 py-2" data-testid="profile-name" />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{color:"var(--muted)"}}>Phone</label>
              <input type="tel" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}
                className="w-full bg-white border rounded px-3 py-2" data-testid="profile-phone" />
            </div>
          </section>

          <section className="card-tactile p-6 space-y-4">
            <div className="label-eyebrow">Privacy</div>
            <div>
              <label className="text-xs block mb-1" style={{color:"var(--muted)"}}>Display name / Alias (shown to other members)</label>
              <input value={form.display_name} onChange={e=>setForm({...form,display_name:e.target.value})}
                placeholder="e.g. AjoChamp"
                className="w-full bg-white border rounded px-3 py-2" data-testid="profile-display-name" />
            </div>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={form.use_alias} onChange={e=>setForm({...form, use_alias: e.target.checked})}
                className="mt-1" data-testid="profile-use-alias" />
              <span className="text-sm">
                <b>Use my display name in groups.</b>
                <span className="block text-xs mt-1" style={{color:"var(--muted)"}}>
                  Other members will see your alias in the chat, members table and activity feed.
                  Admins always see your real name for accountability.
                </span>
              </span>
            </label>
            <div>
              <label className="text-xs block mb-1" style={{color:"var(--muted)"}}>Visibility preference (admin approval required)</label>
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
          </section>

          <section className="card-tactile p-6 space-y-4">
            <div className="label-eyebrow">Bank account (for payouts)</div>
            {[
              ["bank_name","Bank name"],
              ["bank_account_number","Account number"],
              ["bank_account_name","Account name"],
            ].map(([k, l]) => (
              <div key={k}>
                <label className="text-xs block mb-1" style={{color:"var(--muted)"}}>{l}</label>
                <input value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})}
                  className="w-full bg-white border rounded px-3 py-2" data-testid={`profile-${k}`} />
              </div>
            ))}
          </section>

          {err && <div className="text-red-700 text-sm" data-testid="profile-error">{err}</div>}
          {msg && <div className="text-sm" style={{color:"var(--primary)"}} data-testid="profile-msg">{msg}</div>}
          <button className="btn-primary" data-testid="profile-save">Save changes</button>
        </form>
      </main>
    </div>
  );
}
