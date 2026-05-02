import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { fmtMoney, fmtDate, formatErr } from "../api";
import TopNav from "../components/TopNav";
import { Plus } from "lucide-react";

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [groups, setGroups] = useState([]);
  const [pending, setPending] = useState([]);
  const [users, setUsers] = useState([]);
  const [audit, setAudit] = useState([]);
  const [tab, setTab] = useState("overview");
  const [createOpen, setCreateOpen] = useState(false);

  // create form
  const [form, setForm] = useState({
    name: "", description: "", contribution_amount: 10000, frequency: "monthly",
    start_date: new Date().toISOString().slice(0,10), total_cycles: 12, member_limit: 12,
    due_day: 1, due_time: "23:59", first_payment_fee: 0,
    late_fee_amount: 500, late_fee_method: "fixed", grace_period_days: 3,
    payment_account_details: "",
    whatsapp_group_name: "", whatsapp_invite_link: "",
    rules_text: "", enable_comments: true,
  });
  const [createErr, setCreateErr] = useState("");

  // review modal
  const [reviewing, setReviewing] = useState(null); // payment
  const [reviewNote, setReviewNote] = useState("");

  const load = async () => {
    const [s, g, p, u, a] = await Promise.all([
      api.get("/admin/dashboard-stats").then(r=>r.data),
      api.get("/admin/groups").then(r=>r.data),
      api.get("/admin/payments/pending").then(r=>r.data),
      api.get("/admin/users").then(r=>r.data),
      api.get("/admin/audit-logs").then(r=>r.data),
    ]);
    setStats(s); setGroups(g); setPending(p); setUsers(u); setAudit(a);
  };
  useEffect(() => { load(); }, []);

  const submitCreate = async (e) => {
    e.preventDefault(); setCreateErr("");
    try {
      await api.post("/admin/groups", { ...form,
        contribution_amount: Number(form.contribution_amount),
        total_cycles: Number(form.total_cycles), member_limit: Number(form.member_limit),
        due_day: Number(form.due_day), first_payment_fee: Number(form.first_payment_fee),
        late_fee_amount: Number(form.late_fee_amount), grace_period_days: Number(form.grace_period_days),
      });
      setCreateOpen(false);
      load();
    } catch (e) {
      setCreateErr(formatErr(e?.response?.data?.detail));
    }
  };

  const openReceipt = async (p) => {
    const { data } = await api.get(`/payments/${p.id}`);
    setReviewing(data); setReviewNote("");
  };

  const decide = async (decision) => {
    try {
      await api.post(`/admin/payments/${reviewing.id}/decision`, { decision, note: reviewNote });
      setReviewing(null); load();
    } catch (e) {
      alert(formatErr(e?.response?.data?.detail));
    }
  };

  const tabs = [
    ["overview", "Overview"],
    ["groups", "Groups"],
    ["approvals", `Approvals${pending.length?` (${pending.length})`:""}`],
    ["members", "Members"],
    ["audit", "Audit Log"],
  ];

  return (
    <div className="min-h-screen bg-app">
      <TopNav />
      <main className="max-w-7xl mx-auto px-6 py-10">
        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="label-eyebrow">Admin Console</div>
            <h1 className="font-display text-4xl">Operations Overview</h1>
          </div>
          <button onClick={()=>setCreateOpen(true)} className="btn-primary inline-flex items-center gap-2" data-testid="create-group-btn">
            <Plus size={16}/> Create Ajo group
          </button>
        </div>

        <div className="mb-6 flex gap-3">
          <Link to="/admin/settings" className="btn-secondary text-sm" data-testid="admin-settings-link">Platform settings</Link>
        </div>

        <div className="flex gap-1 border-b mb-8 overflow-x-auto" style={{borderColor:"var(--border)"}}>
          {tabs.map(([k, l]) => (
            <button key={k} onClick={()=>setTab(k)}
              className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${tab===k ? "font-medium" : "opacity-60"}`}
              style={{ borderColor: tab===k ? "var(--primary)" : "transparent", color: tab===k ? "var(--primary)" : "var(--text)" }}
              data-testid={`tab-${k}`}>{l}</button>
          ))}
        </div>

        {tab === "overview" && stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              ["Active groups", stats.active_groups],
              ["Total members", stats.total_members],
              ["Pending approvals", stats.pending_payments],
              ["Overdue payments", stats.overdue_payments],
              ["Due now", stats.due_now],
              ["Upcoming payouts", stats.upcoming_payouts],
              ["Total collections", fmtMoney(stats.total_collections)],
            ].map(([l, v], i) => (
              <div key={i} className="card-tactile p-6 hover-lift" data-testid={`overview-${i}`}>
                <div className="label-eyebrow">{l}</div>
                <div className="font-display text-3xl mt-2">{v}</div>
              </div>
            ))}
          </div>
        )}

        {tab === "groups" && (
          <div className="card-tactile overflow-hidden">
            <table className="w-full text-sm" data-testid="groups-table">
              <thead className="bg-white/50">
                <tr className="text-left">
                  <th className="px-4 py-3 label-eyebrow">Group</th>
                  <th className="px-4 py-3 label-eyebrow text-right">Contribution</th>
                  <th className="px-4 py-3 label-eyebrow">Frequency</th>
                  <th className="px-4 py-3 label-eyebrow">Cycles</th>
                  <th className="px-4 py-3 label-eyebrow">Members</th>
                  <th className="px-4 py-3 label-eyebrow">Start</th>
                  <th className="px-4 py-3 label-eyebrow"></th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <tr key={g.id} className="border-t" style={{borderColor:"var(--border)"}}>
                    <td className="px-4 py-3 font-display">{g.name}</td>
                    <td className="px-4 py-3 text-right">{fmtMoney(g.contribution_amount)}</td>
                    <td className="px-4 py-3">{g.frequency}</td>
                    <td className="px-4 py-3">{g.total_cycles}</td>
                    <td className="px-4 py-3">{g.member_count} / {g.member_limit}</td>
                    <td className="px-4 py-3">{fmtDate(g.start_date)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link to={`/admin/groups/${g.id}`} className="btn-secondary !py-1.5 !px-3 text-xs" data-testid={`manage-${g.id}`}>Manage</Link>
                    </td>
                  </tr>
                ))}
                {groups.length===0 && <tr><td colSpan={7} className="px-4 py-10 text-center" style={{color:"var(--muted)"}}>No groups yet. Click "Create Ajo group" to start.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === "approvals" && (
          <div className="card-tactile overflow-hidden">
            <table className="w-full text-sm" data-testid="approvals-table">
              <thead className="bg-white/50">
                <tr className="text-left">
                  <th className="px-4 py-3 label-eyebrow">Submitted</th>
                  <th className="px-4 py-3 label-eyebrow">Member</th>
                  <th className="px-4 py-3 label-eyebrow">Cycle</th>
                  <th className="px-4 py-3 label-eyebrow text-right">Amount</th>
                  <th className="px-4 py-3 label-eyebrow"></th>
                </tr>
              </thead>
              <tbody>
                {pending.map(p => (
                  <tr key={p.id} className="border-t" style={{borderColor:"var(--border)"}}>
                    <td className="px-4 py-3">{fmtDate(p.submitted_at)}</td>
                    <td className="px-4 py-3">{p.user_name}<div className="text-xs" style={{color:"var(--muted)"}}>{p.user_email}</div></td>
                    <td className="px-4 py-3">#{p.cycle_no}</td>
                    <td className="px-4 py-3 text-right font-display">{fmtMoney(p.amount)}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={()=>openReceipt(p)} className="btn-primary !py-1.5 !px-3 text-xs" data-testid={`review-${p.id}`}>Review</button>
                    </td>
                  </tr>
                ))}
                {pending.length===0 && <tr><td colSpan={5} className="px-4 py-10 text-center" style={{color:"var(--muted)"}}>No pending payments.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === "members" && (
          <div className="card-tactile overflow-hidden">
            <table className="w-full text-sm" data-testid="users-table">
              <thead className="bg-white/50">
                <tr className="text-left">
                  <th className="px-4 py-3 label-eyebrow">Name</th>
                  <th className="px-4 py-3 label-eyebrow">Email</th>
                  <th className="px-4 py-3 label-eyebrow">Role</th>
                  <th className="px-4 py-3 label-eyebrow">Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-t" style={{borderColor:"var(--border)"}}>
                    <td className="px-4 py-3">{u.name}</td>
                    <td className="px-4 py-3" style={{color:"var(--muted)"}}>{u.email}</td>
                    <td className="px-4 py-3"><span className="badge s-Carried_Forward">{u.role}</span></td>
                    <td className="px-4 py-3" style={{color:"var(--muted)"}}>{fmtDate(u.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "audit" && (
          <div className="card-tactile overflow-hidden">
            <table className="w-full text-sm" data-testid="audit-table">
              <thead className="bg-white/50">
                <tr className="text-left">
                  <th className="px-4 py-3 label-eyebrow">Time</th>
                  <th className="px-4 py-3 label-eyebrow">Actor</th>
                  <th className="px-4 py-3 label-eyebrow">Action</th>
                  <th className="px-4 py-3 label-eyebrow">Target</th>
                </tr>
              </thead>
              <tbody>
                {audit.map(l => (
                  <tr key={l.id} className="border-t" style={{borderColor:"var(--border)"}}>
                    <td className="px-4 py-3 text-xs">{fmtDate(l.timestamp)} {l.timestamp.slice(11,16)}</td>
                    <td className="px-4 py-3">{l.actor_name}<div className="text-xs" style={{color:"var(--muted)"}}>{l.actor_email}</div></td>
                    <td className="px-4 py-3"><code className="text-xs">{l.action}</code></td>
                    <td className="px-4 py-3 text-xs" style={{color:"var(--muted)"}}>{l.target}</td>
                  </tr>
                ))}
                {audit.length===0 && <tr><td colSpan={4} className="px-4 py-10 text-center" style={{color:"var(--muted)"}}>No log entries yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Create Group Modal */}
      {createOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50 overflow-y-auto" onClick={()=>setCreateOpen(false)}>
          <form onClick={e=>e.stopPropagation()} onSubmit={submitCreate} className="bg-white rounded-lg max-w-2xl w-full p-6 my-8" data-testid="create-group-modal">
            <h3 className="font-display text-2xl mb-4">Create Ajo Group</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                ["name","Name","text", true],
                ["description","Description","text", false],
                ["contribution_amount","Contribution amount","number", true],
                ["frequency","Frequency",null, true, ["monthly","weekly","biweekly"]],
                ["start_date","Start date","date", true],
                ["total_cycles","Total cycles","number", true],
                ["member_limit","Member limit","number", true],
                ["due_day","Due day (1-28)","number", true],
                ["due_time","Due time","time", true],
                ["first_payment_fee","First payment fee","number", false],
                ["late_fee_amount","Late fee amount","number", false],
                ["late_fee_method","Late fee method",null, true, ["fixed","percent"]],
                ["grace_period_days","Grace period days","number", false],
              ].map(([k, l, t, req, opts]) => (
                <div key={k} className={k==="description"||k==="payment_account_details"?"col-span-2":""}>
                  <label className="label-eyebrow block mb-1">{l}</label>
                  {opts ? (
                    <select required={req} value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})}
                      className="w-full border rounded px-3 py-2 bg-white" data-testid={`field-${k}`}>
                      {opts.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input type={t} required={req} value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})}
                      className="w-full border rounded px-3 py-2" data-testid={`field-${k}`} />
                  )}
                </div>
              ))}
              <div className="col-span-2">
                <label className="label-eyebrow block mb-1">Payment account details (recipient bank info)</label>
                <textarea value={form.payment_account_details} onChange={e=>setForm({...form,payment_account_details:e.target.value})}
                  rows={2} className="w-full border rounded px-3 py-2" data-testid="field-account-details" />
              </div>
              <div className="col-span-2">
                <label className="label-eyebrow block mb-1">Group rules (shown to invitees before joining)</label>
                <textarea value={form.rules_text} onChange={e=>setForm({...form,rules_text:e.target.value})}
                  rows={5} placeholder="e.g. 1. Contributions are due by midnight on the due day. 2. Late fee applies after 3-day grace period..."
                  className="w-full border rounded px-3 py-2" data-testid="field-rules" />
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <input id="enable_comments" type="checkbox" checked={form.enable_comments}
                  onChange={e=>setForm({...form, enable_comments: e.target.checked})} data-testid="field-enable-comments" />
                <label htmlFor="enable_comments" className="text-sm">Enable member comments on this group</label>
              </div>
            </div>
            {createErr && <div className="text-red-700 text-sm mt-3" data-testid="create-error">{createErr}</div>}
            <div className="flex gap-2 mt-6 justify-end">
              <button type="button" onClick={()=>setCreateOpen(false)} className="btn-secondary text-sm" data-testid="create-cancel">Cancel</button>
              <button type="submit" className="btn-primary text-sm" data-testid="create-submit">Create group</button>
            </div>
          </form>
        </div>
      )}

      {/* Receipt Review Modal */}
      {reviewing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={()=>setReviewing(null)}>
          <div onClick={e=>e.stopPropagation()} className="bg-white rounded-lg max-w-4xl w-full p-6 grid md:grid-cols-2 gap-6" data-testid="review-modal">
            <div>
              <div className="label-eyebrow mb-2">Receipt</div>
              {reviewing.receipt_data_url?.startsWith("data:image") ? (
                <img src={reviewing.receipt_data_url} alt="Receipt" className="w-full rounded border" />
              ) : (
                <a href={reviewing.receipt_data_url} target="_blank" rel="noreferrer" className="text-sm underline">Open receipt file</a>
              )}
            </div>
            <div>
              <h3 className="font-display text-2xl">Review payment</h3>
              <div className="mt-3 space-y-1 text-sm">
                <div><span className="label-eyebrow">Member:</span> {reviewing.user_name}</div>
                <div><span className="label-eyebrow">Cycle:</span> #{reviewing.cycle_no}</div>
                <div><span className="label-eyebrow">Amount:</span> {fmtMoney(reviewing.amount)}</div>
                <div><span className="label-eyebrow">Submitted:</span> {fmtDate(reviewing.submitted_at)}</div>
                {reviewing.note && <div className="mt-2"><span className="label-eyebrow">Member note:</span><div className="text-sm mt-1">{reviewing.note}</div></div>}
              </div>
              <div className="mt-4">
                <label className="label-eyebrow block mb-1">Decision note (optional)</label>
                <textarea value={reviewNote} onChange={e=>setReviewNote(e.target.value)} rows={3} className="w-full border rounded px-3 py-2" data-testid="review-note"/>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={()=>decide("reject")} className="btn-secondary text-sm" style={{borderColor:"#b91c1c", color:"#b91c1c"}} data-testid="review-reject">Reject</button>
                <button onClick={()=>decide("approve")} className="btn-primary text-sm" data-testid="review-approve">Approve</button>
                <button onClick={()=>setReviewing(null)} className="ml-auto text-sm" style={{color:"var(--muted)"}} data-testid="review-close">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
