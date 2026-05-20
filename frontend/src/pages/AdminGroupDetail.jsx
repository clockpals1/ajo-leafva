import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import api, { fmtMoney, fmtDate, formatErr } from "../api";
import TopNav from "../components/TopNav";
import StatusBadge from "../components/StatusBadge";
import { Trash2, UserPlus, Check, Copy, ExternalLink, Pencil, Save, Link2, RefreshCw, MessageSquare, X } from "lucide-react";
import InvitationsPanel from "../components/InvitationsPanel";
import Comments from "../components/Comments";

function BroadcastBox({ groupId }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (e) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setBusy(true); setMsg("");
    try {
      await api.post("/admin/broadcast", { title, body, group_id: groupId });
      setMsg("Notification sent to all group members.");
      setTitle(""); setBody("");
    } catch (err) {
      setMsg(formatErr(err?.response?.data?.detail) || "Failed");
    } finally { setBusy(false); }
  };
  return (
    <form onSubmit={send} className="card-tactile p-6" data-testid="broadcast-form">
      <h3 className="font-display text-xl mb-3">Broadcast notification</h3>
      <p className="text-xs mb-4" style={{color:"var(--muted)"}}>Sends an in-app notification to every active member of this group.</p>
      <div className="grid md:grid-cols-3 gap-3">
        <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Title"
          className="border rounded px-3 py-2 bg-white md:col-span-1" data-testid="broadcast-title" />
        <input value={body} onChange={e=>setBody(e.target.value)} placeholder="Message body"
          className="border rounded px-3 py-2 bg-white md:col-span-2" data-testid="broadcast-body" />
      </div>
      <div className="flex items-center justify-between mt-3">
        <div className="text-sm" style={{color:"var(--primary)"}} data-testid="broadcast-msg">{msg}</div>
        <button disabled={busy} className="btn-primary text-sm" data-testid="broadcast-send">
          {busy ? "Sending…" : "Send to group"}
        </button>
      </div>
    </form>
  );
}

export default function AdminGroupDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [users, setUsers] = useState([]);
  const [addEmail, setAddEmail] = useState("");
  const [addPos, setAddPos] = useState("");
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("members");
  const [editData, setEditData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [joinToken, setJoinToken] = useState("");
  const [joinCopied, setJoinCopied] = useState(false);
  const [joinRegen, setJoinRegen] = useState(false);
  const [joinLinkLoading, setJoinLinkLoading] = useState(false);
  const [joinLinkErr, setJoinLinkErr] = useState("");
  const [messages, setMessages] = useState([]);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removeReason, setRemoveReason] = useState("");
  const [editingPos, setEditingPos] = useState({});  // { user_id: draftValue }

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
  const loadMessages = () =>
    api.get(`/admin/groups/${id}/member-messages`).then(r => setMessages(r.data)).catch(()=>{});

  const loadJoinLink = async () => {
    setJoinLinkLoading(true); setJoinLinkErr("");
    try {
      const r = await api.get(`/admin/groups/${id}/join-link`);
      setJoinToken(r.data.join_token);
    } catch (e) {
      setJoinLinkErr(formatErr(e?.response?.data?.detail) || "Could not load link");
    } finally { setJoinLinkLoading(false); }
  };

  useEffect(() => { load(); loadJoinLink(); loadMessages(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (data?.group) setEditData({ ...data.group }); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const setField = (k, v) => setEditData(prev => ({ ...prev, [k]: v }));

  const saveGroup = async () => {
    setSaving(true); setSaveMsg("");
    try {
      await api.patch(`/admin/groups/${id}`, editData);
      setSaveMsg("Saved!");
      load();
    } catch (e) { setSaveMsg(formatErr(e?.response?.data?.detail) || "Failed"); }
    finally { setSaving(false); setTimeout(() => setSaveMsg(""), 3000); }
  };

  if (!data) return <div className="min-h-screen bg-app"><TopNav /><div className="page-main">Loading...</div></div>;

  const { group, members, cycles, statuses } = data;
  const memberIds = new Set(members.map(m=>m.user_id));
  const multiSlots = !!group.allow_multiple_slots;
  const availableUsers = multiSlots
    ? users.filter(u => u.role === "member")
    : users.filter(u => u.role === "member" && !memberIds.has(u.id));
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));

  const copyText = (text) => navigator.clipboard?.writeText(text);

  const addMember = async (e) => {
    e.preventDefault(); setErr("");
    try {
      await api.post(`/admin/groups/${id}/members`, { email: addEmail, payout_position: addPos ? Number(addPos) : null });
      setAddEmail(""); setAddPos(""); load();
    } catch (e) { setErr(formatErr(e?.response?.data?.detail)); }
  };

  const startEditPos = (mid, current) =>
    setEditingPos(prev => ({ ...prev, [mid]: String(current) }));

  const cancelEditPos = (mid) =>
    setEditingPos(prev => { const n = { ...prev }; delete n[mid]; return n; });

  const savePosition = async (mid) => {
    const val = parseInt(editingPos[mid], 10);
    if (!val || val < 1) return;
    try {
      await api.patch(`/admin/groups/${id}/members/${mid}`, { payout_position: val });
      cancelEditPos(mid); load();
    } catch (e) { alert(formatErr(e?.response?.data?.detail)); }
  };

  const remove = (mid, name) => { setRemoveTarget({ uid: mid, name }); setRemoveReason(""); };

  const confirmRemove = async () => {
    const qs = removeReason ? `?reason=${encodeURIComponent(removeReason)}` : "";
    await api.delete(`/admin/groups/${id}/members/${removeTarget.uid}${qs}`);
    setRemoveTarget(null); load();
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
      <main className="page-main">
        <Link to="/admin" className="text-sm" style={{color:"var(--muted)"}} data-testid="back-admin">← Back to admin</Link>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mt-2 mb-6 sm:mb-8">
          <div className="min-w-0">
            <div className="label-eyebrow">{group.frequency} · {group.total_cycles} cycles</div>
            <h1 className="font-display text-2xl sm:text-4xl mt-1">{group.name}</h1>
            {group.description && <p className="text-sm mt-1" style={{color:"var(--muted)"}}>{group.description}</p>}
          </div>
          <div className="card-tactile p-4 sm:p-5 flex sm:flex-col gap-4 sm:gap-0 sm:min-w-[200px] items-center sm:items-start shrink-0">
            <div>
              <div className="label-eyebrow">Contribution</div>
              <div className="font-display text-2xl sm:text-3xl mt-0.5">{fmtMoney(group.contribution_amount)}</div>
            </div>
            <div>
              <div className="text-xs" style={{color:"var(--muted)"}}>{members.length}/{group.member_limit} members</div>
              {group.whatsapp_invite_link && (
                <a href={group.whatsapp_invite_link} target="_blank" rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded"
                  style={{background:"#25D36615", color:"#128C7E", border:"1px solid #25D36630"}}>
                  <ExternalLink size={11}/> WhatsApp
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-1 border-b mb-6 overflow-x-auto scrollbar-none" style={{borderColor:"var(--border)"}}>
          {["members","messages","invitations","ledger","payouts","comments","settings"].map(k => (
            <button key={k} onClick={()=>setTab(k)}
              className={`px-4 py-2.5 text-sm border-b-2 -mb-px capitalize whitespace-nowrap shrink-0 ${tab===k?"font-semibold":"opacity-60"}`}
              style={{borderColor: tab===k?"var(--primary)":"transparent", color: tab===k?"var(--primary)":"var(--text)"}}
              data-testid={`gtab-${k}`}>{k}</button>
          ))}
        </div>

        {tab === "messages" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg">Member messages ({messages.length})</h3>
              <button onClick={loadMessages} className="text-xs" style={{color:"var(--muted)"}}>Refresh</button>
            </div>
            {messages.length === 0 && (
              <div className="card-tactile p-8 text-center text-sm" style={{color:"var(--muted)"}}>No messages yet.</div>
            )}
            {messages.map(m => (
              <div key={m.id} className={`card-tactile p-4 ${!m.read ? "border-l-4" : ""}`}
                style={!m.read ? {borderLeftColor:"var(--primary)"} : {}}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm">{m.subject}</div>
                    <div className="text-xs mt-0.5" style={{color:"var(--muted)"}}>
                      {m.from_user_name} · {m.from_user_email} · {fmtDate(m.created_at)}
                    </div>
                  </div>
                  {!m.read && (
                    <button onClick={async()=>{ await api.patch(`/admin/member-messages/${m.id}/read`); loadMessages(); }}
                      className="text-xs shrink-0 px-2 py-1 rounded" style={{background:"var(--surface)",color:"var(--primary)"}}>
                      Mark read
                    </button>
                  )}
                </div>
                <div className="mt-2 text-sm whitespace-pre-wrap leading-relaxed">{m.body}</div>
              </div>
            ))}
          </div>
        )}

        {tab === "members" && (
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 card-tactile overflow-hidden" data-testid="group-members-table">
              {/* Mobile member cards */}
              <div className="mobile-list-card divide-y" style={{borderColor:"var(--border)"}}>
                {[...members].sort((a,b)=>a.payout_position-b.payout_position).map(m => {
                  const u = userMap[m.user_id];
                  const hasBank = u?.bank_name && u?.bank_account_number;
                  return (
                    <div key={m.id} className="p-4">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="min-w-0">
                          <div className="font-semibold text-sm truncate">{m.user_name}</div>
                          <div className="text-xs truncate" style={{color:"var(--muted)"}}>{m.user_email}</div>
                        </div>
                        {editingPos[m.id] !== undefined ? (
                          <div className="flex items-center gap-1 shrink-0">
                            <input type="number" min={1} value={editingPos[m.id]}
                              onChange={e=>setEditingPos(p=>({...p,[m.id]:e.target.value}))}
                              onKeyDown={e=>{ if(e.key==="Enter") savePosition(m.id); if(e.key==="Escape") cancelEditPos(m.id); }}
                              className="w-14 border rounded px-1.5 py-1 text-sm text-center font-display" autoFocus />
                            <button onClick={()=>savePosition(m.id)} className="text-xs font-semibold px-1.5 py-1 rounded" style={{background:"var(--primary)",color:"#fff"}}>✓</button>
                            <button onClick={()=>cancelEditPos(m.id)} className="text-xs px-1.5 py-1 rounded" style={{background:"var(--surface)"}}>✕</button>
                          </div>
                        ) : (
                          <button onClick={()=>startEditPos(m.id, m.payout_position)}
                            className="badge s-Payout_Eligible shrink-0 inline-flex items-center gap-1 cursor-pointer group"
                            title="Click to edit payout position">
                            #{m.payout_position} <Pencil size={9} className="opacity-0 group-hover:opacity-60" />
                          </button>
                        )}
                      </div>
                      {hasBank ? (
                        <div className="text-xs mt-1.5 flex items-center gap-1" style={{color:"var(--muted)"}}>
                          <span>{u.bank_name} · {u.bank_account_number}</span>
                          <button onClick={()=>copyText(u.bank_account_number)} title="Copy" className="opacity-50 hover:opacity-100"><Copy size={10}/></button>
                        </div>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded mt-1.5 inline-block" style={{background:"#fee2e2", color:"#991b1b"}}>Bank not set</span>
                      )}
                      <div className="flex items-center justify-between mt-2">
                        <div className="text-xs" style={{color:"var(--muted)"}}>Joined {fmtDate(m.joined_at)}</div>
                        <button onClick={()=>remove(m.id, m.user_name)} className="text-xs text-red-700 inline-flex items-center gap-1" data-testid={`remove-${m.id}`}>
                          <Trash2 size={12}/> Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
                {members.length===0 && <div className="px-4 py-10 text-center text-sm" style={{color:"var(--muted)"}}>No members yet.</div>}
              </div>
              {/* Desktop table */}
              <table className="desktop-table w-full text-sm">
                <thead className="bg-white/50"><tr className="text-left">
                  <th className="px-4 py-3 label-eyebrow">#</th>
                  <th className="px-4 py-3 label-eyebrow">Member</th>
                  <th className="px-4 py-3 label-eyebrow">Email</th>
                  <th className="px-4 py-3 label-eyebrow">Bank details</th>
                  <th className="px-4 py-3 label-eyebrow">Joined</th>
                  <th className="px-4 py-3 label-eyebrow"></th>
                </tr></thead>
                <tbody>
                  {[...members].sort((a,b)=>a.payout_position-b.payout_position).map(m => {
                    const u = userMap[m.user_id];
                    const hasBank = u?.bank_name && u?.bank_account_number;
                    return (
                    <tr key={m.id} className="border-t" style={{borderColor:"var(--border)"}}>
                      <td className="px-4 py-3">
                        {editingPos[m.id] !== undefined ? (
                          <div className="flex items-center gap-1">
                            <input type="number" min={1} value={editingPos[m.id]}
                              onChange={e=>setEditingPos(p=>({...p,[m.id]:e.target.value}))}
                              onKeyDown={e=>{ if(e.key==="Enter") savePosition(m.id); if(e.key==="Escape") cancelEditPos(m.id); }}
                              className="w-16 border rounded px-2 py-1 text-sm text-center font-display" autoFocus />
                            <button onClick={()=>savePosition(m.id)} className="text-xs font-semibold px-1.5 py-1 rounded" style={{background:"var(--primary)",color:"#fff"}} title="Save">✓</button>
                            <button onClick={()=>cancelEditPos(m.id)} className="text-xs px-1.5 py-1 rounded" style={{background:"var(--surface)"}} title="Cancel">✕</button>
                          </div>
                        ) : (
                          <button onClick={()=>startEditPos(m.id, m.payout_position)}
                            className="font-display inline-flex items-center gap-1 group opacity-90 hover:opacity-100"
                            title="Click to edit payout position">
                            #{m.payout_position} <Pencil size={10} className="opacity-0 group-hover:opacity-60" />
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium">{m.user_name}</td>
                      <td className="px-4 py-3 text-xs" style={{color:"var(--muted)"}}>{m.user_email}</td>
                      <td className="px-4 py-3">
                        {hasBank ? (
                          <div className="text-xs">
                            <div className="font-semibold">{u.bank_name}</div>
                            <div className="flex items-center gap-1" style={{color:"var(--muted)"}}>
                              <span>{u.bank_account_number}</span>
                              <button onClick={()=>copyText(u.bank_account_number)} title="Copy" className="opacity-50 hover:opacity-100"><Copy size={10}/></button>
                            </div>
                            <div style={{color:"var(--muted)"}}>{u.bank_account_name}</div>
                          </div>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded" style={{background:"#fee2e2", color:"#991b1b"}}>Not set</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{color:"var(--muted)"}}>{fmtDate(m.joined_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={()=>remove(m.id, m.user_name)} className="text-xs text-red-700 inline-flex items-center gap-1" data-testid={`remove-${m.id}`}>
                          <Trash2 size={12}/> Remove
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                  {members.length===0 && <tr><td colSpan={6} className="px-4 py-10 text-center" style={{color:"var(--muted)"}}>No members yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <form onSubmit={addMember} className="card-tactile p-4 sm:p-5" data-testid="add-member-form">
              <h3 className="font-display text-lg mb-3 flex items-center gap-2"><UserPlus size={16}/> Add member</h3>
              {multiSlots && (
                <div className="mb-3 px-3 py-2 rounded text-xs" style={{background:"#eff6ff",color:"#1d4ed8"}}>
                  Multiple slots enabled — you can add the same person twice with different positions.
                </div>
              )}
              <div className="mb-3">
                <label className="form-label">Member</label>
                <select required value={addEmail} onChange={e=>setAddEmail(e.target.value)} className="form-input" data-testid="add-email">
                  <option value="">— Select existing user —</option>
                  {availableUsers.map(u => <option key={u.id} value={u.email}>{u.name} · {u.email}{memberIds.has(u.id) ? " (already in group)" : ""}</option>)}
                </select>
              </div>
              <div className="mb-3">
                <label className="form-label">Payout position{multiSlots ? " (required for extra slots)" : " (optional)"}</label>
                <input type="number" value={addPos} onChange={e=>setAddPos(e.target.value)} className="form-input" data-testid="add-position"/>
              </div>
              {err && <div className="px-3 py-2 rounded-lg text-sm text-red-700 mb-3" style={{background:"#fef2f2"}} data-testid="add-error">{err}</div>}
              <button className="btn-primary text-sm w-full" data-testid="add-submit">Add to group</button>
              <p className="text-xs mt-3" style={{color:"var(--muted)"}}>Only existing platform users. New members should use the Invitations tab.</p>
            </form>
          </div>
        )}

        {tab === "invitations" && (
          <div className="space-y-6">
            {/* ── Shareable group join link ── */}
            <div className="card-tactile p-4 sm:p-6">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h3 className="font-display text-lg flex items-center gap-2"><Link2 size={16}/> Shareable group link</h3>
                  <p className="text-xs mt-1" style={{color:"var(--muted)"}}>
                    Share this link with anyone — they sign up with their own email and join directly. No email required from you.
                  </p>
                </div>
              </div>
              {joinLinkLoading && (
                <div className="text-sm" style={{color:"var(--muted)"}}>Loading link…</div>
              )}
              {!joinLinkLoading && joinLinkErr && (
                <div className="space-y-2">
                  <div className="px-3 py-2.5 rounded-lg text-sm" style={{background:"#fef2f2",color:"#b91c1c"}}>{joinLinkErr}</div>
                  <button onClick={loadJoinLink} className="btn-secondary text-sm inline-flex items-center gap-1.5">
                    <RefreshCw size={13}/> Retry
                  </button>
                </div>
              )}
              {!joinLinkLoading && !joinLinkErr && joinToken && (
                <>
                  <div className="flex gap-2">
                    <div className="flex-1 px-3 py-2.5 rounded-lg border text-sm font-mono truncate"
                      style={{background:"var(--surface)",borderColor:"var(--border)",color:"var(--text)"}}>
                      {`${window.location.origin}/join/${joinToken}`}
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(`${window.location.origin}/join/${joinToken}`);
                        setJoinCopied(true);
                        setTimeout(()=>setJoinCopied(false), 2000);
                      }}
                      className="px-4 py-2.5 rounded-lg border text-sm font-medium inline-flex items-center gap-1.5 shrink-0 transition-colors"
                      style={joinCopied
                        ? {background:"#f0fdf4",color:"#16a34a",borderColor:"#86efac"}
                        : {borderColor:"var(--border)",color:"var(--primary)"}}>
                      {joinCopied ? <><Check size={14}/> Copied!</> : <><Copy size={14}/> Copy link</>}
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <a href={`${window.location.origin}/join/${joinToken}`} target="_blank" rel="noreferrer"
                      className="text-xs inline-flex items-center gap-1" style={{color:"var(--primary)"}}>
                      <ExternalLink size={12}/> Preview join page
                    </a>
                    <button
                      disabled={joinRegen}
                      onClick={async () => {
                        if (!window.confirm("Regenerate the link? The old link will stop working.")) return;
                        setJoinRegen(true);
                        try {
                          const r = await api.post(`/admin/groups/${id}/regenerate-join-link`);
                          setJoinToken(r.data.join_token);
                        } finally { setJoinRegen(false); }
                      }}
                      className="text-xs inline-flex items-center gap-1" style={{color:"var(--muted)"}}>
                      <RefreshCw size={11}/> {joinRegen ? "Regenerating…" : "Regenerate link"}
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* ── Personal email invitations (optional, for tracking) ── */}
            <InvitationsPanel groupId={id} />
          </div>
        )}

        {tab === "comments" && (
          <div className="space-y-6">
            <BroadcastBox groupId={id} />
            <Comments groupId={id} />
          </div>
        )}

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
          <div className="card-tactile overflow-hidden" data-testid="payouts-table">
            {/* Mobile payout cards */}
            <div className="mobile-list-card divide-y" style={{borderColor:"var(--border)"}}>
              {cycles.map(c => {
                const recipient = members.find(m=>m.user_id===c.payout_user_id);
                const recUser = userMap[c.payout_user_id];
                const bankStr = recUser?.bank_account_number
                  ? `${recUser.bank_name} — ${recUser.bank_account_number} (${recUser.bank_account_name})`
                  : null;
                return (
                  <div key={c.id} className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div>
                        <div className="font-semibold text-sm">Cycle #{c.cycle_no}</div>
                        <div className="text-xs mt-0.5" style={{color:"var(--muted)"}}>{fmtDate(c.due_date)}</div>
                      </div>
                      <span className={`badge shrink-0 ${c.payout_status==="completed"?"s-Payout_Completed":"s-Payout_Eligible"}`}>{c.payout_status}</span>
                    </div>
                    {recipient && <div className="text-sm font-medium">{recipient.user_name}</div>}
                    {bankStr ? (
                      <div className="flex items-center gap-1 mt-1 text-xs" style={{color:"var(--muted)"}}>
                        <span className="truncate">{recUser.bank_name} · {recUser.bank_account_number}</span>
                        <button onClick={()=>copyText(bankStr)} title="Copy" className="opacity-50 shrink-0"><Copy size={10}/></button>
                      </div>
                    ) : <div className="text-xs mt-1" style={{color:"var(--muted)"}}>No bank on file</div>}
                    {c.payout_status !== "completed" && c.payout_user_id && (
                      <button onClick={()=>confirmPayout(c.cycle_no)} className="btn-primary w-full !py-2.5 text-sm inline-flex items-center justify-center gap-1 mt-3" data-testid={`payout-${c.cycle_no}`}>
                        <Check size={14}/> Confirm payout
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Desktop table */}
            <table className="desktop-table w-full text-sm">
              <thead className="bg-white/50"><tr className="text-left">
                <th className="px-4 py-3 label-eyebrow">Cycle</th>
                <th className="px-4 py-3 label-eyebrow">Due date</th>
                <th className="px-4 py-3 label-eyebrow">Recipient</th>
                <th className="px-4 py-3 label-eyebrow">Recipient bank</th>
                <th className="px-4 py-3 label-eyebrow">Status</th>
                <th className="px-4 py-3 label-eyebrow"></th>
              </tr></thead>
              <tbody>
                {cycles.map(c => {
                  const recipient = members.find(m=>m.user_id===c.payout_user_id);
                  const recUser = userMap[c.payout_user_id];
                  const bankStr = recUser?.bank_account_number
                    ? `${recUser.bank_name} — ${recUser.bank_account_number} (${recUser.bank_account_name})`
                    : null;
                  return (
                    <tr key={c.id} className="border-t" style={{borderColor:"var(--border)"}}>
                      <td className="px-4 py-3 font-display">#{c.cycle_no}</td>
                      <td className="px-4 py-3">{fmtDate(c.due_date)}</td>
                      <td className="px-4 py-3 font-medium">{recipient?.user_name || <span style={{color:"var(--muted)"}}>—</span>}</td>
                      <td className="px-4 py-3">
                        {bankStr ? (
                          <div className="flex items-center gap-1">
                            <div className="text-xs">
                              <div className="font-semibold">{recUser.bank_name}</div>
                              <div style={{color:"var(--muted)"}}>{recUser.bank_account_number} · {recUser.bank_account_name}</div>
                            </div>
                            <button onClick={()=>copyText(bankStr)} title="Copy bank details" className="opacity-40 hover:opacity-100 shrink-0"><Copy size={11}/></button>
                          </div>
                        ) : <span className="text-xs" style={{color:"var(--muted)"}}>—</span>}
                      </td>
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

        {tab === "settings" && editData && (
          <div className="grid md:grid-cols-2 gap-4 sm:gap-6">
            <div className="card-tactile p-4 sm:p-6 space-y-4">
              <h3 className="font-display text-lg flex items-center gap-2"><Pencil size={15}/> Basic details</h3>
              <div>
                <label className="form-label">Group name</label>
                <input value={editData.name||""} onChange={e=>setField("name",e.target.value)} className="form-input"/>
              </div>
              <div>
                <label className="form-label">Description</label>
                <textarea rows={2} value={editData.description||""} onChange={e=>setField("description",e.target.value)} className="form-input"/>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Contribution (₦)</label>
                  <input type="number" value={editData.contribution_amount||""} onChange={e=>setField("contribution_amount",Number(e.target.value))} className="form-input"/>
                </div>
                <div>
                  <label className="form-label">Member limit</label>
                  <input type="number" value={editData.member_limit||""} onChange={e=>setField("member_limit",Number(e.target.value))} className="form-input"/>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Total cycles</label>
                  <input type="number" min={1} value={editData.total_cycles||""} onChange={e=>setField("total_cycles",Number(e.target.value))} className="form-input"/>
                  <p className="text-xs mt-1" style={{color:"var(--muted)"}}>
                    Reducing removes future (unpaid) cycles. Increasing adds new ones automatically.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Frequency</label>
                  <select value={editData.frequency||"monthly"} onChange={e=>setField("frequency",e.target.value)} className="form-input">
                    <option value="monthly">Monthly</option>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Bi-weekly</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Status</label>
                  <select value={editData.status||"active"} onChange={e=>setField("status",e.target.value)} className="form-input">
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Due day</label>
                  <input type="number" min={1} max={31} value={editData.due_day||1} onChange={e=>setField("due_day",Number(e.target.value))} className="form-input"/>
                </div>
                <div>
                  <label className="form-label">Due time</label>
                  <input type="time" value={editData.due_time||"23:59"} onChange={e=>setField("due_time",e.target.value)} className="form-input"/>
                </div>
              </div>
            </div>

            <div className="space-y-4 sm:space-y-6">
              <div className="card-tactile p-4 sm:p-6 space-y-4">
                <h3 className="font-display text-lg">Fees &amp; rules</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label">First-payment fee (₦)</label>
                    <input type="number" value={editData.first_payment_fee||0} onChange={e=>setField("first_payment_fee",Number(e.target.value))} className="form-input"/>
                  </div>
                  <div>
                    <label className="form-label">Late fee (₦)</label>
                    <input type="number" value={editData.late_fee_amount||0} onChange={e=>setField("late_fee_amount",Number(e.target.value))} className="form-input"/>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label">Late fee method</label>
                    <select value={editData.late_fee_method||"fixed"} onChange={e=>setField("late_fee_method",e.target.value)} className="form-input">
                      <option value="fixed">Fixed</option>
                      <option value="percent">Percent</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Grace period (days)</label>
                    <input type="number" min={0} value={editData.grace_period_days||0} onChange={e=>setField("grace_period_days",Number(e.target.value))} className="form-input"/>
                  </div>
                </div>
                <div>
                  <label className="form-label">Rules text</label>
                  <textarea rows={3} value={editData.rules_text||""} onChange={e=>setField("rules_text",e.target.value)} className="form-input"/>
                </div>
                <div>
                  <label className="form-label">Payment account details</label>
                  <input value={editData.payment_account_details||""} onChange={e=>setField("payment_account_details",e.target.value)} className="form-input"/>
                </div>
                <label className="flex items-center gap-2.5 cursor-pointer py-1">
                  <input type="checkbox" id="enable_comments" checked={!!editData.enable_comments} onChange={e=>setField("enable_comments",e.target.checked)} className="w-5 h-5"/>
                  <span className="text-sm">Enable member comments</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer py-1">
                  <input type="checkbox" id="allow_multiple_slots" checked={!!editData.allow_multiple_slots} onChange={e=>setField("allow_multiple_slots",e.target.checked)} className="w-5 h-5"/>
                  <span className="text-sm">Allow multiple slots per member <span className="font-normal text-xs" style={{color:"var(--muted)"}}>— lets the same person hold more than one payout position</span></span>
                </label>
              </div>

              <div className="card-tactile p-4 sm:p-6 space-y-4">
                <h3 className="font-display text-lg">WhatsApp</h3>
                <div>
                  <label className="form-label">Invite link</label>
                  <input value={editData.whatsapp_invite_link||""} onChange={e=>setField("whatsapp_invite_link",e.target.value)} className="form-input" placeholder="https://chat.whatsapp.com/..."/>
                </div>
                <div>
                  <label className="form-label">WhatsApp group name</label>
                  <input value={editData.whatsapp_group_name||""} onChange={e=>setField("whatsapp_group_name",e.target.value)} className="form-input"/>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <button onClick={saveGroup} disabled={saving} className="btn-primary w-full sm:w-auto flex items-center justify-center gap-2">
                  <Save size={15}/>{saving ? "Saving…" : "Save changes"}
                </button>
                {saveMsg && <span className="text-sm" style={{color: saveMsg==="Saved!" ? "var(--primary)" : "#b91c1c"}}>{saveMsg}</span>}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Remove member confirmation modal */}
      {removeTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
          <div className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-xl p-5 sm:p-6">
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4 sm:hidden" />
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display text-lg">Remove member</h3>
              <button onClick={()=>setRemoveTarget(null)} className="p-1 opacity-60 hover:opacity-100"><X size={18}/></button>
            </div>
            <p className="text-sm mb-4" style={{color:"var(--muted)"}}>
              Remove <b>{removeTarget.name}</b> from this group? This cannot be undone.
            </p>
            <div className="mb-4">
              <label className="form-label">Reason <span className="font-normal">(optional — logged in audit trail)</span></label>
              <input value={removeReason} onChange={e=>setRemoveReason(e.target.value)}
                className="form-input" placeholder="e.g. Missed payments, violated group terms" />
            </div>
            <div className="flex gap-3">
              <button onClick={()=>setRemoveTarget(null)} className="btn-secondary flex-1 text-sm">Cancel</button>
              <button onClick={confirmRemove} className="flex-1 text-sm px-4 py-2.5 rounded-lg font-semibold text-white" style={{background:"#dc2626"}}>
                Remove member
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
