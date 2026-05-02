import React, { useEffect, useState } from "react";
import api, { fmtDate, formatErr } from "../api";
import { Mail, MessageCircle, Copy, X } from "lucide-react";

export default function InvitationsPanel({ groupId }) {
  const [items, setItems] = useState([]);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [sendWhatsapp, setSendWhatsapp] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api.get(`/admin/invitations?group_id=${groupId}`).then(r=>setItems(r.data));
  useEffect(() => { load(); }, [groupId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault(); setErr(""); setMsg(""); setBusy(true);
    try {
      await api.post("/admin/invitations", {
        group_id: groupId, email: email || null, phone: phone || null,
        send_email: sendEmail, send_whatsapp: sendWhatsapp, note,
      });
      setEmail(""); setPhone(""); setNote("");
      setMsg("Invitation created and sent.");
      load();
    } catch (e) { setErr(formatErr(e?.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  const revoke = async (id) => {
    if (!window.confirm("Revoke this invitation?")) return;
    await api.delete(`/admin/invitations/${id}`); load();
  };

  const copy = (link) => { navigator.clipboard.writeText(link); setMsg("Link copied."); };

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <form onSubmit={submit} className="card-tactile p-5 lg:col-span-1" data-testid="invite-create-form">
        <h3 className="font-display text-lg mb-3">Invite a new member</h3>
        <label className="label-eyebrow block mb-1">Email</label>
        <input type="email" value={email} onChange={e=>setEmail(e.target.value)} className="w-full border rounded px-3 py-2 mb-3" data-testid="invite-email" />
        <label className="label-eyebrow block mb-1">Phone (E.164, e.g. +2348012345678)</label>
        <input value={phone} onChange={e=>setPhone(e.target.value)} className="w-full border rounded px-3 py-2 mb-3" data-testid="invite-phone" />
        <label className="label-eyebrow block mb-1">Note (optional)</label>
        <textarea value={note} onChange={e=>setNote(e.target.value)} rows={2} className="w-full border rounded px-3 py-2 mb-3" data-testid="invite-note" />
        <div className="flex flex-col gap-2 text-sm mb-3">
          <label className="flex items-center gap-2"><input type="checkbox" checked={sendEmail} onChange={e=>setSendEmail(e.target.checked)} data-testid="invite-toggle-email"/> Send via email</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={sendWhatsapp} onChange={e=>setSendWhatsapp(e.target.checked)} data-testid="invite-toggle-wa"/> Send via WhatsApp</label>
        </div>
        {err && <div className="text-sm text-red-700 mb-2" data-testid="invite-err">{err}</div>}
        {msg && <div className="text-sm mb-2" style={{color:"var(--primary)"}} data-testid="invite-msg">{msg}</div>}
        <button disabled={busy} className="btn-primary w-full text-sm" data-testid="invite-submit">{busy?"Sending…":"Send invitation"}</button>
      </form>

      <div className="lg:col-span-2 card-tactile overflow-hidden">
        <table className="w-full text-sm" data-testid="invites-table">
          <thead className="bg-white/50"><tr className="text-left">
            <th className="px-4 py-3 label-eyebrow">Sent</th>
            <th className="px-4 py-3 label-eyebrow">Recipient</th>
            <th className="px-4 py-3 label-eyebrow">Channels</th>
            <th className="px-4 py-3 label-eyebrow">Status</th>
            <th className="px-4 py-3 label-eyebrow"></th>
          </tr></thead>
          <tbody>
            {items.map(i => {
              const link = `${window.location.origin}/invite/${i.token}`;
              const channels = [];
              if (i.sent?.email) channels.push("email");
              if (i.sent?.whatsapp) channels.push("whatsapp");
              return (
                <tr key={i.id} className="border-t" style={{borderColor:"var(--border)"}}>
                  <td className="px-4 py-3">{fmtDate(i.created_at)}</td>
                  <td className="px-4 py-3">
                    {i.email && <div className="flex items-center gap-1 text-xs"><Mail size={12}/> {i.email}</div>}
                    {i.phone && <div className="flex items-center gap-1 text-xs"><MessageCircle size={12}/> {i.phone}</div>}
                  </td>
                  <td className="px-4 py-3 text-xs">{channels.join(" + ") || "—"}</td>
                  <td className="px-4 py-3"><span className={`badge ${i.status==="accepted"?"s-Paid":i.status==="pending"?"s-Submitted":"s-Rejected"}`}>{i.status}</span></td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button onClick={()=>copy(link)} className="text-xs inline-flex items-center gap-1" data-testid={`copy-${i.id}`}><Copy size={12}/> Copy link</button>
                    {i.status === "pending" && <button onClick={()=>revoke(i.id)} className="text-xs text-red-700 inline-flex items-center gap-1" data-testid={`revoke-${i.id}`}><X size={12}/> Revoke</button>}
                  </td>
                </tr>
              );
            })}
            {items.length===0 && <tr><td colSpan={5} className="px-4 py-10 text-center" style={{color:"var(--muted)"}}>No invitations yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
