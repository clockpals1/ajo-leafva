import React, { useEffect, useState } from "react";
import api, { fmtDate, formatErr } from "../api";
import { Mail, MessageCircle, Copy, X, Check, Send } from "lucide-react";

export default function InvitationsPanel({ groupId }) {
  const [items, setItems] = useState([]);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [sendWhatsapp, setSendWhatsapp] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get(`/admin/invitations?group_id=${groupId}`).then(r=>setItems(r.data));
  useEffect(() => { load(); }, [groupId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault(); setErr(""); setMsg(""); setBusy(true);
    try {
      const res = await api.post("/admin/invitations", {
        group_id: groupId, email: email || null, phone: phone || null,
        send_email: sendEmail, send_whatsapp: sendWhatsapp, note,
      });
      setEmail(""); setPhone(""); setNote("");
      setMsg("Invitation created and sent.");
      load();
      if (res.data?.invite_url) {
        navigator.clipboard?.writeText(res.data.invite_url);
      }
    } catch (e) { setErr(formatErr(e?.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  const revoke = async (id) => {
    if (!window.confirm("Revoke this invitation? The link will no longer work.")) return;
    await api.delete(`/admin/invitations/${id}`); load();
  };

  const copy = (link, id) => {
    navigator.clipboard?.writeText(link);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const statusClass = (s) => s === "accepted" ? "s-Paid" : s === "pending" ? "s-Submitted" : "s-Rejected";

  return (
    <div className="space-y-6">
      {/* ── Create invitation form ── */}
      <form onSubmit={submit} className="card-tactile p-4 sm:p-5" data-testid="invite-create-form">
        <h3 className="font-display text-lg mb-1 flex items-center gap-2"><Send size={16}/> Send personal invitation</h3>
        <p className="text-xs mb-4" style={{color:"var(--muted)"}}>
          Each invitation is tied to one email address — only that person can use it to join.
        </p>
        <div className="grid sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="form-label">Member email <span className="text-red-600">*</span></label>
            <input type="email" required value={email} onChange={e=>setEmail(e.target.value)}
              className="form-input" placeholder="amaka@example.com" data-testid="invite-email" />
          </div>
          <div>
            <label className="form-label">Phone <span className="font-normal">(optional, for WhatsApp)</span></label>
            <input value={phone} onChange={e=>setPhone(e.target.value)}
              className="form-input" placeholder="+2348012345678" data-testid="invite-phone" />
          </div>
        </div>
        <div className="mb-3">
          <label className="form-label">Personal note <span className="font-normal">(optional — shown on invite page)</span></label>
          <textarea value={note} onChange={e=>setNote(e.target.value)} rows={2}
            className="form-input" placeholder="e.g. Hi Amaka, you're invited to the Jan savings group!" data-testid="invite-note" />
        </div>
        <div className="flex flex-wrap gap-4 text-sm mb-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="w-4 h-4" checked={sendEmail} onChange={e=>setSendEmail(e.target.checked)} data-testid="invite-toggle-email"/>
            Send link by email
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="w-4 h-4" checked={sendWhatsapp} onChange={e=>setSendWhatsapp(e.target.checked)} data-testid="invite-toggle-wa"/>
            Send via WhatsApp
          </label>
        </div>
        {err && <div className="px-3 py-2.5 rounded-lg text-sm font-medium mb-3" style={{background:"#fef2f2",color:"#b91c1c"}} data-testid="invite-err">{err}</div>}
        {msg && <div className="px-3 py-2.5 rounded-lg text-sm font-medium mb-3" style={{background:"#f0fdf4",color:"#16a34a"}} data-testid="invite-msg">{msg}</div>}
        <button disabled={busy} className="btn-primary text-sm w-full sm:w-auto" data-testid="invite-submit">
          {busy ? "Sending…" : "Send invitation"}
        </button>
      </form>

      {/* ── Invitations list ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-base">Sent invitations ({items.length})</h3>
          <button onClick={load} className="text-xs" style={{color:"var(--muted)"}}>Refresh</button>
        </div>
        <div className="card-tactile overflow-hidden" data-testid="invites-table">
          {/* Mobile cards */}
          <div className="mobile-list-card divide-y" style={{borderColor:"var(--border)"}}>
            {items.map(i => {
              const link = `${window.location.origin}/invite/${i.token}`;
              const isCopied = copied === i.id;
              return (
                <div key={i.id} className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      {i.email && <div className="flex items-center gap-1.5 text-sm font-semibold truncate"><Mail size={13}/> {i.email}</div>}
                      {i.phone && <div className="flex items-center gap-1.5 text-xs mt-0.5" style={{color:"var(--muted)"}}><MessageCircle size={12}/> {i.phone}</div>}
                      <div className="text-xs mt-1" style={{color:"var(--muted)"}}>{fmtDate(i.created_at)}</div>
                    </div>
                    <span className={`badge shrink-0 ${statusClass(i.status)}`}>{i.status}</span>
                  </div>
                  {i.note && <div className="text-xs italic mb-2 px-2 py-1.5 rounded" style={{background:"var(--surface)",color:"var(--muted)"}}>{i.note}</div>}
                  <div className="flex items-center gap-2 mt-2">
                    <button onClick={()=>copy(link, i.id)}
                      className="flex-1 text-xs font-medium py-2 rounded-lg border inline-flex items-center justify-center gap-1.5 transition-colors"
                      style={isCopied ? {background:"#f0fdf4",color:"#16a34a",borderColor:"#86efac"} : {borderColor:"var(--border)",color:"var(--primary)"}}
                      data-testid={`copy-${i.id}`}>
                      {isCopied ? <><Check size={12}/> Copied!</> : <><Copy size={12}/> Copy invite link</>}
                    </button>
                    {i.status === "pending" && (
                      <button onClick={()=>revoke(i.id)}
                        className="text-xs py-2 px-3 rounded-lg border inline-flex items-center gap-1"
                        style={{color:"#b91c1c",borderColor:"#fecaca",background:"#fef2f2"}}
                        data-testid={`revoke-${i.id}`}><X size={12}/> Revoke</button>
                    )}
                  </div>
                </div>
              );
            })}
            {items.length===0 && (
              <div className="px-4 py-10 text-center text-sm" style={{color:"var(--muted)"}}>
                No invitations yet. Send a personal invite above.
              </div>
            )}
          </div>
          {/* Desktop table */}
          <table className="desktop-table w-full text-sm">
            <thead className="bg-white/50"><tr className="text-left">
              <th className="px-4 py-3 label-eyebrow">Sent</th>
              <th className="px-4 py-3 label-eyebrow">Recipient</th>
              <th className="px-4 py-3 label-eyebrow">Note</th>
              <th className="px-4 py-3 label-eyebrow">Status</th>
              <th className="px-4 py-3 label-eyebrow"></th>
            </tr></thead>
            <tbody>
              {items.map(i => {
                const link = `${window.location.origin}/invite/${i.token}`;
                const isCopied = copied === i.id;
                return (
                  <tr key={i.id} className="border-t" style={{borderColor:"var(--border)"}}>
                    <td className="px-4 py-3 text-xs" style={{color:"var(--muted)"}}>{fmtDate(i.created_at)}</td>
                    <td className="px-4 py-3">
                      {i.email && <div className="flex items-center gap-1 text-xs"><Mail size={11}/> {i.email}</div>}
                      {i.phone && <div className="flex items-center gap-1 text-xs mt-0.5" style={{color:"var(--muted)"}}><MessageCircle size={11}/> {i.phone}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs italic max-w-xs" style={{color:"var(--muted)"}}>{i.note || "—"}</td>
                    <td className="px-4 py-3"><span className={`badge ${statusClass(i.status)}`}>{i.status}</span></td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={()=>copy(link, i.id)}
                          className="text-xs inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border transition-colors"
                          style={isCopied ? {background:"#f0fdf4",color:"#16a34a",borderColor:"#86efac"} : {borderColor:"var(--border)",color:"var(--primary)"}}
                          data-testid={`copy-${i.id}`}>
                          {isCopied ? <><Check size={11}/> Copied</> : <><Copy size={11}/> Copy link</>}
                        </button>
                        {i.status === "pending" && (
                          <button onClick={()=>revoke(i.id)} className="text-xs text-red-700 inline-flex items-center gap-1 px-2 py-1.5" data-testid={`revoke-${i.id}`}>
                            <X size={11}/> Revoke
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {items.length===0 && <tr><td colSpan={5} className="px-4 py-10 text-center" style={{color:"var(--muted)"}}>No invitations yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
