import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { fmtMoney, fmtDate, formatErr } from "../api";
import TopNav from "../components/TopNav";
import {
  Plus, Users, UserCheck, Clock, AlertTriangle, TrendingUp,
  Banknote, CalendarDays, RefreshCw, Megaphone, CheckCircle2, Search, UserPlus, X, Trash2, Pencil, KeyRound,
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

  const [addUserOpen, setAddUserOpen] = useState(false);
  const [addUserForm, setAddUserForm] = useState({ name: "", email: "", password: "", role: "member" });
  const [addUserErr, setAddUserErr] = useState("");
  const [roleUpdating, setRoleUpdating] = useState(null);
  const [editUserTarget, setEditUserTarget] = useState(null);
  const [editUserForm, setEditUserForm] = useState({ name: "", email: "" });
  const [editUserErr, setEditUserErr] = useState("");
  const [resetPwTarget, setResetPwTarget] = useState(null);
  const [resetPwValue, setResetPwValue] = useState("");
  const [resetPwErr, setResetPwErr] = useState("");

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

  const submitAddUser = async (e) => {
    e.preventDefault(); setAddUserErr("");
    try {
      await api.post("/admin/users", addUserForm);
      setAddUserOpen(false);
      setAddUserForm({ name: "", email: "", password: "", role: "member" });
      load();
    } catch (e) { setAddUserErr(formatErr(e?.response?.data?.detail)); }
  };

  const deleteGroup = async (g) => {
    if (!window.confirm(`Delete "${g.name}"?\n\nThis will permanently remove the group, all members, cycles, payments and history. This cannot be undone.`)) return;
    try {
      await api.delete(`/admin/groups/${g.id}`);
      load();
    } catch (e) { alert(formatErr(e?.response?.data?.detail)); }
  };

  const openEditUser = (u) => {
    setEditUserTarget(u);
    setEditUserForm({ name: u.name, email: u.email });
    setEditUserErr("");
  };

  const submitEditUser = async (e) => {
    e.preventDefault(); setEditUserErr("");
    try {
      await api.patch(`/admin/users/${editUserTarget.id}`, editUserForm);
      setEditUserTarget(null); load();
    } catch (e) { setEditUserErr(formatErr(e?.response?.data?.detail)); }
  };

  const submitResetPw = async (e) => {
    e.preventDefault(); setResetPwErr("");
    try {
      await api.post(`/admin/users/${resetPwTarget.id}/set-password`, { password: resetPwValue });
      setResetPwTarget(null); setResetPwValue("");
    } catch (e) { setResetPwErr(formatErr(e?.response?.data?.detail)); }
  };

  const deleteUser = async (u) => {
    if (!window.confirm(`Delete ${u.name} (${u.email})? This removes the user and all their group memberships. This cannot be undone.`)) return;
    try { await api.delete(`/admin/users/${u.id}`); load(); }
    catch (e) { alert(formatErr(e?.response?.data?.detail)); }
  };

  const changeRole = async (userId, newRole) => {
    setRoleUpdating(userId);
    try {
      await api.patch(`/admin/users/${userId}/role`, { role: newRole });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
    } catch (e) { alert(formatErr(e?.response?.data?.detail)); }
    finally { setRoleUpdating(null); }
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
      <main className="page-main">

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
                  {/* Mobile */}
                  <div className="mobile-list-card divide-y" style={{borderColor:"var(--border)"}}>
                    {pending.slice(0,3).map(p => (
                      <div key={p.id} className="p-4 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate">{p.user_name}</div>
                          <div className="text-xs truncate" style={{color:"var(--muted)"}}>{p.group_name} · Cycle #{p.cycle_no}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-display text-sm">{fmtMoney(p.amount)}</div>
                          <button onClick={()=>openReceipt(p)} className="btn-primary !py-1.5 !px-3 text-xs mt-1.5" data-testid={`review-${p.id}`}>Review</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Desktop */}
                  <table className="desktop-table w-full text-sm">
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
            {/* Mobile group cards */}
            <div className="mobile-list-card divide-y" style={{borderColor:"var(--border)"}}>
              {groups.map(g => {
                const cycle = estCycle(g);
                const pct = Math.round((cycle / g.total_cycles) * 100);
                return (
                  <div key={g.id} className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{g.name}</div>
                        <div className="text-xs mt-0.5" style={{color:"var(--muted)"}}>{g.frequency} · {fmtMoney(g.contribution_amount)} · {g.member_count}/{g.member_limit} members</div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Link to={`/admin/groups/${g.id}`} className="btn-secondary !py-1 !px-2.5 text-xs" data-testid={`manage-${g.id}`}>Manage</Link>
                        <button onClick={()=>deleteGroup(g)} className="!py-1 !px-2 text-xs rounded border" style={{color:"#b91c1c",borderColor:"#fecaca",background:"#fef2f2"}} data-testid={`delete-${g.id}`}><Trash2 size={12}/></button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs" style={{color:"var(--muted)"}}><span>Cycle progress</span><span>{cycle}/{g.total_cycles}</span></div>
                      <div className="h-1.5 rounded-full" style={{background:"var(--border)"}}><div className="h-full rounded-full" style={{width:`${pct}%`,background:"var(--primary)",transition:"width .4s"}}/></div>
                    </div>
                  </div>
                );
              })}
              {groups.length===0 && <div className="px-4 py-10 text-center text-sm" style={{color:"var(--muted)"}}>No groups yet.</div>}
            </div>
            {/* Desktop table */}
            <table className="desktop-table w-full text-sm">
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
                        <div className="flex items-center justify-end gap-2">
                          <Link to={`/admin/groups/${g.id}`} className="btn-secondary !py-1.5 !px-3 text-xs" data-testid={`manage-${g.id}`}>Manage</Link>
                          <button
                            onClick={() => deleteGroup(g)}
                            className="!py-1.5 !px-2.5 text-xs rounded border flex items-center gap-1 transition-colors"
                            style={{color:"#b91c1c", borderColor:"#fecaca", background:"#fef2f2"}}
                            title="Delete group"
                            data-testid={`delete-${g.id}`}
                          >
                            <Trash2 size={12}/>
                          </button>
                        </div>
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
            {/* Mobile approval cards */}
            <div className="mobile-list-card divide-y" style={{borderColor:"var(--border)"}}>
              {pending.map(p => (
                <div key={p.id} className="p-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{p.user_name}</div>
                    <div className="text-xs truncate" style={{color:"var(--muted)"}}>{p.user_email}</div>
                    <div className="text-xs mt-1" style={{color:"var(--primary)"}}>{p.group_name} · Cycle #{p.cycle_no}</div>
                    <div className="text-xs mt-0.5" style={{color:"var(--muted)"}}>{fmtDate(p.submitted_at)}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-display text-base">{fmtMoney(p.amount)}</div>
                    <button onClick={()=>openReceipt(p)} className="btn-primary !py-2 !px-3 text-xs mt-2 w-full" data-testid={`review-${p.id}`}>Review</button>
                  </div>
                </div>
              ))}
              {pending.length === 0 && (
                <div className="px-4 py-12 text-center" style={{color:"var(--muted)"}}>
                  <CheckCircle2 className="mx-auto mb-2" size={28} style={{color:"var(--primary)", opacity:.4}} />
                  <div className="text-sm font-medium">All caught up — no pending payments.</div>
                </div>
              )}
            </div>
            {/* Desktop table */}
            <table className="desktop-table w-full text-sm">
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
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[160px]">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{color:"var(--muted)"}} />
                <input value={memberSearch} onChange={e=>setMemberSearch(e.target.value)}
                  placeholder="Search name or email…"
                  className="w-full border rounded pl-8 pr-3 py-2 bg-white text-sm" />
              </div>
              <span className="text-sm shrink-0" style={{color:"var(--muted)"}}>{filteredUsers.length} user{filteredUsers.length !== 1 ? "s" : ""}</span>
              <button onClick={()=>setAddUserOpen(true)} className="btn-primary text-sm inline-flex items-center gap-1.5">
                <UserPlus size={14}/> Add User
              </button>
            </div>
            <div className="card-tactile overflow-hidden" data-testid="users-table">
              {/* Mobile user cards */}
              <div className="mobile-list-card divide-y" style={{borderColor:"var(--border)"}}>
                {filteredUsers.map(u => {
                  const hasBank = u.bank_name && u.bank_account_number;
                  return (
                    <div key={u.id} className="p-4">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-sm truncate">{u.name}</div>
                          <div className="text-xs truncate" style={{color:"var(--muted)"}}>{u.email}</div>
                        </div>
                        <select
                          value={u.role}
                          disabled={roleUpdating === u.id}
                          onChange={e => changeRole(u.id, e.target.value)}
                          className="text-xs border rounded px-2 py-1 bg-white shrink-0"
                          style={{color:"var(--primary)", fontWeight:600}}
                        >
                          <option value="member">member</option>
                          <option value="admin">admin</option>
                          <option value="super_admin">super_admin</option>
                        </select>
                      </div>
                      {hasBank
                        ? <div className="text-xs" style={{color:"var(--muted)"}}>{u.bank_name} · {u.bank_account_number}</div>
                        : <span className="text-xs px-2 py-0.5 rounded" style={{background:"#fee2e2",color:"#991b1b"}}>Bank not set</span>}
                      <div className="flex items-center gap-2 mt-2 pt-2 border-t" style={{borderColor:"var(--border)"}}>
                        <button onClick={()=>openEditUser(u)} className="text-xs inline-flex items-center gap-1" style={{color:"var(--primary)"}}><Pencil size={11}/> Edit</button>
                        <button onClick={()=>{ setResetPwTarget(u); setResetPwValue(""); setResetPwErr(""); }} className="text-xs inline-flex items-center gap-1" style={{color:"#854d0e"}}><KeyRound size={11}/> Set password</button>
                        <button onClick={()=>deleteUser(u)} className="text-xs inline-flex items-center gap-1 ml-auto text-red-700"><Trash2 size={11}/> Delete</button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Desktop table */}
              <table className="desktop-table w-full text-sm">
                <thead className="bg-white/50">
                  <tr className="text-left">
                    <th className="px-4 py-3 label-eyebrow">Name</th>
                    <th className="px-4 py-3 label-eyebrow">Email</th>
                    <th className="px-4 py-3 label-eyebrow">Role</th>
                    <th className="px-4 py-3 label-eyebrow">Bank details</th>
                    <th className="px-4 py-3 label-eyebrow">Joined</th>
                    <th className="px-4 py-3 label-eyebrow"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map(u => {
                    const hasBank = u.bank_name && u.bank_account_number;
                    return (
                      <tr key={u.id} className="border-t" style={{borderColor:"var(--border)"}}>
                        <td className="px-4 py-3 font-medium">{u.name}</td>
                        <td className="px-4 py-3 text-xs" style={{color:"var(--muted)"}}>{u.email}</td>
                        <td className="px-4 py-3">
                          <select
                            value={u.role}
                            disabled={roleUpdating === u.id}
                            onChange={e => changeRole(u.id, e.target.value)}
                            className="text-xs border rounded px-2 py-1 bg-white"
                            style={{color:"var(--primary)", fontWeight:600}}
                          >
                            <option value="member">member</option>
                            <option value="admin">admin</option>
                            <option value="super_admin">super_admin</option>
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          {hasBank ? (
                            <div>
                              <div className="text-xs font-semibold">{u.bank_name}</div>
                              <div className="text-xs" style={{color:"var(--muted)"}}>{u.bank_account_number} · {u.bank_account_name}</div>
                            </div>
                          ) : <span className="text-xs px-2 py-0.5 rounded" style={{background:"#fee2e2", color:"#991b1b"}}>Not set</span>}
                        </td>
                        <td className="px-4 py-3 text-xs" style={{color:"var(--muted)"}}>{fmtDate(u.created_at)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={()=>openEditUser(u)} className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border" style={{color:"var(--primary)",borderColor:"var(--border)"}} title="Edit user"><Pencil size={11}/></button>
                            <button onClick={()=>{ setResetPwTarget(u); setResetPwValue(""); setResetPwErr(""); }} className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border" style={{color:"#854d0e",borderColor:"#fde68a"}} title="Set password"><KeyRound size={11}/></button>
                            <button onClick={()=>deleteUser(u)} className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border text-red-700" style={{borderColor:"#fecaca"}} title="Delete user"><Trash2 size={11}/></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredUsers.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-sm" style={{color:"var(--muted)"}}>No members found.</td></tr>
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

      {/* ── Edit User Modal ── */}
      {editUserTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={()=>setEditUserTarget(null)}>
          <form onClick={e=>e.stopPropagation()} onSubmit={submitEditUser}
            className="bg-white rounded-xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-xl">Edit user</h3>
              <button type="button" onClick={()=>setEditUserTarget(null)} className="p-1 opacity-60 hover:opacity-100"><X size={18}/></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs mb-1 font-semibold" style={{color:"var(--muted)"}}>Full name</label>
                <input required value={editUserForm.name} onChange={e=>setEditUserForm({...editUserForm,name:e.target.value})}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs mb-1 font-semibold" style={{color:"var(--muted)"}}>Email address</label>
                <input required type="email" value={editUserForm.email} onChange={e=>setEditUserForm({...editUserForm,email:e.target.value})}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
            </div>
            {editUserErr && <div className="text-red-700 text-sm mt-3">{editUserErr}</div>}
            <div className="flex gap-2 mt-5 justify-end">
              <button type="button" onClick={()=>setEditUserTarget(null)} className="btn-secondary text-sm">Cancel</button>
              <button type="submit" className="btn-primary text-sm">Save changes</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Reset Password Modal ── */}
      {resetPwTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={()=>setResetPwTarget(null)}>
          <form onClick={e=>e.stopPropagation()} onSubmit={submitResetPw}
            className="bg-white rounded-xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-display text-xl">Set password</h3>
              <button type="button" onClick={()=>setResetPwTarget(null)} className="p-1 opacity-60 hover:opacity-100"><X size={18}/></button>
            </div>
            <p className="text-xs mb-4" style={{color:"var(--muted)"}}>Setting a new password for <b>{resetPwTarget.name}</b>. They will be able to login with this password.</p>
            <div>
              <label className="block text-xs mb-1 font-semibold" style={{color:"var(--muted)"}}>New password (min. 6 characters)</label>
              <input required type="password" minLength={6} value={resetPwValue} onChange={e=>setResetPwValue(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm" placeholder="New password" />
            </div>
            {resetPwErr && <div className="text-red-700 text-sm mt-3">{resetPwErr}</div>}
            <div className="flex gap-2 mt-5 justify-end">
              <button type="button" onClick={()=>setResetPwTarget(null)} className="btn-secondary text-sm">Cancel</button>
              <button type="submit" className="btn-primary text-sm">Set password</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Add User Modal ── */}
      {addUserOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={()=>setAddUserOpen(false)}>
          <form onClick={e=>e.stopPropagation()} onSubmit={submitAddUser}
            className="bg-white rounded-xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex items-center gap-2 mb-1">
              <UserPlus size={18} style={{color:"var(--primary)"}} />
              <h3 className="font-display text-xl">Add User</h3>
            </div>
            <p className="text-xs mb-5" style={{color:"var(--muted)"}}>Create an account on behalf of a member. They can log in and update their profile.</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs mb-1 font-semibold" style={{color:"var(--muted)"}}>Full name</label>
                <input required value={addUserForm.name} onChange={e=>setAddUserForm({...addUserForm,name:e.target.value})}
                  className="w-full border rounded px-3 py-2 text-sm" placeholder="e.g. Amaka Osei" />
              </div>
              <div>
                <label className="block text-xs mb-1 font-semibold" style={{color:"var(--muted)"}}>Email address</label>
                <input required type="email" value={addUserForm.email} onChange={e=>setAddUserForm({...addUserForm,email:e.target.value})}
                  className="w-full border rounded px-3 py-2 text-sm" placeholder="amaka@example.com" />
              </div>
              <div>
                <label className="block text-xs mb-1 font-semibold" style={{color:"var(--muted)"}}>Temporary password</label>
                <input required type="password" value={addUserForm.password} onChange={e=>setAddUserForm({...addUserForm,password:e.target.value})}
                  className="w-full border rounded px-3 py-2 text-sm" placeholder="Min. 6 characters" />
              </div>
              <div>
                <label className="block text-xs mb-1 font-semibold" style={{color:"var(--muted)"}}>Role</label>
                <select value={addUserForm.role} onChange={e=>setAddUserForm({...addUserForm,role:e.target.value})}
                  className="w-full border rounded px-3 py-2 text-sm bg-white">
                  <option value="member">member — regular ajo participant</option>
                  <option value="admin">admin — can manage groups</option>
                  <option value="super_admin">super_admin — full platform access</option>
                </select>
              </div>
            </div>
            {addUserErr && <div className="text-red-700 text-sm mt-3">{addUserErr}</div>}
            <div className="flex gap-2 mt-5 justify-end">
              <button type="button" onClick={()=>setAddUserOpen(false)} className="btn-secondary text-sm">Cancel</button>
              <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5"><UserPlus size={13}/>Create user</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Create Group Modal ── */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col sm:items-center sm:justify-start sm:pt-8 sm:px-4 sm:pb-4 sm:bg-black/40"
          onClick={()=>setCreateOpen(false)}
        >
          <form
            onClick={e=>e.stopPropagation()}
            onSubmit={submitCreate}
            className="flex flex-col bg-white w-full h-full sm:h-auto sm:max-h-[90vh] sm:rounded-2xl sm:shadow-2xl sm:max-w-xl overflow-hidden"
            data-testid="create-group-modal"
          >
            {/* Sticky header */}
            <div className="flex items-start justify-between px-5 py-4 border-b flex-shrink-0" style={{borderColor:"var(--border)"}}>
              <div>
                <h3 className="font-display text-xl">Create Ajo Group</h3>
                <p className="text-xs mt-0.5" style={{color:"var(--muted)"}}>You can invite members after creation.</p>
              </div>
              <button type="button" onClick={()=>setCreateOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100 -mt-1 -mr-1 flex-shrink-0">
                <X size={18}/>
              </button>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1 px-5 py-5 space-y-6">

              {/* Section: Basic Info */}
              <div>
                <div className="label-eyebrow mb-3">Basic Info</div>
                <div className="space-y-3">
                  <div>
                    <label className="form-label">Group name *</label>
                    <input required type="text" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}
                      className="form-input" data-testid="field-name" placeholder="e.g. Lagos Women's Ajo 2026" />
                  </div>
                  <div>
                    <label className="form-label">Description</label>
                    <input type="text" value={form.description} onChange={e=>setForm({...form,description:e.target.value})}
                      className="form-input" data-testid="field-description" placeholder="Short description (optional)" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">Frequency *</label>
                      <select required value={form.frequency} onChange={e=>setForm({...form,frequency:e.target.value})}
                        className="form-input bg-white" data-testid="field-frequency">
                        <option value="monthly">Monthly</option>
                        <option value="weekly">Weekly</option>
                        <option value="biweekly">Bi-weekly</option>
                      </select>
                    </div>
                    <div>
                      <label className="form-label">Start date *</label>
                      <input required type="date" value={form.start_date} onChange={e=>setForm({...form,start_date:e.target.value})}
                        className="form-input" data-testid="field-start_date" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Section: Structure */}
              <div className="border-t pt-5" style={{borderColor:"var(--border)"}}>
                <div className="label-eyebrow mb-3">Group Structure</div>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">Total cycles *</label>
                      <input required type="number" min="1" value={form.total_cycles} onChange={e=>setForm({...form,total_cycles:e.target.value})}
                        className="form-input" data-testid="field-total_cycles" />
                    </div>
                    <div>
                      <label className="form-label">Member limit *</label>
                      <input required type="number" min="1" value={form.member_limit} onChange={e=>setForm({...form,member_limit:e.target.value})}
                        className="form-input" data-testid="field-member_limit" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">Due day (1–28) *</label>
                      <input required type="number" min="1" max="28" value={form.due_day} onChange={e=>setForm({...form,due_day:e.target.value})}
                        className="form-input" data-testid="field-due_day" />
                    </div>
                    <div>
                      <label className="form-label">Due time *</label>
                      <input required type="time" value={form.due_time} onChange={e=>setForm({...form,due_time:e.target.value})}
                        className="form-input" data-testid="field-due_time" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Section: Finances */}
              <div className="border-t pt-5" style={{borderColor:"var(--border)"}}>
                <div className="label-eyebrow mb-3">Finances</div>
                <div className="space-y-3">
                  <div>
                    <label className="form-label">Contribution amount (₦) *</label>
                    <input required type="number" min="0" value={form.contribution_amount} onChange={e=>setForm({...form,contribution_amount:e.target.value})}
                      className="form-input" data-testid="field-contribution_amount" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">First payment fee (₦)</label>
                      <input type="number" min="0" value={form.first_payment_fee} onChange={e=>setForm({...form,first_payment_fee:e.target.value})}
                        className="form-input" data-testid="field-first_payment_fee" />
                    </div>
                    <div>
                      <label className="form-label">Late fee (₦)</label>
                      <input type="number" min="0" value={form.late_fee_amount} onChange={e=>setForm({...form,late_fee_amount:e.target.value})}
                        className="form-input" data-testid="field-late_fee_amount" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">Late fee method</label>
                      <select value={form.late_fee_method} onChange={e=>setForm({...form,late_fee_method:e.target.value})}
                        className="form-input bg-white" data-testid="field-late_fee_method">
                        <option value="fixed">Fixed amount</option>
                        <option value="percent">Percentage</option>
                      </select>
                    </div>
                    <div>
                      <label className="form-label">Grace period (days)</label>
                      <input type="number" min="0" value={form.grace_period_days} onChange={e=>setForm({...form,grace_period_days:e.target.value})}
                        className="form-input" data-testid="field-grace_period_days" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Section: Details */}
              <div className="border-t pt-5" style={{borderColor:"var(--border)"}}>
                <div className="label-eyebrow mb-3">Details</div>
                <div className="space-y-3">
                  <div>
                    <label className="form-label">Payment account details <span className="font-normal">(bank info for payout recipient)</span></label>
                    <textarea value={form.payment_account_details} onChange={e=>setForm({...form,payment_account_details:e.target.value})}
                      rows={2} className="form-input" data-testid="field-account-details"
                      placeholder="e.g. GTBank – 0123456789 – Amaka Osei" />
                  </div>
                  <div>
                    <label className="form-label">Group rules <span className="font-normal">(shown to invitees before joining)</span></label>
                    <textarea value={form.rules_text} onChange={e=>setForm({...form,rules_text:e.target.value})}
                      rows={4} className="form-input"
                      placeholder="e.g. 1. Contributions due by midnight on the due day.&#10;2. Late fee applies after the grace period."
                      data-testid="field-rules" />
                  </div>
                  <label className="flex items-center gap-3 cursor-pointer select-none py-1">
                    <input type="checkbox" checked={form.enable_comments}
                      onChange={e=>setForm({...form,enable_comments:e.target.checked})}
                      className="w-4 h-4 rounded flex-shrink-0" data-testid="field-enable-comments"/>
                    <span className="text-sm">Enable member comments on this group</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Sticky footer */}
            {createErr && (
              <div className="px-5 py-2 text-sm font-medium" style={{background:"#fef2f2",color:"#b91c1c"}} data-testid="create-error">{createErr}</div>
            )}
            <div className="border-t px-5 py-4 flex gap-3 flex-shrink-0 bg-white" style={{borderColor:"var(--border)"}}>
              <button type="button" onClick={()=>setCreateOpen(false)} className="btn-secondary flex-1 text-sm" data-testid="create-cancel">Cancel</button>
              <button type="submit" className="btn-primary flex-1 text-sm" data-testid="create-submit">Create group</button>
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
