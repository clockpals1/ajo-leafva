import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { fmtMoney, fmtDate } from "../api";
import TopNav from "../components/TopNav";
import StatusBadge from "../components/StatusBadge";
import { useAuth } from "../AuthContext";
import { Inbox } from "lucide-react";

export default function MemberDashboard() {
  const { user } = useAuth();
  const [groups, setGroups] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get("/groups/my").then((r)=>r.data).catch(()=>[]),
      api.get("/payments/my").then((r)=>r.data).catch(()=>[]),
    ]).then(([g, p]) => { setGroups(g); setPayments(p); setLoading(false); });
  }, []);

  const stats = {
    groups: groups.length,
    pending: payments.filter(p=>p.status==="submitted").length,
    approved: payments.filter(p=>p.status==="approved").length,
    rejected: payments.filter(p=>p.status==="rejected").length,
  };

  return (
    <div className="min-h-screen bg-app">
      <TopNav />
      <main className="max-w-7xl mx-auto px-6 py-10">
        <div className="mb-10">
          <div className="label-eyebrow mb-2">Member Dashboard</div>
          <h1 className="font-display text-3xl">Hello, {user?.name?.split(" ")[0] || "Member"}</h1>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            Your assigned groups, payment history and contribution status.
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          {[
            { label: "Assigned groups", value: stats.groups },
            { label: "Pending review", value: stats.pending },
            { label: "Approved", value: stats.approved },
            { label: "Rejected", value: stats.rejected },
          ].map((s, i) => (
            <div key={i} className="card-tactile p-6" data-testid={`stat-${i}`}>
              <div className="label-eyebrow">{s.label}</div>
              <div className="font-display text-3xl mt-2">{s.value}</div>
            </div>
          ))}
        </div>

        <section className="mb-12">
          <h2 className="font-display text-2xl mb-4">Your groups</h2>
          {loading ? <div className="text-sm" style={{color:"var(--muted)"}}>Loading...</div> :
           groups.length === 0 ? (
            <div className="card-tactile p-10 text-center" data-testid="empty-groups">
              <Inbox className="mx-auto mb-3" style={{ color: "var(--muted)" }} />
              <div className="font-display text-lg">Not yet assigned to any Ajo group</div>
              <p className="text-sm mt-2" style={{ color: "var(--muted)" }}>
                An admin will add you to a group. You'll see it here once assigned.
              </p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {groups.map(g => (
                <Link to={`/groups/${g.id}`} key={g.id} className="card-tactile p-6 hover-lift block" data-testid={`group-card-${g.id}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="label-eyebrow">{g.frequency} · {g.total_cycles} cycles</div>
                      <div className="font-display text-xl mt-1">{g.name}</div>
                      <div className="text-xs mt-1" style={{color:"var(--muted)"}}>{g.description}</div>
                    </div>
                    <span className="badge s-Payout_Eligible">Position #{g.payout_position}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-5 text-sm">
                    <div><div className="label-eyebrow">Contribution</div><div className="font-display text-lg">{fmtMoney(g.contribution_amount)}</div></div>
                    <div><div className="label-eyebrow">Starts</div><div className="font-display text-lg">{fmtDate(g.start_date)}</div></div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="font-display text-2xl mb-4">Payment history</h2>
          {payments.length === 0 ? (
            <div className="card-tactile p-8 text-sm" style={{color:"var(--muted)"}}>No payment submissions yet.</div>
          ) : (
            <div className="card-tactile overflow-hidden">
              <table className="w-full text-sm" data-testid="payment-history-table">
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
