import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { fmtMoney, fmtDate } from "../api";
import TopNav from "../components/TopNav";
import StatusBadge from "../components/StatusBadge";
import { useAuth } from "../AuthContext";
import { Inbox, BarChart3, ChevronDown, ChevronUp, Gift, AlertTriangle, CheckCircle2, Clock, Wallet } from "lucide-react";

export default function MemberDashboard() {
  const { user } = useAuth();
  const [groups, setGroups] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get("/groups/my").then((r)=>r.data).catch(()=>[]),
      api.get("/payments/my").then((r)=>r.data).catch(()=>[]),
    ]).then(([g, p]) => { setGroups(g); setPayments(p); setLoading(false); });
  }, []);

  const loadSummary = async () => {
    if (summary) { setSummaryOpen(o => !o); return; }
    setSummaryLoading(true); setSummaryOpen(true);
    try {
      const { data } = await api.get("/member/my-summary");
      setSummary(data);
    } catch { setSummary(null); }
    finally { setSummaryLoading(false); }
  };

  const stats = {
    groups: groups.length,
    pending: payments.filter(p=>p.status==="submitted").length,
    approved: payments.filter(p=>p.status==="approved").length,
    rejected: payments.filter(p=>p.status==="rejected").length,
  };

  return (
    <div className="min-h-screen bg-app">
      <TopNav />
      <main className="page-main">
        <div className="mb-6 sm:mb-10">
          <div className="label-eyebrow mb-1">Member Dashboard</div>
          <h1 className="font-display text-2xl sm:text-3xl">Hello, {user?.name?.split(" ")[0] || "Member"}</h1>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            Your groups, payment history and contribution status.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 sm:mb-10">
          {[
            { label: "My groups", value: stats.groups },
            { label: "Pending", value: stats.pending },
            { label: "Approved", value: stats.approved },
            { label: "Rejected", value: stats.rejected },
          ].map((s, i) => (
            <div key={i} className="card-tactile p-4 sm:p-6" data-testid={`stat-${i}`}>
              <div className="label-eyebrow">{s.label}</div>
              <div className="font-display text-2xl sm:text-3xl mt-1">{s.value}</div>
            </div>
          ))}
        </div>

        {/* ── My Ajo Summary Panel ── */}
        <section className="mb-6">
          <button onClick={loadSummary}
            className="w-full card-tactile p-4 flex items-center justify-between gap-3 text-left hover-lift transition-all"
            data-testid="summary-toggle">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:"var(--primary)12"}}>
                <BarChart3 size={18} style={{color:"var(--primary)"}}/>
              </div>
              <div>
                <div className="font-semibold text-sm">My Full Ajo Summary</div>
                <div className="text-xs mt-0.5" style={{color:"var(--muted)"}}>
                  Slots, contributions, payouts &amp; status across all groups
                </div>
              </div>
            </div>
            <div className="flex-shrink-0 opacity-50">
              {summaryOpen ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}
            </div>
          </button>

          {summaryOpen && (
            <div className="mt-2 card-tactile overflow-hidden">
              {summaryLoading ? (
                <div className="p-6 text-sm text-center" style={{color:"var(--muted)"}}>Loading your summary…</div>
              ) : !summary || summary.groups.length === 0 ? (
                <div className="p-6 text-sm text-center" style={{color:"var(--muted)"}}>No group data found.</div>
              ) : (
                <div>
                  {/* Totals header */}
                  <div className="px-5 py-4 flex flex-wrap gap-4 border-b" style={{background:"var(--primary)06", borderColor:"var(--border)"}}>
                    <div>
                      <div className="label-eyebrow">Total groups</div>
                      <div className="font-display text-2xl">{summary.total_groups}</div>
                    </div>
                    <div>
                      <div className="label-eyebrow">Total monthly due</div>
                      <div className="font-display text-2xl" style={{color:"var(--primary)"}}>{fmtMoney(summary.total_monthly_due)}</div>
                    </div>
                  </div>

                  {/* Per-group rows */}
                  <div className="divide-y" style={{borderColor:"var(--border)"}}>
                    {summary.groups.map(g => (
                      <div key={g.group_id} className="px-5 py-4">
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div className="min-w-0">
                            <Link to={`/groups/${g.group_id}`} className="font-display text-base hover:underline truncate block" style={{color:"var(--primary)"}}>
                              {g.group_name}
                            </Link>
                            <div className="text-xs mt-0.5 flex items-center gap-2 flex-wrap" style={{color:"var(--muted)"}}>
                              <span className="capitalize">{g.frequency}</span>
                              <span>·</span>
                              <span>{g.total_cycles} cycles</span>
                              <span>·</span>
                              <span className={`badge ${g.status==="active"?"s-Paid":"s-Not_Due"} !text-xs`}>{g.status}</span>
                            </div>
                          </div>
                          <div className="flex gap-1 flex-wrap justify-end shrink-0">
                            {g.my_slots.map(pos => (
                              <span key={pos} className="badge s-Payout_Eligible">#{pos}</span>
                            ))}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                          <div className="rounded-lg p-3" style={{background:"var(--surface)"}}>
                            <div className="flex items-center gap-1.5 mb-1" style={{color:"var(--muted)"}}>
                              <Wallet size={12}/> <span className="text-xs">Monthly due</span>
                            </div>
                            <div className="font-display font-semibold">{fmtMoney(g.monthly_due)}</div>
                            {g.my_slots.length > 1 && <div className="text-xs mt-0.5" style={{color:"var(--muted)"}}>{g.my_slots.length} slots × {fmtMoney(g.contribution_amount)}</div>}
                          </div>

                          <div className="rounded-lg p-3" style={{background:"var(--surface)"}}>
                            <div className="flex items-center gap-1.5 mb-1" style={{color:"var(--muted)"}}>
                              <Gift size={12}/> <span className="text-xs">I receive</span>
                            </div>
                            <div className="font-display font-semibold" style={{color:"var(--primary)"}}>{fmtMoney(g.payout_total)}</div>
                            <div className="text-xs mt-0.5" style={{color:"var(--muted)"}}>{g.total_members} members × {fmtMoney(g.contribution_amount)}</div>
                          </div>

                          <div className="rounded-lg p-3" style={{background:"var(--surface)"}}>
                            <div className="flex items-center gap-1.5 mb-1" style={{color:"var(--muted)"}}>
                              <CheckCircle2 size={12}/> <span className="text-xs">Paid cycles</span>
                            </div>
                            <div className="font-display font-semibold">{g.paid_cycles} <span className="text-xs font-normal" style={{color:"var(--muted)"}}>/ {g.total_cycles}</span></div>
                            {g.overdue_cycles > 0 && (
                              <div className="text-xs mt-0.5 flex items-center gap-1 text-red-600">
                                <AlertTriangle size={10}/> {g.overdue_cycles} overdue
                              </div>
                            )}
                          </div>

                          <div className="rounded-lg p-3" style={{background:"var(--surface)"}}>
                            <div className="flex items-center gap-1.5 mb-1" style={{color:"var(--muted)"}}>
                              <Clock size={12}/> <span className="text-xs">Payout month{g.payout_cycles.length !== 1 ? "s" : ""}</span>
                            </div>
                            {g.payout_cycles.length > 0 ? (
                              <div className="space-y-0.5">
                                {g.payout_cycles.map(c => (
                                  <div key={c.cycle_no} className="text-xs font-semibold" style={{color:"#16a34a"}}>
                                    Month {c.cycle_no} · {fmtDate(c.due_date)}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-xs" style={{color:"var(--muted)"}}>Not assigned yet</div>
                            )}
                          </div>
                        </div>

                        {(g.due_now > 0 || g.overdue_cycles > 0) && (
                          <div className="mt-3 px-3 py-2 rounded-lg flex items-center gap-2 text-sm"
                            style={{background: g.overdue_cycles > 0 ? "#fee2e2" : "#fef3c7"}}>
                            <AlertTriangle size={14} style={{color: g.overdue_cycles > 0 ? "#dc2626" : "#d97706", flexShrink:0}}/>
                            <span style={{color: g.overdue_cycles > 0 ? "#991b1b" : "#92400e"}}>
                              {g.overdue_cycles > 0
                                ? `${g.overdue_cycles} overdue payment${g.overdue_cycles>1?"s":""} — pay now to avoid penalties`
                                : `${g.due_now} payment${g.due_now>1?"s":""} due now`}
                              {g.next_due_amount && ` · ${fmtMoney(g.next_due_amount)}`}
                            </span>
                            <Link to={`/groups/${g.group_id}`} className="ml-auto text-xs font-semibold underline shrink-0"
                              style={{color: g.overdue_cycles > 0 ? "#dc2626" : "#d97706"}}>View</Link>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="mb-8 sm:mb-12">
          <h2 className="font-display text-xl sm:text-2xl mb-3 sm:mb-4">Your groups</h2>
          {loading ? <div className="text-sm" style={{color:"var(--muted)"}}>Loading...</div> :
           groups.length === 0 ? (
            <div className="card-tactile p-8 text-center" data-testid="empty-groups">
              <Inbox className="mx-auto mb-3" style={{ color: "var(--muted)" }} />
              <div className="font-display text-lg">Not yet in any Ajo group</div>
              <p className="text-sm mt-2" style={{ color: "var(--muted)" }}>
                An admin will add you. You'll see it here once assigned.
              </p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3 sm:gap-4">
              {groups.map(g => (
                <Link to={`/groups/${g.id}`} key={g.id} className="card-tactile p-4 sm:p-6 hover-lift block" data-testid={`group-card-${g.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="label-eyebrow">{g.frequency} · {g.total_cycles} cycles</div>
                      <div className="font-display text-lg sm:text-xl mt-1 truncate">{g.name}</div>
                      {g.description && <div className="text-xs mt-1 truncate" style={{color:"var(--muted)"}}>{g.description}</div>}
                    </div>
                    <div className="flex gap-1 flex-wrap shrink-0 justify-end">
                      {(g.my_slots || [g.payout_position]).map(pos =>
                        <span key={pos} className="badge s-Payout_Eligible">#{pos}</span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
                    <div>
                      <div className="label-eyebrow">Monthly due</div>
                      <div className="font-display text-base sm:text-lg">{fmtMoney(g.my_monthly_due || g.contribution_amount)}</div>
                      {(g.my_slots?.length > 1) && <div className="text-xs mt-0.5" style={{color:"var(--muted)"}}>{g.my_slots.length} slots × {fmtMoney(g.contribution_amount)}</div>}
                    </div>
                    <div><div className="label-eyebrow">Starts</div><div className="font-display text-base sm:text-lg">{fmtDate(g.start_date)}</div></div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="font-display text-xl sm:text-2xl mb-3 sm:mb-4">Payment history</h2>
          {payments.length === 0 ? (
            <div className="card-tactile p-6 text-sm" style={{color:"var(--muted)"}}>No payment submissions yet.</div>
          ) : (
            <div className="card-tactile overflow-hidden">
              {/* Mobile card list */}
              <div className="mobile-list-card divide-y" style={{borderColor:"var(--border)"}}>
                {payments.map(p => (
                  <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">Cycle #{p.cycle_no}</div>
                      <div className="text-xs mt-0.5" style={{color:"var(--muted)"}}>{fmtDate(p.submitted_at)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-display text-sm">{fmtMoney(p.amount)}</div>
                      <div className="mt-1">
                        <span className={`badge ${p.status==="approved"?"s-Paid":p.status==="rejected"?"s-Rejected":"s-Submitted"}`}>
                          {p.status}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop table */}
              <table className="desktop-table w-full text-sm" data-testid="payment-history-table">
                <thead className="bg-white/50">
                  <tr className="text-left">
                    <th className="px-4 py-3 label-eyebrow">Date</th>
                    <th className="px-4 py-3 label-eyebrow">Cycle</th>
                    <th className="px-4 py-3 label-eyebrow text-right">Amount</th>
                    <th className="px-4 py-3 label-eyebrow">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id} className="border-t" style={{borderColor:"var(--border)"}}>
                      <td className="px-4 py-3">{fmtDate(p.submitted_at)}</td>
                      <td className="px-4 py-3">#{p.cycle_no}</td>
                      <td className="px-4 py-3 text-right font-display">{fmtMoney(p.amount)}</td>
                      <td className="px-4 py-3">
                        <span className={`badge ${p.status==="approved"?"s-Paid":p.status==="rejected"?"s-Rejected":"s-Submitted"}`}>
                          {p.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
