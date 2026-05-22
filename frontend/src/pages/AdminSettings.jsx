import React, { useEffect, useState } from "react";
import api, { formatErr, fmtMoney } from "../api";
import TopNav from "../components/TopNav";
import { Sparkles, Send, Users, Loader2, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";

export default function AdminSettings() {
  const [s, setS] = useState(null);
  const [form, setForm] = useState({});
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [emailCfg, setEmailCfg] = useState(null);

  const load = async () => {
    const { data } = await api.get("/admin/settings");
    setS(data);
    api.get("/admin/email-config").then(r => setEmailCfg(r.data)).catch(() => {});
    setForm({
      brand_name: data.brand_name, support_email: data.support_email,
      resend_sender: data.resend_sender, resend_api_key: "",
      twilio_account_sid: "", twilio_auth_token: "", twilio_whatsapp_from: data.twilio_whatsapp_from,
      frontend_url: data.frontend_url,
      smtp_host: data.smtp_host, smtp_port: String(data.smtp_port || 587),
      smtp_user: data.smtp_user, smtp_password: "",
      smtp_from: data.smtp_from, smtp_secure: data.smtp_secure || false,
      groq_api_key: "", groq_model: data.groq_model || "llama-3.3-70b-versatile",
    });
  };
  useEffect(() => { load(); }, []);

  const [testEmailMsg, setTestEmailMsg] = useState("");
  const [testEmailBusy, setTestEmailBusy] = useState(false);

  const [aiEmailGroup, setAiEmailGroup] = useState("");
  const [aiEmailType, setAiEmailType] = useState("summary");
  const [aiEmailBusy, setAiEmailBusy] = useState(false);
  const [aiEmailResult, setAiEmailResult] = useState(null);
  const [groups, setGroups] = useState([]);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    api.get("/admin/groups").then(r => setGroups(r.data)).catch(() => {});
  }, []);

  const sendAiEmails = async () => {
    setAiEmailBusy(true); setAiEmailResult(null);
    try {
      const payload = { email_type: aiEmailType };
      if (aiEmailGroup) payload.group_id = aiEmailGroup;
      const { data } = await api.post("/admin/ai/send-summary-emails", payload);
      setAiEmailResult({ ok: true, msg: `✓ Sent to ${data.sent} member${data.sent !== 1 ? "s" : ""}${data.errors?.length ? ` (${data.errors.length} failed)` : ""}` });
    } catch (e) { setAiEmailResult({ ok: false, msg: formatErr(e?.response?.data?.detail) }); }
    finally { setAiEmailBusy(false); }
  };

  const previewAiEmail = async () => {
    setPreviewBusy(true); setPreview(null);
    try {
      const payload = { email_type: aiEmailType };
      if (aiEmailGroup) payload.group_id = aiEmailGroup;
      const { data } = await api.post("/admin/ai/preview-summary-email", payload);
      setPreview(data.preview);
    } catch (e) { alert(formatErr(e?.response?.data?.detail) || "Preview failed"); }
    finally { setPreviewBusy(false); }
  };

  const save = async (e) => {
    e.preventDefault(); setErr(""); setMsg("");
    try {
      const payload = Object.fromEntries(
        Object.entries(form).filter(([, v]) => typeof v === "boolean" || (v !== null && v !== undefined && v !== ""))
      );
      if (payload.smtp_port) payload.smtp_port = parseInt(payload.smtp_port, 10) || 587;
      await api.put("/admin/settings", payload);
      setMsg("Settings saved."); load();
    } catch (e) { setErr(formatErr(e?.response?.data?.detail)); }
  };

  const sendTestEmail = async () => {
    setTestEmailBusy(true); setTestEmailMsg("");
    try {
      const r = await api.post("/admin/test-email");
      setTestEmailMsg(`✓ Test email sent to ${r.data.sent_to}. Check your inbox.`);
    } catch (e) {
      setTestEmailMsg(`✗ ${formatErr(e?.response?.data?.detail) || "Failed — check your SMTP settings and try again."}`);
    } finally { setTestEmailBusy(false); }
  };

  if (!s) return <div className="min-h-screen bg-app"><TopNav /><div className="p-10">Loading…</div></div>;

  return (
    <div className="min-h-screen bg-app">
      <TopNav />

      {/* ── Email Preview Modal ── */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.55)"}} onClick={()=>setPreview(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e=>e.stopPropagation()}>
            <div className="flex items-start justify-between px-5 py-4 border-b" style={{borderColor:"var(--border)"}}>
              <div>
                <h3 className="font-display text-lg">Email Preview</h3>
                <p className="text-xs mt-0.5" style={{color:"var(--muted)"}}>
                  Sample for: <strong>{preview.recipient_name}</strong> ({preview.recipient_email})
                </p>
              </div>
              <button onClick={()=>setPreview(null)} className="p-2 rounded-lg hover:bg-gray-100 -mt-1 -mr-1">
                <ChevronUp size={18}/>
              </button>
            </div>
            <div className="px-5 py-3 border-b flex gap-6 text-xs" style={{borderColor:"var(--border)",background:"var(--surface)"}}>
              <div><span style={{color:"var(--muted)"}}>Subject:</span> <strong>{preview.subject}</strong></div>
            </div>
            <div className="overflow-y-auto flex-1 p-5">
              <div className="text-sm font-semibold mb-2" style={{color:"var(--primary)"}}>{preview.heading}</div>
              <div className="text-sm leading-relaxed" style={{color:"#374151"}}
                dangerouslySetInnerHTML={{__html: preview.body_html}} />
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-3" style={{borderColor:"var(--border)"}}>
              <button onClick={()=>setPreview(null)} className="btn-secondary text-sm">Close</button>
              <button onClick={()=>{ setPreview(null); sendAiEmails(); }} disabled={aiEmailBusy}
                className="btn-primary text-sm inline-flex items-center gap-2">
                <Send size={14}/> Looks good — send
              </button>
            </div>
          </div>
        </div>
      )}
      <main className="max-w-3xl mx-auto px-6 py-10">
        <div className="label-eyebrow mb-2">Admin · Platform Settings</div>
        <h1 className="font-display text-3xl mb-2">System configuration</h1>

        {emailCfg && (
          <div className="mb-6 card-tactile p-4 text-sm" style={{borderLeft:"3px solid var(--primary)", background:emailCfg.active_channel==="none"?"#fef2f2":"var(--surface)"}}>
            <div className="font-semibold mb-1">Active email channel: <span style={{color:emailCfg.active_channel==="none"?"#b91c1c":"var(--primary)"}}>{emailCfg.active_channel.toUpperCase()}</span></div>
            {emailCfg.active_channel==="none" && <div className="text-red-700">⚠ No email channel is active — broadcasts will not send emails.</div>}
            {emailCfg.active_channel==="smtp" && <div>Sending from: <code>{emailCfg.smtp.from}</code> via <code>{emailCfg.smtp.host}:{emailCfg.smtp.port}</code> ({emailCfg.smtp.secure?"SSL/TLS":"STARTTLS"})</div>}
            {emailCfg.active_channel==="resend" && <div>Sending from: <code>{emailCfg.resend.sender}</code> via Resend API</div>}
            {emailCfg.resend.key_set && !emailCfg.resend.sender && (
              <div className="text-red-700 mt-1">⚠ Resend API key is set but <b>Sender email is empty</b>. Fill in the Sender email field below (must be on your verified domain).</div>
            )}
            {emailCfg.smtp.configured && emailCfg.smtp.secure && emailCfg.smtp.port===587 && (
              <div className="text-amber-700 mt-1">⚠ SMTP is set to SSL/TLS mode but port is 587. Use 465 for SSL, or uncheck SSL for STARTTLS on 587.</div>
            )}
            {emailCfg.smtp.configured && !emailCfg.smtp.secure && emailCfg.smtp.port===465 && (
              <div className="text-amber-700 mt-1">⚠ Port is 465 but SSL/TLS is unchecked. Tick the SSL checkbox for port 465.</div>
            )}
          </div>
        )}

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
            {!s.has_resend && (
              <p className="text-xs text-red-700 font-medium">⚠ No Resend API key saved yet — enter it below and save.</p>
            )}
            <Field label="API key (set / replace)" value={form.resend_api_key} onChange={v=>setForm({...form, resend_api_key:v})} testid="setting-resend-key" placeholder="re_... (must re-enter to update)" />
            <Field label="Sender email (REQUIRED — must match your verified Resend domain)" value={form.resend_sender||""} onChange={v=>setForm({...form, resend_sender:v})} testid="setting-resend-sender" placeholder="noreply@ajo.leafva.com" />
            {s.has_resend && !s.resend_sender && (
              <p className="text-xs text-red-700 font-medium">⚠ Sender email is not set — all emails will fail. Enter an address on your verified domain above.</p>
            )}
            <p className="text-xs" style={{color:"var(--muted)"}}>Domain must be DNS-verified on Resend. The sender must be an address on that verified domain (e.g. noreply@ajo.leafva.com).</p>
          </Section>

          <Section title="Email — SMTP (Hostinger / cPanel / Gmail)">
            <p className="text-xs" style={{color:"var(--muted)"}}>
              If configured, SMTP is used <b>first</b>. Resend is the fallback. Leave password empty to keep the current value.
            </p>
            <Info label="SMTP status" value={s.has_smtp ? "configured" : "not set"} status={s.has_smtp ? "ok" : "off"} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="SMTP host" value={form.smtp_host||""} onChange={v=>setForm({...form,smtp_host:v})} testid="setting-smtp-host" placeholder="mail.yourdomain.com" />
              <Field label="Port" value={form.smtp_port||""} onChange={v=>setForm({...form,smtp_port:v})} testid="setting-smtp-port" placeholder="587" />
            </div>
            <Field label="SMTP username (usually your full email)" value={form.smtp_user||""} onChange={v=>setForm({...form,smtp_user:v})} testid="setting-smtp-user" placeholder="noreply@yourdomain.com" />
            <Field label="SMTP password (set / replace)" value={form.smtp_password||""} onChange={v=>setForm({...form,smtp_password:v})} testid="setting-smtp-pw" type="password" placeholder={s.smtp_password_masked || "leave empty to keep current"} />
            <Field label="From address (optional — defaults to SMTP username)" value={form.smtp_from||""} onChange={v=>setForm({...form,smtp_from:v})} testid="setting-smtp-from" placeholder="Ajo Platform &lt;noreply@yourdomain.com&gt;" />
            <label className="flex items-center gap-2.5 cursor-pointer py-1">
              <input type="checkbox" checked={!!form.smtp_secure} onChange={e=>setForm({...form,smtp_secure:e.target.checked})} className="w-5 h-5" />
              <span className="text-sm">Use SSL/TLS on connect (port 465). Uncheck for STARTTLS (port 587).</span>
            </label>
            <div className="flex items-center gap-3 pt-1">
              <button type="button" disabled={testEmailBusy} onClick={sendTestEmail}
                className="btn-secondary text-sm inline-flex items-center gap-1.5">
                {testEmailBusy ? "Sending…" : "Send test email to me"}
              </button>
              {testEmailMsg && (
                <span className="text-sm" style={{color: testEmailMsg.startsWith("✓") ? "var(--primary)" : "#b91c1c"}}>
                  {testEmailMsg}
                </span>
              )}
            </div>
            <p className="text-xs" style={{color:"var(--muted)"}}>Saves settings first, then sends a test email to your admin account. Use this to confirm SMTP is working before broadcasting.</p>
          </Section>

          <Section title="WhatsApp — Twilio">
            <Info label="Status" value={s.has_twilio ? "active" : "not configured"} status={s.has_twilio ? "ok" : "off"} />
            <Field label="Twilio Account SID" value={form.twilio_account_sid} onChange={v=>setForm({...form, twilio_account_sid:v})} testid="setting-twilio-sid" placeholder={s.twilio_account_sid_masked || "ACxxxxxx..."} />
            <Field label="Twilio Auth Token" value={form.twilio_auth_token} onChange={v=>setForm({...form, twilio_auth_token:v})} testid="setting-twilio-token" placeholder={s.twilio_auth_token_masked || "secret token"} />
            <Field label="WhatsApp-enabled from number" value={form.twilio_whatsapp_from||""} onChange={v=>setForm({...form, twilio_whatsapp_from:v})} testid="setting-twilio-from" placeholder="whatsapp:+14155238886" />
          </Section>

          <Section title={<span className="flex items-center gap-2"><Sparkles size={14} style={{color:"var(--primary)"}}/> AI Assistant — Groq (Open-Source Llama 3)</span>}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`badge ${s.has_groq ? "s-Paid" : "s-Not_Due"}`}>{s.has_groq ? "Active" : "Not configured"}</span>
              {s.has_groq && <span className="text-xs" style={{color:"var(--muted)"}}>Key: {s.groq_api_key_masked} · Model: {s.groq_model}</span>}
            </div>
            {!s.has_groq && (
              <p className="text-xs text-amber-700 font-medium mb-2">
                ⚡ Get a free API key at{" "}
                <a href="https://console.groq.com" target="_blank" rel="noreferrer" className="underline">console.groq.com</a>
                {" "}— uses open-source Llama 3 models, no credit card needed.
              </p>
            )}
            <Field label="Groq API key (set / replace)" value={form.groq_api_key} onChange={v=>setForm({...form,groq_api_key:v})} placeholder="gsk_... (leave empty to keep current)" />
            <div>
              <label className="block text-xs mb-1" style={{color:"var(--muted)"}}>AI model</label>
              <select value={form.groq_model} onChange={e=>setForm({...form,groq_model:e.target.value})}
                className="w-full border rounded px-3 py-2 bg-white text-sm">
                <option value="llama-3.3-70b-versatile">Llama 3.3 70B — Best quality (recommended)</option>
                <option value="llama-3.1-8b-instant">Llama 3.1 8B — Fastest / lowest latency</option>
                <option value="gemma2-9b-it">Gemma 2 9B — Google open-source</option>
                <option value="mixtral-8x7b-32768">Mixtral 8x7B — Long context</option>
              </select>
            </div>
            <p className="text-xs mt-1" style={{color:"var(--muted)"}}>
              Powers: AI group creation from prompts · Personalised member email summaries · Contribution reminders.
            </p>
          </Section>

          <Section title={<span className="flex items-center gap-2"><Send size={14} style={{color:"var(--primary)"}}/> AI Email Bot — Member Summaries &amp; Reminders</span>}>
            <p className="text-xs mb-3" style={{color:"var(--muted)"}}>
              Send AI-personalised emails to members with their group summary, slot info, payout details and contribution status.
              Works without a Groq key — AI enhances the tone when a key is configured.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1" style={{color:"var(--muted)"}}>Target group</label>
                <select value={aiEmailGroup} onChange={e=>setAiEmailGroup(e.target.value)}
                  className="w-full border rounded px-3 py-2 bg-white text-sm">
                  <option value="">All groups (all members)</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1" style={{color:"var(--muted)"}}>Email type</label>
                <select value={aiEmailType} onChange={e=>setAiEmailType(e.target.value)}
                  className="w-full border rounded px-3 py-2 bg-white text-sm">
                  <option value="summary">📋 Full Ajo Summary</option>
                  <option value="reminder">⏰ Contribution Reminder</option>
                </select>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <button type="button" disabled={previewBusy} onClick={previewAiEmail}
                className="btn-secondary text-sm inline-flex items-center gap-2">
                {previewBusy ? <><Loader2 size={14} className="animate-spin"/> Loading…</> : <><ChevronDown size={14}/> Preview email</>}
              </button>
              <button type="button" disabled={aiEmailBusy} onClick={sendAiEmails}
                className="btn-primary text-sm inline-flex items-center gap-2">
                {aiEmailBusy ? <><Loader2 size={14} className="animate-spin"/> Sending…</> : <><Send size={14}/> Send emails</>}
              </button>
              {aiEmailResult && (
                <span className="text-sm flex items-center gap-1" style={{color: aiEmailResult.ok ? "var(--primary)" : "#b91c1c"}}>
                  {aiEmailResult.ok ? <CheckCircle2 size={14}/> : <AlertTriangle size={14}/>}
                  {aiEmailResult.msg}
                </span>
              )}
            </div>
            <p className="text-xs mt-2" style={{color:"var(--muted)"}}>
              Each member receives a personalised email showing: their groups, slot numbers, monthly contributions, payout totals, payout months, and payment status.
            </p>
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
