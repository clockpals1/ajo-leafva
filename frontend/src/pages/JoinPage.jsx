import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import api, { fmtMoney, fmtDate, formatErr } from "../api";
import { useAuth } from "../AuthContext";
import { CheckCircle2, AlertTriangle, Users } from "lucide-react";

export default function JoinPage() {
  const { token } = useParams();
  const nav = useNavigate();
  const { user, refresh } = useAuth();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.get(`/join/${token}`)
      .then(r => setData(r.data))
      .catch(e => setErr(formatErr(e?.response?.data?.detail)));
  }, [token]);

  if (err) return (
    <div className="min-h-screen bg-app flex items-center justify-center p-6">
      <div className="card-tactile p-8 max-w-md w-full text-center">
        <AlertTriangle className="mx-auto mb-3" size={32} />
        <div className="font-display text-xl mb-2">Link unavailable</div>
        <div className="text-sm" style={{color:"var(--muted)"}}>{err}</div>
        <Link to="/" className="btn-secondary inline-block mt-6 text-sm">Go home</Link>
      </div>
    </div>
  );

  if (!data) return (
    <div className="min-h-screen bg-app flex items-center justify-center">
      <div className="text-sm" style={{color:"var(--muted)"}}>Loading group…</div>
    </div>
  );

  if (data.status && data.status !== "active") return (
    <div className="min-h-screen bg-app flex items-center justify-center p-6">
      <div className="card-tactile p-8 max-w-md w-full text-center">
        <AlertTriangle className="mx-auto mb-3" size={32} />
        <div className="font-display text-xl">Group {data.status}</div>
        <div className="text-sm mt-2" style={{color:"var(--muted)"}}>{data.group_name} is no longer accepting new members.</div>
        <Link to="/" className="btn-secondary inline-block mt-6 text-sm">Go home</Link>
      </div>
    </div>
  );

  if (done) return (
    <div className="min-h-screen bg-app flex items-center justify-center p-6">
      <div className="card-tactile p-8 max-w-sm w-full text-center">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{background:"var(--surface)"}}>
          <CheckCircle2 size={36} style={{color:"var(--primary)"}} />
        </div>
        <div className="font-display text-2xl">You're in!</div>
        <div className="text-sm mt-2" style={{color:"var(--muted)"}}>Taking you to your group…</div>
      </div>
    </div>
  );

  const group = data.group;

  const submit = async (e) => {
    e.preventDefault();
    if (!accepted) return setErr("You must accept the group rules to continue.");
    setBusy(true); setErr("");
    try {
      const body = { accepted_rules: true };
      if (!user) { body.name = name; body.email = email; body.password = password; }
      const { data: res } = await api.post(`/join/${token}/accept`, body);
      if (res.token) localStorage.setItem("ajo_token", res.token);
      await refresh();
      setDone(true);
      setTimeout(() => nav(`/groups/${res.group_id}`), 1200);
    } catch (e) { setErr(formatErr(e?.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-app">
      <header className="px-4 sm:px-6 py-4 flex items-center gap-2 border-b" style={{borderColor:"var(--border)"}}>
        <div className="w-7 h-7 rounded-full" style={{ background: "var(--primary)" }}></div>
        <div className="font-display text-lg">Ajo</div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 pb-16 pt-6">

        {/* Header */}
        <div className="mb-6">
          <div className="label-eyebrow mb-1">You've been invited</div>
          <h1 className="font-display text-2xl sm:text-4xl leading-tight">
            Join <span style={{color:"var(--secondary)"}}>{group.name}</span>
          </h1>
          <div className="flex items-center gap-1.5 mt-2 text-xs" style={{color:"var(--muted)"}}>
            <Users size={13}/>
            <span>{group.members_count} of {group.member_limit} members joined</span>
          </div>
        </div>

        {/* Group details */}
        <div className="card-tactile p-4 sm:p-6 mb-4">
          <div className="label-eyebrow mb-3">Group details</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            {[
              ["Contribution", fmtMoney(group.contribution_amount)],
              ["Frequency",    group.frequency],
              ["Total cycles", group.total_cycles],
              ["Start date",   fmtDate(group.start_date)],
              ["Due day",      `${group.due_day} · ${group.due_time}`],
              ["Late fee",     fmtMoney(group.late_fee_amount)],
            ].map(([label, val]) => (
              <div key={label} className="bg-white/60 rounded-lg p-3">
                <div className="label-eyebrow mb-1">{label}</div>
                <div className="font-display text-base leading-tight">{val}</div>
              </div>
            ))}
          </div>
          {group.description && <p className="text-sm mt-4" style={{color:"var(--muted)"}}>{group.description}</p>}
        </div>

        {/* Rules */}
        <div className="card-tactile p-4 sm:p-6 mb-4">
          <div className="label-eyebrow mb-3">Group rules</div>
          {group.rules_text ? (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{group.rules_text}</pre>
          ) : (
            <ul className="text-sm space-y-2 list-disc pl-5 leading-relaxed" style={{color:"var(--text)"}}>
              <li>Contribute {fmtMoney(group.contribution_amount)} {group.frequency} by the {group.due_day} of each cycle.</li>
              <li>Upload payment proof from your dashboard. An admin approves before it counts.</li>
              <li>Late payments attract a {fmtMoney(group.late_fee_amount)} fee after a {group.grace_period_days}-day grace period.</li>
              <li>Payouts follow the order set by the admin; one member is paid each cycle.</li>
              <li>Only admins confirm payments and payouts.</li>
            </ul>
          )}
        </div>

        {/* Join form */}
        <form onSubmit={submit} className="card-tactile p-4 sm:p-6" data-testid="join-form">
          <div className="label-eyebrow mb-4">
            {user ? "Accept & join" : "Create your account to join"}
          </div>

          {!user ? (
            <div className="space-y-3 mb-5">
              <div>
                <label className="form-label">Full name</label>
                <input required value={name} onChange={e=>setName(e.target.value)}
                  className="form-input" placeholder="e.g. Amaka Osei" data-testid="join-name" />
              </div>
              <div>
                <label className="form-label">Email address</label>
                <input type="email" required value={email} onChange={e=>setEmail(e.target.value)}
                  className="form-input" placeholder="you@example.com" data-testid="join-email" />
              </div>
              <div>
                <label className="form-label">Password <span className="font-normal">(6+ characters)</span></label>
                <input type="password" minLength={6} required value={password} onChange={e=>setPassword(e.target.value)}
                  className="form-input" data-testid="join-password" />
              </div>
            </div>
          ) : (
            <div className="px-3 py-2.5 rounded-lg text-sm mb-5" style={{background:"var(--surface)"}}>
              Joining as <b>{user.name}</b> ({user.email})
            </div>
          )}

          <label className="flex items-start gap-3 cursor-pointer py-1">
            <input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}
              className="mt-0.5 w-5 h-5 shrink-0" data-testid="join-accept-rules" />
            <span className="text-sm leading-snug">
              I have read and accept the rules of <b>{group.name}</b>. I understand an admin must approve my payments.
            </span>
          </label>

          {err && (
            <div className="mt-3 px-3 py-2.5 rounded-lg text-sm font-medium" style={{background:"#fef2f2", color:"#b91c1c"}} data-testid="join-error">
              {err}
            </div>
          )}

          <button disabled={busy || !accepted} className="btn-primary mt-5 w-full text-base" data-testid="join-submit">
            {busy ? "Joining…" : user ? "Accept & join group" : "Create account & join"}
          </button>

          {!user && (
            <p className="text-xs text-center mt-3" style={{color:"var(--muted)"}}>
              Already have an account?{" "}
              <Link to={`/login?next=/join/${token}`} className="underline font-medium">Sign in</Link>
            </p>
          )}
        </form>
      </main>
    </div>
  );
}
