import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { fmtMoney, fmtDate, formatErr } from "../api";
import TopNav from "../components/TopNav";
import {
  Plus, Users, UserCheck, Clock, AlertTriangle, TrendingUp,
  Banknote, CalendarDays, RefreshCw, Megaphone, CheckCircle2, Search,
} from "lucide-react";

const ACTION_COLORS = {
  payment_approved: "#1E3F33", payment_rejected: "#b91c1c",
  group_created: "#1d4ed8", member_added: "#4338ca", member_removed: "#c2410c",
  payout_confirmed: "#b45309", admin_broadcast: "#6b21a8",
};

function estCycle(g) {
  if (!g.start_date) return 1;
  const days = Math.max(0, Math.floor((Date.now() - new Date(g.start_date)) / 86400000));
  const dpc = g.frequency === "weekly" ? 7 : g.frequency === "biweekly" ? 14 : 30;
  return Math.min(Math.floor(days / dpc) + 1, g.total_cycles);
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [groups, setGroups] = useState([]);
  const [pending, setPending] = useState([]);
  const [users, setUsers] = useState([]);
  const [audit, setAudit] = useState([]);
  const [tab, setTab] = useState("overview");
  const [createOpen, setCreateOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");

  const [form, setForm] = useState({
    name: "", description: "", contribution_amount: 10000, frequency: "monthly",
    start_date: new Date().toISOString().slice(0,10), total_cycles: 12, member_limit: 12,
    due_day: 1, due_time: "23:59", first_payment_fee: 0,
    late_fee_amount: 500, late_fee_method: "fixed", grace_period_days: 3,
    payment_account_details: "", whatsapp_group_name: "", whatsapp_invite_link: "",
    rules_text: "", enable_comments: true,
  });
  const [createErr, setCreateErr] = useState("");
  const [reviewing, setReviewing] = useState(null);
  const [reviewNote, setReviewNote] = useState("");
  const [broadTitle, setBroadTitle] = useState("");
  const [broadBody, setBroadBody] = useState("");
  const [broadMsg, setBroadMsg] = useState("");

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
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submitCreate = async (e) => {
    e.preventDefault(); setCreateErr("");
    try {
      await api.post("/admin/groups", { ...form,
        contribution_amount: Number(form.contribution_amount),
        total_cycles: Number(form.total_cycles), member_limit: Number(form.member_limit),
        due_day: Number(form.due_day), first_payment_fee: Number(form.first_payment_fee),
        late_fee_amount: Number(form.late_fee_amount), grace_period_days: Number(form.grace_period_days),
      });
      setCreateOpen(false); load();
    } catch (e) { setCreateErr(formatErr(e?.response?.data?.detail)); }
  };

  const openReceipt = async (p) => {
    const { data } = await api.get(`/payments/${p.id}`);
    setReviewing({ ...data, group_name: p.group_name }); setReviewNote("");
  };

  const decide = async (decision) => {
    try {
      await api.post(`/admin/payments/${reviewing.id}/decision`, { decision, note: reviewNote });
      setReviewing(null); load();
    } catch (e) { alert(formatErr(e?.response?.data?.detail)); }
  };

  const sendBroadcast = async (e) => {
    e.preventDefault(); setBroadMsg("");
    try {
      await api.post("/admin/broadcast", { title: broadTitle, body: broadBody });
      setBroadMsg("Sent to all members!"); setBroadTitle(""); setBroadBody("");
    } catch (e) { setBroadMsg(formatErr(e?.response?.data?.detail) || "Failed"); }
  };

  const filteredUsers = users.filter(u =>
    !memberSearch ||
    u.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
    u.email.toLowerCase().includes(memberSearch.toLowerCase())
  );

  const statCards = stats ? [
    { label: "Active groups",      value: stats.active_groups,                  Icon: Users,         color: "#1E3F33", bg: "#E8EFE5" },
    { label: "Total members",      value: stats.total_members,                  Icon: UserCheck,     color: "#1d4ed8", bg: "#eff6ff" },
    { label: "Pending approvals",  value: stats.pending_payments,               Icon: Clock,         color: "#c2410c", bg: "#fff7ed", toTab: "approvals" },
    { label: "Overdue payments",   value: stats.overdue_payments,               Icon: AlertTriangle, color: "#991b1b", bg: "#fee2e2" },
    { label: "Due now",            value: stats.due_now,                        Icon: CalendarDays,  color: "#854d0e", bg: "#fefce8" },
    { label: "Upcoming payouts",   value: stats.upcoming_payouts,               Icon: Banknote,      color: "#6b21a8", bg: "#faf5ff" },
    { label: "Total collected",    value: fmtMoney(stats.total_collections),    Icon: TrendingUp,    color: "#1E3F33", bg: "#D99C3D30" },
  ] : [];

  const tabs = [
    ["overview",  "Overview"],
    ["groups",    "Groups"],
    ["approvals", `Approvals${pending.length ? ` (${pending.length})` : ""}`],
    ["members",   "Members"],
    ["audit",     "Audit Log"],
  ];

  return (
    <div className="min-h-screen bg-app">
      <TopNav />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">

        {/* ── Header ── */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <div className="label-eyebrow">Admin Console</div>
            <h1 className="font-display text-3xl sm:text-4xl">Operations Overview</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={()=>setBroadcastOpen(true)} className="btn-secondary text-sm inline-flex items-center gap-1.5">
              <Megaphone size={14}/> Broadcast
            </button>
            <Link to="/admin/settings" className="btn-secondary text-sm" data-testid="admin-settings-link">Settings</Link>
            <button onClick={load} className="btn-secondary text-sm !px-3" title="Refresh data"><RefreshCw size={14}/></button>
            <button onClick={()=>setCreateOpen(true)} className="btn-primary text-sm inline-flex items-center gap-1.5" data-testid="create-group-btn">
              <Plus size={15}/> New Ajo Group
            </button>
          </div>
        </div>

        {/* ── Stat Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
          {statCards.map(({ label, value, Icon, color, bg, toTab }, i) => (
            <div key={i}
              onClick={toTab ? ()=>setTab(toTab) : undefined}
              className={`card-tactile p-4 ${toTab ? "cursor-pointer hover-lift" : ""}`}
              style={{ borderLeft: `3px solid ${color}` }}
              data-testid={`overview-${i}`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="label-eyebrow" style={{fontSize:10}}>{label}</div>
                <div className="rounded-full p-1" style={{ background: bg }}>
                  <Icon size={11} style={{ color }} />
                </div>
              </div>
              <div className="font-display text-2xl" style={{ color }}>{value}</div>
            </div>
          ))}
        </div>

        {/* ── Tabs ── */}
        <div className="flex border-b mb-6 overflow-x-auto" style={{borderColor:"var(--border)"}}>
          {tabs.map(([k, l]) => (
            <button key={k} onClick={()=>setTab(k)}
              className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${tab===k ? "font-semibold" : "opacity-60 hover:opacity-90"}`}
              style={{ borderColor: tab===k ? "var(--primary)" : "transparent", color: tab===k ? "var(--primary)" : "var(--text)" }}
              data-testid={`tab-${k}`}>{l}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW ── */}
        {tab === "overview" && (
          <div className="space-y-6">
            {stats?.overdue_payments > 0 && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg border text-sm font-medium"
                style={{background:"#fee2e2", borderColor:"#fca5a5", color:"#991b1b"}}>
                <AlertTriangle size={16}/>
                {stats.overdue_payments} overdue payment{stats.overdue_payments > 1 ? "s" : ""} — follow up with members or send a broadcast reminder.
              </div>
            )}

            <div>
              <h2 className="font-display text-xl mb-3">Groups at a glance</h2>
              {groups.length === 0 ? (
                <div className="card-tactile p-10 text-center text-sm" style={{color:"var(--muted)"}}>
                  No groups yet. Click "New Ajo Group" to start.
                </div>
              ) : (
                <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {groups.map(g => {
                    const cycle = estCycle(g);
                    const cyclePct = Math.round((cycle / g.total_cycles) * 100);
                    const fillPct  = Math.round((g.member_count / g.member_limit) * 100);
                    return (
                      <div key={g.id} className="card-tactile p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-display text-base leading-tight">{g.name}</div>
                            <div className="text-xs mt-0.5" style={{color:"var(--muted)"}}>{g.frequency} · {fmtMoney(g.contribution_amount)}</div>
                          </div>
                          <Link to={`/admin/groups/${g.id}`} className="btn-secondary !py-1 !px-2.5 text-xs shrink-0" data-testid={`manage-${g.id}`}>Manage</Link>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <div className="flex justify-between text-xs mb-1" style={{color:"var(--muted)"}}>
                              <span>Cycle progress</span><span>Cycle {cycle}/{g.total_cycles}</span>
                            </div>
                            <div className="h-1.5 rounded-full" style={{background:"var(--border)"}}>
                              <div className="h-full rounded-full" style={{width:`${cyclePct}%`, background:"var(--primary)", transition:"width .4s"}} />
                            </div>
                          </div>
                          <div>
                            <div className="flex justify-between text-xs mb-1" style={{color:"var(--muted)"}}>
                              <span>Member fill</span><span>{g.member_count}/{g.member_limit}</span>
                            </div>
                            <div className="h-1.5 rounded-full" style={{background:"var(--border)"}}>
                              <div className="h-full rounded-full" style={{width:`${fillPct}%`, background:"var(--accent)", transition:"width .4s"}} />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {pending.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-display text-xl">Pending approvals</h2>
                  <button onClick={()=>setTab("approvals")} className="text-sm font-medium" style={{color:"var(--primary)"}}>View all →</button>
                </div>
                <div className="card-tactile overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-white/50">
                      <tr className="text-left">
                        <th className="px-4 py-2.5 label-eyebrow">Member</th>
                        <th className="px-4 py-2.5 label-eyebrow">Group</th>
                        <th className="px-4 py-2.5 label-eyebrow text-right">Amount</th>
                        <th className="px-4 py-2.5 label-eyebrow"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pending.slice(0,3).map(p => (
                        <tr key={p.id} className="border-t" style={{borderColor:"var(--border)"}}>
                          <td className="px-4 py-2.5">{p.user_name}<div className="text-xs" style={{color:"var(--muted)"}}>{p.user_email}</div></td>
                          <td className="px-4 py-2.5 text-xs font-medium" style={{color:"var(--primary)"}}>{p.group_name || "—"}</td>
                          <td className="px-4 py-2.5 text-right font-display">{fmtMoney(p.amount)}</td>
                          <td className="px-4 py-2.5 text-right">
                            <button onClick={()=>openReceipt(p)} className="btn-primary !py-1 !px-2.5 text-xs" data-testid={`review-${p.id}`}>Review</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── GROUPS ── */}
        {tab === "groups" && (
          <div className="card-tactile overflow-hidden" data-testid="groups-table">
            <table className="w-full text-sm">
              <thead className="bg-white/50">
                <tr className="text-left">
                  <th className="px-4 py-3 label-eyebrow">Group</th>
                  <th className="px-4 py-3 label-eyebrow text-right">Contribution</th>
                  <th className="px-4 py-3 label-eyebrow">Frequency</th>
                  <th className="px-4 py-3 label-eyebrow">Cycle progress</th>
                  <th className="px-4 py-3 label-eyebrow">Members</th>
                  <th className="px-4 py-3 label-eyebrow">Start</th>
                  <th className="px-4 py-3 label-eyebrow"></th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => {
                  const cycle = estCycle(g);
                  const pct  = Math.round((cycle / g.total_cycles) * 100);
                  const fill = Math.round((g.member_count / g.member_limit) * 100);
                  return (
                    <tr key={g.id} className="border-t" style={{borderColor:"var(--border)"}}>
                      <td className="px-4 py-3">
                        <div className="font-display leading-tight">{g.name}</div>
                        {g.description && <div className="text-xs mt-0.5" style={{color:"var(--muted)"}}>{g.description.slice(0,50)}</div>}
                      </td>
                      <td className="px-4 py-3 text-right font-display">{fmtMoney(g.contribution_amount)}</td>
                      <td className="px-4 py-3 capitalize">{g.frequency}</td>
                      <td className="px-4 py-3" style={{minWidth:110}}>
                        <div className="text-xs mb-1" style={{color:"var(--muted)"}}>Cycle {cycle}/{g.total_cycles}</div>
                        <div className="h-1.5 rounded-full w-24" style={{background:"var(--border)"}}>
                          <div className="h-full rounded-full" style={{width:`${pct}%`, background:"var(--primary)"}} />
                        </div>
                      </td>
                      <td className="px-4 py-3" style={{minWidth:90}}>
                        <div className="text-xs mb-1" style={{color:"var(--muted)"}}>{g.member_count}/{g.member_limit}</div>
                        <div className="h-1.5 rounded-full w-16" style={{background:"var(--border)"}}>
                          <div className="h-full rounded-full" style={{width:`${fill}%`, background:"var(--accent)"}} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm" style={{color:"var(--muted)"}}>{fmtDate(g.start_date)}</td>
                      <td className="px-4 py-3 text-right">
                        <Link to={`/admin/groups/${g.id}`} className="btn-secondary !py-1.5 !px-3 text-xs" data-testid={`manage-${g.id}`}>Manage</Link>
                      </td>
                    </tr>
                  );
                })}
                {groups.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-sm" style={{color:"var(--muted)"}}>
                    No groups yet. Click "New Ajo Group" to start.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── APPROVALS ── */}
        {tab === "approvals" && (
          <div className="card-tactile overflow-hidden" data-testid="approvals-table">
            <table className="w-full text-sm">
              <thead className="bg-white/50">
                <tr className="text-left">
                  <th className="px-4 py-3 label-eyebrow">Submitted</th>
                  <th className="px-4 py-3 label-eyebrow">Member</th>
                  <th className="px-4 py-3 label-eyebrow">Group</th>
                  <th className="px-4 py-3 label-eyebrow">Cycle</th>
                  <th className="px-4 py-3 label-eyebrow text-right">Amount</th>
                  <th className="px-4 py-3 label-eyebrow"></th>
                </tr>
              </thead>
              <tbody>
                {pending.map(p => (
                  <tr key={p.id} className="border-t" style={{borderColor:"var(--border)"}}>
                    <td className="px-4 py-3 text-xs" style={{color:"var(--muted)"}}>{fmtDate(p.submitted_at)}</td>
                    <td className="px-4 py-3 font-medium">{p.user_name}<div className="text-xs font-normal" style={{color:"var(--muted)"}}>{p.user_email}</div></td>
                    <td className="px-4 py-3 text-xs font-semibold" style={{color:"var(--primary)"}}>{p.group_name || "—"}</td>
                    <td className="px-4 py-3 font-display">#{p.cycle_no}</td>
                    <td className="px-4 py-3 text-right font-display">{fmtMoney(p.amount)}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={()=>openReceipt(p)} className="btn-primary !py-1.5 !px-3 text-xs" data-testid={`review-${p.id}`}>Review</button>
                    </td>
                  </tr>
                ))}
                {pending.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-12 text-center" style={{color:"var(--muted)"}}>
                    <CheckCircle2 className="mx-auto mb-2" size={28} style={{color:"var(--primary)", opacity:.4}} />
                    <div className="text-sm font-medium">All caught up — no pending payments.</div>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── MEMBERS ── */}
        {tab === "members" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="relative max-w-xs flex-1">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{color:"var(--muted)"}} />
                <input value={memberSearch} onChange={e=>setMemberSearch(e.target.value)}
                  placeholder="Search by name or email…"
                  className="w-full border rounded pl-8 pr-3 py-2 bg-white text-sm" />
              </div>
              <span className="text-sm" style={{color:"var(--muted)"}}>{filteredUsers.length} user{filteredUsers.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="card-tactile overflow-hidden" data-testid="users-table">
              <table className="w-full text-sm">
                <thead className="bg-white/50">
                  <tr className="text-left">
                    <th className="px-4 py-3 label-eyebrow">Name</th>
                    <th className="px-4 py-3 label-eyebrow">Email</th>
                    <th className="px-4 py-3 label-eyebrow">Role</th>
                    <th className="px-4 py-3 label-eyebrow">Bank details</th>
                    <th className="px-4 py-3 label-eyebrow">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map(u => {
                    const hasBank = u.bank_name && u.bank_account_number;
                    return (
                      <tr key={u.id} className="border-t" style={{borderColor:"var(--border)"}}>
                        <td className="px-4 py-3 font-medium">{u.name}</td>
                        <td className="px-4 py-3 text-xs" style={{color:"var(--muted)"}}>{u.email}</td>
                        <td className="px-4 py-3"><span className="badge s-Carried_Forward">{u.role}</span></td>
                        <td className="px-4 py-3">
                          {hasBank ? (
                            <div>
                              <div className="text-xs font-semibold">{u.bank_name}</div>
                              <div className="text-xs" style={{color:"var(--muted)"}}>{u.bank_account_number} · {u.bank_account_name}</div>
                            </div>
                          ) : <span className="text-xs px-2 py-0.5 rounded" style={{background:"#fee2e2", color:"#991b1b"}}>Not set</span>}
                        </td>
                        <td className="px-4 py-3 text-xs" style={{color:"var(--muted)"}}>{fmtDate(u.created_at)}</td>
                      </tr>
                    );
                  })}
                  {filteredUsers.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-10 text-center text-sm" style={{color:"var(--muted)"}}>No members found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── AUDIT LOG ── */}
        {tab === "audit" && (
          <div className="card-tactile overflow-hidden" data-testid="audit-table">
            <table className="w-full text-sm">
              <thead className="bg-white/50">
                <tr className="text-left">
                  <th className="px-4 py-3 label-eyebrow">Time</th>
                  <th className="px-4 py-3 label-eyebrow">Actor</th>
                  <th className="px-4 py-3 label-eyebrow">Action</th>
                  <th className="px-4 py-3 label-eyebrow">Target</th>
                </tr>
              </thead>
              <tbody>
                {audit.map(l => {
                  const c = ACTION_COLORS[l.action] || "var(--muted)";
                  return (
                    <tr key={l.id} className="border-t" style={{borderColor:"var(--border)"}}>
                      <td className="px-4 py-3 text-xs" style={{color:"var(--muted)"}}>
                        {fmtDate(l.timestamp)} {l.timestamp.slice(11,16)}
                      </td>
                      <td className="px-4 py-3">{l.actor_name}<div className="text-xs" style={{color:"var(--muted)"}}>{l.actor_email}</div></td>
                      <td className="px-4 py-3">
                        <code className="text-xs px-2 py-0.5 rounded font-mono" style={{background:`${c}18`, color:c}}>{l.action}</code>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{color:"var(--muted)"}}>{l.target}</td>
                    </tr>
                  );
                })}
                {audit.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-sm" style={{color:"var(--muted)"}}>No audit entries yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* ── Create Group Modal ── */}
      {createOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center p-4 z-50 overflow-y-auto" onClick={()=>setCreateOpen(false)}>
          <form onClick={e=>e.stopPropagation()} onSubmit={submitCreate}
            className="bg-white rounded-xl max-w-2xl w-full p-6 my-8 shadow-2xl" data-testid="create-group-modal">
            <h3 className="font-display text-2xl mb-1">Create Ajo Group</h3>
            <p className="text-xs mb-5" style={{color:"var(--muted)"}}>Configure settings. You can invite members after creation.</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                ["name","Group name","text",true],
                ["description","Description","text",false],
                ["contribution_amount","Contribution (₦)","number",true],
                ["frequency","Frequency",null,true,["monthly","weekly","biweekly"]],
                ["start_date","Start date","date",true],
                ["total_cycles","Total cycles","number",true],
                ["member_limit","Member limit","number",true],
                ["due_day","Due day (1–28)","number",true],
                ["due_time","Due time","time",true],
                ["first_payment_fee","First payment fee (₦)","number",false],
                ["late_fee_amount","Late fee (₦)","number",false],
                ["late_fee_method","Late fee method",null,true,["fixed","percent"]],
                ["grace_period_days","Grace period (days)","number",false],
              ].map(([k,l,t,req,opts]) => (
                <div key={k} className={k==="description" ? "col-span-2" : ""}>
                  <label className="block text-xs mb-1 font-semibold" style={{color:"var(--muted)"}}>{l}</label>
                  {opts
                    ? <select required={req} value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})}
                        className="w-full border rounded px-3 py-2 bg-white text-sm" data-testid={`field-${k}`}>
                        {opts.map(o=><option key={o} value={o}>{o}</option>)}
                      </select>
                    : <input type={t} required={req} value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})}
                        className="w-full border rounded px-3 py-2 text-sm" data-testid={`field-${k}`} />
                  }
                </div>
              ))}
              <div className="col-span-2">
                <label className="block text-xs mb-1 font-semibold" style={{color:"var(--muted)"}}>Payment account details (bank info for payout recipient)</label>
                <textarea value={form.payment_account_details} onChange={e=>setForm({...form,payment_account_details:e.target.value})}
                  rows={2} className="w-full border rounded px-3 py-2 text-sm" data-testid="field-account-details" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs mb-1 font-semibold" style={{color:"var(--muted)"}}>Group rules (shown to invitees before joining)</label>
                <textarea value={form.rules_text} onChange={e=>setForm({...form,rules_text:e.target.value})}
                  rows={4} placeholder="e.g. 1. Contributions due by midnight. 2. Late fee applies after grace period…"
                  className="w-full border rounded px-3 py-2 text-sm" data-testid="field-rules" />
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <input id="enable_comments" type="checkbox" checked={form.enable_comments}
                  onChange={e=>setForm({...form,enable_comments:e.target.checked})} data-testid="field-enable-comments"/>
                <label htmlFor="enable_comments" className="text-sm">Enable member comments on this group</label>
              </div>
            </div>
            {createErr && <div className="text-red-700 text-sm mt-3" data-testid="create-error">{createErr}</div>}
            <div className="flex gap-2 mt-5 justify-end">
              <button type="button" onClick={()=>setCreateOpen(false)} className="btn-secondary text-sm" data-testid="create-cancel">Cancel</button>
              <button type="submit" className="btn-primary text-sm" data-testid="create-submit">Create group</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Review Payment Modal ── */}
      {reviewing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={()=>setReviewing(null)}>
          <div onClick={e=>e.stopPropagation()} className="bg-white rounded-xl max-w-4xl w-full p-6 grid md:grid-cols-2 gap-6 shadow-2xl" data-testid="review-modal">
            <div>
              <div className="label-eyebrow mb-2">Payment receipt</div>
              {reviewing.receipt_data_url?.startsWith("data:image")
                ? <img src={reviewing.receipt_data_url} alt="Receipt" className="w-full rounded-lg border" />
                : <a href={reviewing.receipt_data_url} target="_blank" rel="noreferrer" className="text-sm underline">Open receipt file</a>
              }
            </div>
            <div className="flex flex-col">
              <h3 className="font-display text-2xl mb-1">Review payment</h3>
              {reviewing.group_name && (
                <span className="inline-block text-xs font-semibold mb-3 px-2 py-1 rounded" style={{background:"var(--surface)", color:"var(--primary)"}}>
                  {reviewing.group_name}
                </span>
              )}
              <div className="space-y-1.5 text-sm mb-4">
                <div><span className="label-eyebrow mr-2">Member:</span>{reviewing.user_name}</div>
                <div><span className="label-eyebrow mr-2">Email:</span>{reviewing.user_email}</div>
                <div><span className="label-eyebrow mr-2">Cycle:</span>#{reviewing.cycle_no}</div>
                <div><span className="label-eyebrow mr-2">Amount:</span><span className="font-display text-base">{fmtMoney(reviewing.amount)}</span></div>
                <div><span className="label-eyebrow mr-2">Submitted:</span>{fmtDate(reviewing.submitted_at)}</div>
                {reviewing.note && (
                  <div className="mt-2 p-2 rounded text-sm" style={{background:"var(--surface)"}}>
                    <span className="label-eyebrow block mb-0.5">Member note</span>{reviewing.note}
                  </div>
                )}
              </div>
              <div className="mb-4">
                <label className="block text-xs mb-1 font-semibold" style={{color:"var(--muted)"}}>Decision note (optional)</label>
                <textarea value={reviewNote} onChange={e=>setReviewNote(e.target.value)} rows={3}
                  className="w-full border rounded px-3 py-2 text-sm" data-testid="review-note" />
              </div>
              <div className="flex gap-2 mt-auto">
                <button onClick={()=>decide("reject")} className="btn-secondary text-sm" style={{borderColor:"#b91c1c",color:"#b91c1c"}} data-testid="review-reject">Reject</button>
                <button onClick={()=>decide("approve")} className="btn-primary text-sm" data-testid="review-approve">✓ Approve</button>
                <button onClick={()=>setReviewing(null)} className="ml-auto text-sm" style={{color:"var(--muted)"}} data-testid="review-close">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Global Broadcast Modal ── */}
      {broadcastOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={()=>setBroadcastOpen(false)}>
          <form onClick={e=>e.stopPropagation()} onSubmit={sendBroadcast}
            className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center gap-2 mb-1">
              <Megaphone size={18} style={{color:"var(--primary)"}} />
              <h3 className="font-display text-xl">Global Broadcast</h3>
            </div>
            <p className="text-xs mb-4" style={{color:"var(--muted)"}}>Sends an in-app notification to every member across all groups.</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs mb-1 font-semibold" style={{color:"var(--muted)"}}>Title</label>
                <input required value={broadTitle} onChange={e=>setBroadTitle(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs mb-1 font-semibold" style={{color:"var(--muted)"}}>Message</label>
                <textarea required value={broadBody} onChange={e=>setBroadBody(e.target.value)} rows={3} className="w-full border rounded px-3 py-2 text-sm" />
              </div>
            </div>
            {broadMsg && <div className="mt-3 text-sm font-medium" style={{color:"var(--primary)"}}>{broadMsg}</div>}
            <div className="flex gap-2 mt-5 justify-end">
              <button type="button" onClick={()=>setBroadcastOpen(false)} className="btn-secondary text-sm">Cancel</button>
              <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5"><Megaphone size={13}/>Send to all</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
