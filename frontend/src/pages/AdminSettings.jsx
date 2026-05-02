import React, { useEffect, useState } from "react";
import api, { formatErr } from "../api";
import TopNav from "../components/TopNav";

export default function AdminSettings() {
  const [s, setS] = useState(null);
  const [form, setForm] = useState({});
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = async () => {
    const { data } = await api.get("/admin/settings");
    setS(data);
    setForm({
      brand_name: data.brand_name, support_email: data.support_email,
      resend_sender: data.resend_sender, resend_api_key: "",
      twilio_account_sid: "", twilio_auth_token: "", twilio_whatsapp_from: data.twilio_whatsapp_from,
      frontend_url: data.frontend_url,
    });
  };
  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault(); setErr(""); setMsg("");
    try {
      const payload = Object.fromEntries(Object.entries(form).filter(([,v]) => v && v !== ""));
      await api.put("/admin/settings", payload);
      setMsg("Settings saved."); load();
    } catch (e) { setErr(formatErr(e?.response?.data?.detail)); }
  };

  if (!s) return <div className="min-h-screen bg-app"><TopNav /><div className="p-10">Loading…</div></div>;

  return (
    <div className="min-h-screen bg-app">
      <TopNav />
      <main className="max-w-3xl mx-auto px-6 py-10">
        <div className="label-eyebrow mb-2">Admin · Platform Settings</div>
        <h1 className="font-display text-3xl mb-2">System configuration</h1>
        <p className="text-sm mb-8" style={{color:"var(--muted)"}}>
          All platform config lives here — secrets are masked. Leave a secret field empty to keep the current value.
        </p>

        <form onSubmit={save} className="space-y-6" data-testid="settings-form">
          <Section title="Brand">
            <Field label="Brand name" value={form.brand_name||""} onChange={v=>setForm({...form, brand_name:v})} testid="setting-brand" />
            <Field label="Support email" value={form.support_email||""} onChange={v=>setForm({...form, support_email:v})} testid="setting-support" type="email" />
            <Field label="Frontend URL (used in email / invite links)" value={form.frontend_url||""} onChange={v=>setForm({...form, frontend_url:v})} testid="setting-fe" />
          </Section>

          <Section title="Email — Resend">
            <Info label="API key (current)" value={s.resend_api_key_masked || "not set"} status={s.has_resend ? "ok" : "off"} />
            <Field label="API key (set / replace)" value={form.resend_api_key} onChange={v=>setForm({...form, resend_api_key:v})} testid="setting-resend-key" placeholder="re_..." />
            <Field label="Sender email" value={form.resend_sender||""} onChange={v=>setForm({...form, resend_sender:v})} testid="setting-resend-sender" placeholder="noreply@yourdomain.com" />
            <p className="text-xs" style={{color:"var(--muted)"}}>Domain must be DNS-verified on Resend to deliver reliably.</p>
          </Section>

          <Section title="WhatsApp — Twilio">
            <Info label="Status" value={s.has_twilio ? "active" : "not configured"} status={s.has_twilio ? "ok" : "off"} />
            <Field label="Twilio Account SID" value={form.twilio_account_sid} onChange={v=>setForm({...form, twilio_account_sid:v})} testid="setting-twilio-sid" placeholder={s.twilio_account_sid_masked || "ACxxxxxx..."} />
            <Field label="Twilio Auth Token" value={form.twilio_auth_token} onChange={v=>setForm({...form, twilio_auth_token:v})} testid="setting-twilio-token" placeholder={s.twilio_auth_token_masked || "secret token"} />
            <Field label="WhatsApp-enabled from number" value={form.twilio_whatsapp_from||""} onChange={v=>setForm({...form, twilio_whatsapp_from:v})} testid="setting-twilio-from" placeholder="whatsapp:+14155238886" />
          </Section>

          {msg && <div className="text-sm" style={{color:"var(--primary)"}} data-testid="settings-msg">{msg}</div>}
          {err && <div className="text-sm text-red-700" data-testid="settings-err">{err}</div>}
          <button className="btn-primary" data-testid="settings-save">Save settings</button>
        </form>
      </main>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="card-tactile p-6 space-y-3">
      <div className="label-eyebrow">{title}</div>
      {children}
    </div>
  );
}
function Field({ label, value, onChange, testid, type="text", placeholder="" }) {
  return (
    <div>
      <label className="block text-xs mb-1" style={{color:"var(--muted)"}}>{label}</label>
      <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        className="w-full border rounded px-3 py-2 bg-white" data-testid={testid} />
    </div>
  );
}
function Info({ label, value, status }) {
  return (
    <div className="flex items-center justify-between text-sm border-b pb-2" style={{borderColor:"var(--border)"}}>
      <span style={{color:"var(--muted)"}}>{label}</span>
      <span className={`badge ${status==="ok"?"s-Paid":"s-Not_Due"}`}>{value}</span>
    </div>
  );
}
