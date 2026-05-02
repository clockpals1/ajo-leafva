import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import api, { fmtMoney, fmtDate, formatErr } from "../api";
import { useAuth } from "../AuthContext";
import { CheckCircle2, AlertTriangle } from "lucide-react";

export default function InvitePage() {
  const { token } = useParams();
  const nav = useNavigate();
  const { user, refresh } = useAuth();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [accepted, setAcceptedRules] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.get(`/invite/${token}`).then(r => setData(r.data)).catch(e => setErr(formatErr(e?.response?.data?.detail)));
  }, [token]);

  if (err) return <div className="min-h-screen bg-app flex items-center justify-center p-6"><div className="card-tactile p-8 max-w-md text-center"><AlertTriangle className="mx-auto mb-3" /><div className="font-display text-xl">Invitation unavailable</div><div className="text-sm mt-2" style={{color:"var(--muted)"}}>{err}</div><Link to="/" className="btn-secondary inline-block mt-6 text-sm">Go home</Link></div></div>;
  if (!data) return <div className="min-h-screen bg-app flex items-center justify-center">Loading invitation…</div>;

  if (data.status && data.status !== "pending") {
    return (
      <div className="min-h-screen bg-app flex items-center justify-center p-6">
        <div className="card-tactile p-8 max-w-md text-center" data-testid="invite-unavailable">
          <AlertTriangle className="mx-auto mb-3" />
          <div className="font-display text-xl">Invitation {data.status}</div>
          <Link to="/" className="btn-secondary inline-block mt-6 text-sm">Go home</Link>
        </div>
      </div>
    );
  }

  const group = data.group;
  const submit = async (e) => {
    e.preventDefault();
    if (!accepted) return setErr("You must accept the group rules.");
    setBusy(true); setErr("");
    try {
      const body = { accepted_rules: true };
      if (!user) { body.name = name; body.password = password; }
      const { data: res } = await api.post(`/invite/${token}/accept`, body);
      await refresh();
      setDone(true);
      setTimeout(()=> nav(`/groups/${res.group_id}`), 1200);
    } catch (e) { setErr(formatErr(e?.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  if (done) return <div className="min-h-screen bg-app flex items-center justify-center p-6"><div className="card-tactile p-8 max-w-md text-center"><CheckCircle2 className="mx-auto mb-3" style={{color:"var(--primary)"}} size={36}/><div className="font-display text-2xl">You're in!</div><div className="text-sm mt-2" style={{color:"var(--muted)"}}>Redirecting to your group…</div></div></div>;

  return (
    <div className="min-h-screen bg-app">
      <header className="max-w-5xl mx-auto px-6 py-6 flex items-center gap-2">
        <div className="w-8 h-8 rounded-full" style={{ background: "var(--primary)" }}></div>
        <div className="font-display text-xl">Ajo</div>
      </header>
      <main className="max-w-3xl mx-auto px-6 pb-16">
        <div className="label-eyebrow">You're invited</div>
        <h1 className="font-display text-4xl mt-2">Join <span style={{color:"var(--secondary)"}}>{group.name}</span></h1>
        {data.invitation.note && <p className="mt-3 text-sm italic" style={{color:"var(--muted)"}}>“{data.invitation.note}”</p>}

        <section className="card-tactile p-6 mt-8">
          <div className="label-eyebrow mb-3">Group details</div>
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div><div className="label-eyebrow">Contribution</div><div className="font-display text-xl">{fmtMoney(group.contribution_amount)}</div></div>
            <div><div className="label-eyebrow">Frequency</div><div className="font-display text-xl">{group.frequency}</div></div>
            <div><div className="label-eyebrow">Cycles</div><div className="font-display text-xl">{group.total_cycles}</div></div>
            <div><div className="label-eyebrow">Start date</div><div className="font-display text-xl">{fmtDate(group.start_date)}</div></div>
            <div><div className="label-eyebrow">Due day · time</div><div className="font-display text-xl">{group.due_day} · {group.due_time}</div></div>
            <div><div className="label-eyebrow">Late fee</div><div className="font-display text-xl">{fmtMoney(group.late_fee_amount)}</div></div>
          </div>
          {group.description && <p className="text-sm mt-4" style={{color:"var(--muted)"}}>{group.description}</p>}
        </section>

        <section className="card-tactile p-6 mt-6" data-testid="rules-section">
          <div className="label-eyebrow mb-3">Group rules</div>
          {group.rules_text ? (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{group.rules_text}</pre>
          ) : (
            <ul className="text-sm space-y-2 list-disc pl-5" style={{color:"var(--text)"}}>
              <li>Contribute {fmtMoney(group.contribution_amount)} {group.frequency} by the {group.due_day} of each cycle.</li>
              <li>Upload payment proof from your dashboard. An admin must approve before it counts.</li>
              <li>Late payments may attract a {fmtMoney(group.late_fee_amount)} fee after a {group.grace_period_days}-day grace period.</li>
              <li>Payouts follow the payout order set by the admin; one member is paid each cycle.</li>
              <li>You cannot approve your own payments. Only admins confirm payments and payouts.</li>
              <li>Your privacy preference is respected but always visible to the admin for accountability.</li>
            </ul>
          )}
        </section>

        <form onSubmit={submit} className="card-tactile p-6 mt-6" data-testid="invite-form">
          <div className="label-eyebrow mb-3">Join this group</div>
          {!user && (
            <div className="grid gap-3 sm:grid-cols-2 mb-4">
              <div>
                <label className="label-eyebrow block mb-1">Your name</label>
                <input required value={name} onChange={e=>setName(e.target.value)} className="w-full border rounded px-3 py-2" data-testid="invite-name" />
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Create a password (6+)</label>
                <input type="password" minLength={6} required value={password} onChange={e=>setPassword(e.target.value)} className="w-full border rounded px-3 py-2" data-testid="invite-password" />
              </div>
              <div className="sm:col-span-2 text-xs" style={{color:"var(--muted)"}}>Account will be created with <b>{data.invitation.email}</b>.</div>
            </div>
          )}
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={accepted} onChange={e=>setAcceptedRules(e.target.checked)} className="mt-1" data-testid="invite-accept-rules" />
            <span className="text-sm">I have read and I accept the rules of <b>{group.name}</b>. I understand that an admin must approve my payments and that I cannot self-join or modify group rules.</span>
          </label>
          {err && <div className="text-sm text-red-700 mt-3" data-testid="invite-error">{err}</div>}
          <button disabled={busy || !accepted} className="btn-primary mt-5 w-full" data-testid="invite-submit">
            {busy ? "Joining…" : user ? "Accept and join" : "Create account and join"}
          </button>
        </form>
      </main>
    </div>
  );
}
