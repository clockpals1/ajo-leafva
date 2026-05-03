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
      <main className="page-main max-w-2xl mx-auto">
        <div className="label-eyebrow mb-1">Profile</div>
        <h1 className="font-display text-2xl sm:text-3xl mb-6 sm:mb-8">Your account</h1>
        <form onSubmit={submit} className="space-y-4 sm:space-y-6" data-testid="profile-form">

          <section className="card-tactile p-4 sm:p-6 space-y-4">
            <div className="label-eyebrow">Identity</div>
            <div>
              <label className="form-label">Full name <span className="font-normal">(admins see this)</span></label>
              <input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}
                className="form-input" data-testid="profile-name" />
            </div>
            <div>
              <label className="form-label">Phone</label>
              <input type="tel" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}
                className="form-input" data-testid="profile-phone" />
            </div>
          </section>

          <section className="card-tactile p-4 sm:p-6 space-y-4">
            <div className="label-eyebrow">Privacy</div>
            <div>
              <label className="form-label">Display name / Alias <span className="font-normal">(shown to other members)</span></label>
              <input value={form.display_name} onChange={e=>setForm({...form,display_name:e.target.value})}
                placeholder="e.g. AjoChamp" className="form-input" data-testid="profile-display-name" />
            </div>
            <label className="flex items-start gap-3 cursor-pointer py-1">
              <input type="checkbox" checked={form.use_alias} onChange={e=>setForm({...form, use_alias: e.target.checked})}
                className="mt-1 w-5 h-5 shrink-0" data-testid="profile-use-alias" />
              <span className="text-sm">
                <b>Use my display name in groups.</b>
                <span className="block text-xs mt-1" style={{color:"var(--muted)"}}>
                  Other members will see your alias. Admins always see your real name.
                </span>
              </span>
            </label>
            <div>
              <label className="form-label">Visibility preference <span className="font-normal">(admin approval required)</span></label>
              <select value={form.visibility_preference} onChange={e=>setForm({...form,visibility_preference:e.target.value})}
                className="form-input" data-testid="profile-visibility">
                <option value="visible">Visible to group</option>
                <option value="limited">Limited visibility</option>
                <option value="hidden">Hidden (admin still sees)</option>
              </select>
              {user?.visibility_status && (
                <div className="text-xs mt-1.5" style={{color:"var(--muted)"}}>
                  Current: <b>{user.visibility_preference}</b> · Status: <b>{user.visibility_status}</b>
                </div>
              )}
            </div>
          </section>

          <section className="card-tactile p-4 sm:p-6 space-y-4">
            <div className="label-eyebrow">Bank account (for payouts)</div>
            {[
              ["bank_name","Bank name"],
              ["bank_account_number","Account number"],
              ["bank_account_name","Account name"],
            ].map(([k, l]) => (
              <div key={k}>
                <label className="form-label">{l}</label>
                <input value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})}
                  className="form-input" data-testid={`profile-${k}`} />
              </div>
            ))}
          </section>

          {err && <div className="text-red-700 text-sm px-1" data-testid="profile-error">{err}</div>}
          {msg && <div className="text-sm px-1" style={{color:"var(--primary)"}} data-testid="profile-msg">{msg}</div>}
          <button className="btn-primary w-full sm:w-auto" data-testid="profile-save">Save changes</button>
        </form>
      </main>
    </div>
  );
}
