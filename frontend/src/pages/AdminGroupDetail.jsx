import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import api, { fmtMoney, fmtDate, formatErr } from "../api";
import TopNav from "../components/TopNav";
import StatusBadge from "../components/StatusBadge";
import { Trash2, UserPlus, Check } from "lucide-react";
import InvitationsPanel from "../components/InvitationsPanel";
import Comments from "../components/Comments";

export default function AdminGroupDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [users, setUsers] = useState([]);
  const [addEmail, setAddEmail] = useState("");
  const [addPos, setAddPos] = useState("");
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("members");

  const load = async () => {
    const [d, u] = await Promise.all([
      api.get(`/admin/groups/${id}`).then(r=>r.data),
      api.get("/admin/users").then(r=>r.data),
    ]);
    // also fetch full statuses via the detail endpoint
    const detail = await api.get(`/groups/${id}/detail`).then(r=>r.data);
    setData({ ...d, statuses: detail.statuses, cycles: detail.cycles });
    setUsers(u);
  };
  useEffect(() => { load(); }, [id]);

  if (!data) return <div className="min-h-screen bg-app"><TopNav /><div className="max-w-3xl mx-auto p-10">Loading...</div></div>;

  const { group, members, cycles, statuses } = data;
  const memberIds = new Set(members.map(m=>m.user_id));
  const availableUsers = users.filter(u => u.role === "member" && !memberIds.has(u.id));

  const addMember = async (e) => {
    e.preventDefault(); setErr("");
    try {
      await api.post(`/admin/groups/${id}/members`, { email: addEmail, payout_position: addPos ? Number(addPos) : null });
      setAddEmail(""); setAddPos(""); load();
    } catch (e) { setErr(formatErr(e?.response?.data?.detail)); }
  };

  const remove = async (uid) => {
    if (!window.confirm("Remove this member?")) return;
    await api.delete(`/admin/groups/${id}/members/${uid}`); load();
  };

  const confirmPayout = async (cycleNo) => {
    if (!window.confirm(`Confirm payout for cycle ${cycleNo}?`)) return;
    try { await api.post(`/admin/payouts/${id}/${cycleNo}/confirm`); load(); }
    catch (e) { alert(formatErr(e?.response?.data?.detail)); }
  };

  // Build status matrix: members x cycles
  const statusMap = {};
  for (const s of statuses) statusMap[`${s.user_id}_${s.cycle_no}`] = s.status;

  return (
    <div className="min-h-screen bg-app">
      <TopNav />
      <main className="max-w-7xl mx-auto px-6 py-10">
        <Link to="/admin" className="text-sm" style={{color:"var(--muted)"}} data-testid="back-admin">← Back to admin</Link>
        <div className="flex items-start justify-between mt-2 mb-8">
          <div>
            <div className="label-eyebrow">{group.frequency} · {group.total_cycles} cycles</div>
            <h1 className="font-display text-4xl">{group.name}</h1>
            <p className="text-sm mt-1" style={{color:"var(--muted)"}}>{group.description}</p>
          </div>
          <div className="card-tactile p-5 min-w-[220px]">
            <div className="label-eyebrow">Contribution</div>
            <div className="font-display text-3xl mt-1">{fmtMoney(group.contribution_amount)}</div>
            <div className="text-xs mt-2" style={{color:"var(--muted)"}}>{members.length}/{group.member_limit} members</div>
          </div>
        </div>

        <div className="flex gap-1 border-b mb-6" style={{borderColor:"var(--border)"}}>
          {["members","invitations","ledger","payouts","comments"].map(k => (
            <button key={k} onClick={()=>setTab(k)}
              className={`px-4 py-2 text-sm border-b-2 -mb-px capitalize ${tab===k?"font-medium":"opacity-60"}`}
              style={{borderColor: tab===k?"var(--primary)":"transparent", color: tab===k?"var(--primary)":"var(--text)"}}
              data-testid={`gtab-${k}`}>{k}</button>
          ))}
        </div>

        {tab === "members" && (
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 card-tactile overflow-hidden">
              <table className="w-full text-sm" data-testid="group-members-table">
                <thead className="bg-white/50"><tr className="text-left">
                  <th className="px-4 py-3 label-eyebrow">#</th>
                  <th className="px-4 py-3 label-eyebrow">Member</th>
                  <th className="px-4 py-3 label-eyebrow">Email</th>
                  <th className="px-4 py-3 label-eyebrow">Joined</th>
                  <th className="px-4 py-3 label-eyebrow"></th>
                </tr></thead>
                <tbody>
                  {[...members].sort((a,b)=>a.payout_position-b.payout_position).map(m => (
                    <tr key={m.id} className="border-t" style={{borderColor:"var(--border)"}}>
                      <td className="px-4 py-3 font-display">#{m.payout_position}</td>
                      <td className="px-4 py-3">{m.user_name}</td>
                      <td className="px-4 py-3" style={{color:"var(--muted)"}}>{m.user_email}</td>
                      <td className="px-4 py-3" style={{color:"var(--muted)"}}>{fmtDate(m.joined_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={()=>remove(m.user_id)} className="text-xs text-red-700 inline-flex items-center gap-1" data-testid={`remove-${m.user_id}`}>
                          <Trash2 size={12}/> Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                  {members.length===0 && <tr><td colSpan={5} className="px-4 py-10 text-center" style={{color:"var(--muted)"}}>No members yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <form onSubmit={addMember} className="card-tactile p-5" data-testid="add-member-form">
              <h3 className="font-display text-lg mb-3 flex items-center gap-2"><UserPlus size={16}/> Add member</h3>
              <label className="label-eyebrow block mb-1">Member email</label>
              <select required value={addEmail} onChange={e=>setAddEmail(e.target.value)} className="w-full border rounded px-3 py-2 bg-white mb-3" data-testid="add-email">
                <option value="">— Select existing user —</option>
                {availableUsers.map(u => <option key={u.id} value={u.email}>{u.name} · {u.email}</option>)}
              </select>
              <label className="label-eyebrow block mb-1">Payout position (optional)</label>
              <input type="number" value={addPos} onChange={e=>setAddPos(e.target.value)} className="w-full border rounded px-3 py-2 mb-3" data-testid="add-position"/>
              {err && <div className="text-red-700 text-sm mb-2" data-testid="add-error">{err}</div>}
              <button className="btn-primary text-sm w-full" data-testid="add-submit">Add to group</button>
              <p className="text-xs mt-3" style={{color:"var(--muted)"}}>Only existing platform users can be added. They must register first.</p>
            </form>
          </div>
        )}

        {tab === "invitations" && <InvitationsPanel groupId={id} />}

        {tab === "comments" && <Comments groupId={id} />}

        {tab === "ledger" && (
          <div className="card-tactile overflow-x-auto">
            <table className="text-sm" data-testid="ledger-matrix">
              <thead className="bg-white/50">
                <tr className="text-left">
                  <th className="px-3 py-2 label-eyebrow sticky left-0 bg-[var(--surface)]">Member \\ Cycle</th>
                  {cycles.map(c => <th key={c.id} className="px-3 py-2 label-eyebrow text-center">#{c.cycle_no}</th>)}
                </tr>
              </thead>
              <tbody>
                {[...members].sort((a,b)=>a.payout_position-b.payout_position).map(m => (
                  <tr key={m.id} className="border-t" style={{borderColor:"var(--border)"}}>
                    <td className="px-3 py-2 sticky left-0 bg-[var(--surface)] whitespace-nowrap">{m.user_name}</td>
                    {cycles.map(c => (
                      <td key={c.id} className="px-3 py-2 text-center">
                        <StatusBadge status={statusMap[`${m.user_id}_${c.cycle_no}`] || "Not_Due"} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "payouts" && (
          <div className="card-tactile overflow-hidden">
            <table className="w-full text-sm" data-testid="payouts-table">
              <thead className="bg-white/50"><tr className="text-left">
                <th className="px-4 py-3 label-eyebrow">Cycle</th>
                <th className="px-4 py-3 label-eyebrow">Due date</th>
                <th className="px-4 py-3 label-eyebrow">Recipient</th>
                <th className="px-4 py-3 label-eyebrow">Status</th>
                <th className="px-4 py-3 label-eyebrow"></th>
              </tr></thead>
              <tbody>
                {cycles.map(c => {
                  const recipient = members.find(m=>m.user_id===c.payout_user_id);
                  return (
                    <tr key={c.id} className="border-t" style={{borderColor:"var(--border)"}}>
                      <td className="px-4 py-3 font-display">#{c.cycle_no}</td>
                      <td className="px-4 py-3">{fmtDate(c.due_date)}</td>
                      <td className="px-4 py-3">{recipient?.user_name || <span style={{color:"var(--muted)"}}>—</span>}</td>
                      <td className="px-4 py-3">
                        <span className={`badge ${c.payout_status==="completed"?"s-Payout_Completed":"s-Payout_Eligible"}`}>{c.payout_status}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {c.payout_status !== "completed" && c.payout_user_id && (
                          <button onClick={()=>confirmPayout(c.cycle_no)} className="btn-primary !py-1.5 !px-3 text-xs inline-flex items-center gap-1" data-testid={`payout-${c.cycle_no}`}>
                            <Check size={12}/> Confirm payout
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
