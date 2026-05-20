import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api, { fmtMoney, fmtDate, formatErr } from "../api";
import TopNav from "../components/TopNav";
import StatusBadge from "../components/StatusBadge";
import Comments from "../components/Comments";
import { useAuth } from "../AuthContext";
import { Upload, MessageCircle, X, AlertTriangle, CalendarClock, Landmark, ArrowRight, Star, CheckCircle2, Gift } from "lucide-react";

export default function GroupDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  const [msgOpen, setMsgOpen] = useState(false);
  const [msgSubject, setMsgSubject] = useState("");
  const [msgBody, setMsgBody] = useState("");
  const [msgBusy, setMsgBusy] = useState(false);
  const [msgDone, setMsgDone] = useState(false);

  const sendMsgToAdmin = async (e) => {
    e.preventDefault(); setMsgBusy(true);
    try {
      await api.post(`/groups/${id}/message-admin`, { subject: msgSubject, body: msgBody });
      setMsgDone(true); setMsgSubject(""); setMsgBody("");
      setTimeout(() => { setMsgOpen(false); setMsgDone(false); }, 1800);
    } catch (err) { alert(formatErr(err?.response?.data?.detail)); }
    finally { setMsgBusy(false); }
  };

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadCycle, setUploadCycle] = useState(null);
  const [uploadAmount, setUploadAmount] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadNote, setUploadNote] = useState("");
  const [uploading, setUploading] = useState(false);

  const load = () => api.get(`/groups/${id}/detail`).then(r=>setData(r.data)).catch(e=>setErr(formatErr(e?.response?.data?.detail)));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <div className="min-h-screen bg-app"><TopNav /><div className="max-w-3xl mx-auto p-10 text-red-700">{err}</div></div>;
  if (!data) return <div className="min-h-screen bg-app"><TopNav /><div className="max-w-3xl mx-auto p-10">Loading...</div></div>;

  const { group, cycles, statuses, members } = data;
  const isAdmin = user.role === "admin" || user.role === "super_admin";

  // ── Member-specific derived data ──
  const myStatuses = statuses.filter(s => s.user_id === user.id);
  const statusByCycle = Object.fromEntries(myStatuses.map(s => [s.cycle_no, s]));
  const mySlots = members.filter(m => m.user_id === user.id).sort((a,b) => a.payout_position - b.payout_position);
  const mySlotPositions = new Set(mySlots.map(s => s.payout_position));
  const myPayoutCycles = cycles.filter(c => c.payout_user_id === user.id && mySlotPositions.has(c.cycle_no));
  // Per-cycle obligation = contribution × my slot count (backend keeps this in status.expected_amount)
  const myMonthlyDue = group.contribution_amount * (mySlots.length || 1);
  // What I receive per payout = contribution × total slots in group
  const myPayoutAmount = group.contribution_amount * members.length;
  // Next actionable cycle
  const today = new Date();
  const nextDue = cycles
    .filter(c => { const s = statusByCycle[c.cycle_no]; return s && (s.status === "Due" || s.status === "Not_Due" || s.status === "Overdue"); })
    .filter(c => new Date(c.due_date) >= today)
    .sort((a,b) => new Date(a.due_date) - new Date(b.due_date))[0] || null;
  const nextDueAmount = nextDue
    ? (statusByCycle[nextDue.cycle_no]?.expected_amount ?? myMonthlyDue)
    : 0;
  const bankSet = !!(user.bank_name && user.bank_account_number && user.bank_account_name);

  // ── Grouped members (by user) for member-friendly list ──
  const membersByUser = Object.values(
    members.reduce((acc, m) => {
      if (!acc[m.user_id]) {
        acc[m.user_id] = { ...m, slots: [] };
      }
      acc[m.user_id].slots.push(m.payout_position);
      return acc;
    }, {})
  ).sort((a,b) => Math.min(...a.slots) - Math.min(...b.slots));

  const fileToDataUrl = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });

  const submitUpload = async (e) => {
    e.preventDefault();
    if (!uploadFile) return;
    setUploading(true);
    try {
      const dataUrl = await fileToDataUrl(uploadFile);
      await api.post("/payments/upload", {
        group_id: id, cycle_no: uploadCycle,
        amount: Number(uploadAmount), receipt_data_url: dataUrl, note: uploadNote,
      });
      setUploadOpen(false); setUploadFile(null); setUploadAmount(""); setUploadNote("");
      load();
    } catch (e) { alert(formatErr(e?.response?.data?.detail)); }
    finally { setUploading(false); }
  };

  const openUpload = (c) => {
    setUploadCycle(c.cycle_no);
    // personal amount from status record; fallback to myMonthlyDue
    setUploadAmount(String(statusByCycle[c.cycle_no]?.expected_amount ?? myMonthlyDue));
    setUploadOpen(true);
  };

  // ── Status label helper — plain English ──
  const statusLabel = (s) => {
    if (!s) return null;
    const map = { Due: "Pay now", Not_Due: "Coming up", Overdue: "Overdue!", Paid: "Submitted", Approved: "Paid ✓", Rejected: "Rejected" };
    return map[s.status] || s.status;
  };
  const statusColor = (s) => {
    if (!s) return "var(--muted)";
    const map = { Due: "#d97706", Not_Due: "var(--muted)", Overdue: "#dc2626", Paid: "#2563eb", Approved: "#16a34a", Rejected: "#dc2626" };
    return map[s.status] || "var(--muted)";
  };
  const statusBg = (s) => {
    if (!s) return "transparent";
    const map = { Due: "#fef3c7", Not_Due: "transparent", Overdue: "#fee2e2", Paid: "#eff6ff", Approved: "#f0fdf4", Rejected: "#fee2e2" };
    return map[s.status] || "transparent";
  };

  return (
    <div className="min-h-screen bg-app">
      <TopNav />
      <main className="page-main">
        <button onClick={()=>nav(-1)} className="text-sm mb-4 inline-flex items-center gap-1" style={{color:"var(--muted)"}} data-testid="back-btn">← Back</button>

        {/* Bank warning */}
        {!isAdmin && !bankSet && (
          <div className="mb-4 sm:mb-6 px-4 py-3 rounded-xl flex items-start gap-3" style={{background:"#fef3c7",border:"1px solid #fcd34d"}}>
            <AlertTriangle size={18} className="shrink-0 mt-0.5" style={{color:"#92400e"}}/>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm" style={{color:"#92400e"}}>Add your bank details</div>
              <div className="text-xs mt-0.5" style={{color:"#78350f"}}>Your bank account isn't set — the admin can't pay you out without it.</div>
            </div>
            <a href="/profile" className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg inline-flex items-center gap-1" style={{background:"#92400e",color:"#fff"}}>
              Add now <ArrowRight size={11}/>
            </a>
          </div>
        )}

        {/* Group header */}
        <div className="mb-6 sm:mb-8">
          <div className="label-eyebrow">{group.frequency} · {group.total_cycles} months</div>
          <h1 className="font-display text-2xl sm:text-4xl mt-1">{group.name}</h1>
          {group.description && <p className="text-sm mt-2" style={{color:"var(--muted)"}}>{group.description}</p>}
        </div>

        {/* ── My Summary (members only) ── */}
        {!isAdmin && mySlots.length > 0 && (
          <div className="card-tactile p-4 sm:p-5 mb-4 sm:mb-6">
            <div className="label-eyebrow mb-3 flex items-center gap-1.5"><Star size={12}/> My Ajo summary</div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs" style={{color:"var(--muted)"}}>I pay every month</div>
                <div className="font-display text-2xl mt-0.5">{fmtMoney(myMonthlyDue)}</div>
                {mySlots.length > 1 && (
                  <div className="text-xs mt-0.5" style={{color:"var(--muted)"}}>{mySlots.length} slots × {fmtMoney(group.contribution_amount)}</div>
                )}
              </div>
              <div>
                <div className="text-xs" style={{color:"var(--muted)"}}>I receive when it's my turn</div>
                <div className="font-display text-2xl mt-0.5" style={{color:"var(--primary)"}}>{fmtMoney(myPayoutAmount)}</div>
                <div className="text-xs mt-0.5" style={{color:"var(--muted)"}}>{members.length} members × {fmtMoney(group.contribution_amount)}</div>
              </div>
              <div>
                <div className="text-xs" style={{color:"var(--muted)"}}>My payout {myPayoutCycles.length > 1 ? "months" : "month"}</div>
                {myPayoutCycles.length > 0 ? (
                  <div className="mt-1 flex flex-col gap-1">
                    {myPayoutCycles.map(c => (
                      <div key={c.cycle_no} className="inline-flex items-center gap-1.5 text-sm font-semibold px-2.5 py-1 rounded-lg w-fit" style={{background:"var(--primary)15",color:"var(--primary)"}}>
                        <Gift size={12}/> {fmtDate(c.due_date)} (Month {c.cycle_no})
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm mt-1" style={{color:"var(--muted)"}}>Not assigned yet</div>
                )}
              </div>
              <div>
                <div className="text-xs" style={{color:"var(--muted)"}}>My slot{mySlots.length > 1 ? "s" : ""}</div>
                <div className="flex gap-1.5 mt-1 flex-wrap">
                  {mySlots.map(s => (
                    <span key={s.payout_position} className="badge s-Payout_Eligible">#{s.payout_position}</span>
                  ))}
                </div>
                <div className="mt-2 text-xs" style={{color:"var(--muted)"}}>Bank for payout</div>
                {bankSet ? (
                  <div className="text-sm mt-0.5 font-medium flex items-center gap-1" style={{color:"#16a34a"}}>
                    <CheckCircle2 size={13}/> {user.bank_name}
                    <a href="/profile" className="text-xs ml-1 underline" style={{color:"var(--muted)"}}>(edit)</a>
                  </div>
                ) : (
                  <a href="/profile" className="mt-0.5 text-xs font-semibold inline-flex items-center gap-1" style={{color:"#92400e"}}>
                    <ArrowRight size={11}/> Add bank details
                  </a>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Next payment action strip */}
        {!isAdmin && nextDue && (
          <div className="mb-4 sm:mb-6 px-4 py-3 rounded-xl flex items-center gap-3"
            style={{background: statusBg(statusByCycle[nextDue.cycle_no]), border:"1px solid var(--border)"}}>
            <CalendarClock size={18} className="shrink-0" style={{color:"var(--primary)"}}/>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">
                {statusByCycle[nextDue.cycle_no]?.status === "Overdue" ? "⚠️ Overdue payment" : "Next payment due"}
              </div>
              <div className="text-sm mt-0.5">
                Month {nextDue.cycle_no} · {fmtDate(nextDue.due_date)} · <strong>{fmtMoney(nextDueAmount)}</strong>
              </div>
              {mySlots.length > 1 && (
                <div className="text-xs mt-0.5" style={{color:"var(--muted)"}}>{mySlots.length} slots × {fmtMoney(group.contribution_amount)}</div>
              )}
            </div>
            <button onClick={()=>openUpload(nextDue)} className="shrink-0 btn-primary !py-1.5 !px-3 text-xs inline-flex items-center gap-1">
              <Upload size={11}/> Pay now
            </button>
          </div>
        )}

        {group.rules_text && (
          <div className="card-tactile p-4 sm:p-5 mb-4 sm:mb-6" data-testid="rules-card">
            <div className="label-eyebrow mb-2">Group rules</div>
            <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{group.rules_text}</pre>
          </div>
        )}

        {group.payment_account_details && (
          <div className="card-tactile p-4 sm:p-5 mb-4 sm:mb-6">
            <div className="label-eyebrow mb-1">Where to pay</div>
            <pre className="text-sm whitespace-pre-wrap font-sans">{group.payment_account_details}</pre>
          </div>
        )}

        {group.whatsapp_invite_link && (
          <div className="card-tactile p-4 sm:p-5 mb-4 sm:mb-6 flex items-center justify-between gap-4" data-testid="whatsapp-card">
            <div className="min-w-0">
              <div className="label-eyebrow mb-1">Group chat</div>
              <div className="font-display text-base sm:text-lg">{group.whatsapp_group_name || "WhatsApp Group"}</div>
            </div>
            <a href={group.whatsapp_invite_link} target="_blank" rel="noreferrer"
              className="btn-primary text-sm shrink-0 !py-2.5 !px-4" data-testid="whatsapp-join">Join</a>
          </div>
        )}

        {/* ── Monthly payment schedule ── */}
        <section className="mb-8 sm:mb-10">
          <h2 className="font-display text-xl sm:text-2xl mb-3 sm:mb-4">
            {isAdmin ? "Cycles & payout status" : "My monthly payments"}
          </h2>
          <div className="card-tactile overflow-hidden" data-testid="cycles-table">
            {/* MEMBER VIEW — friendly card list */}
            {!isAdmin && (
              <div className="divide-y" style={{borderColor:"var(--border)"}}>
                {cycles.map(c => {
                  const s = statusByCycle[c.cycle_no];
                  const isMyPayout = c.payout_user_id === user.id && mySlotPositions.has(c.cycle_no);
                  const canUpload = s && (s.status === "Due" || s.status === "Rejected" || s.status === "Not_Due" || s.status === "Overdue");
                  // Member's personal amount for this cycle
                  const myAmount = s?.expected_amount ?? myMonthlyDue;
                  return (
                    <div key={c.id} className="p-4"
                      style={isMyPayout
                        ? {background:"#f0fdf4", borderLeft:"3px solid #16a34a"}
                        : s?.status === "Overdue" ? {background:"#fff7f7"} : {}}>
                      {isMyPayout && (
                        <div className="flex items-center gap-1.5 text-xs font-bold mb-2" style={{color:"#16a34a"}}>
                          <Gift size={12}/> This is your payout month!
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold text-sm">Month {c.cycle_no} — {fmtDate(c.due_date)}</div>
                          {s && (
                            <div className="text-xs mt-0.5" style={{color:"var(--muted)"}}>
                              You owe: <strong>{fmtMoney(myAmount)}</strong>
                              {mySlots.length > 1 && ` (${mySlots.length} slots × ${fmtMoney(group.contribution_amount)})`}
                            </div>
                          )}
                          {isMyPayout && (
                            <div className="text-xs mt-0.5" style={{color:"#16a34a"}}>
                              You'll receive: {fmtMoney(myPayoutAmount)}
                            </div>
                          )}
                        </div>
                        <div className="shrink-0 flex flex-col items-end gap-1.5">
                          {s ? (
                            <span className="text-xs font-semibold px-2 py-1 rounded-full"
                              style={{background: statusBg(s), color: statusColor(s), border:`1px solid ${statusColor(s)}30`}}>
                              {statusLabel(s)}
                            </span>
                          ) : (
                            <span className="text-xs" style={{color:"var(--muted)"}}>—</span>
                          )}
                        </div>
                      </div>
                      {canUpload && (
                        <button onClick={()=>openUpload(c)}
                          className="btn-primary w-full text-sm !py-2.5 inline-flex items-center justify-center gap-1.5 mt-3"
                          data-testid={`upload-cycle-${c.cycle_no}`}>
                          <Upload size={14}/> Upload payment proof for Month {c.cycle_no}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ADMIN VIEW — full table */}
            {isAdmin && (
              <table className="w-full text-sm">
                <thead className="bg-white/50">
                  <tr className="text-left">
                    <th className="px-4 py-3 label-eyebrow">Month</th>
                    <th className="px-4 py-3 label-eyebrow">Due date</th>
                    <th className="px-4 py-3 label-eyebrow">Payout to</th>
                    <th className="px-4 py-3 label-eyebrow">Payout status</th>
                  </tr>
                </thead>
                <tbody>
                  {cycles.map(c => (
                    <tr key={c.id} className="border-t" style={{borderColor:"var(--border)"}}>
                      <td className="px-4 py-3 font-display">#{c.cycle_no}</td>
                      <td className="px-4 py-3">{fmtDate(c.due_date)}</td>
                      <td className="px-4 py-3">{c.payout_user_name || <span style={{color:"var(--muted)"}}>—</span>}</td>
                      <td className="px-4 py-3">
                        <span className={`badge ${c.payout_status==="completed"?"s-Payout_Completed":"s-Payout_Eligible"}`}>{c.payout_status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* ── Members ── */}
        <section>
          <h2 className="font-display text-xl sm:text-2xl mb-3 sm:mb-4">
            Group members ({membersByUser.length} {membersByUser.length === 1 ? "member" : "members"}, {members.length} slots)
          </h2>
          <div className="card-tactile overflow-hidden">
            <div className="divide-y" style={{borderColor:"var(--border)"}}>
              {membersByUser.map(m => {
                const isMe = m.user_id === user.id;
                const payoutDates = m.slots.map(pos => {
                  const c = cycles.find(cy => cy.payout_user_id === m.user_id && cy.cycle_no === pos);
                  return c ? fmtDate(c.due_date) : null;
                }).filter(Boolean);
                return (
                  <div key={m.user_id} className="px-4 py-3 flex items-center justify-between gap-3"
                    style={isMe ? {background:"var(--primary)06"} : {}}>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate flex items-center gap-1.5">
                        {m.display_name || m.user_name}
                        {isMe && <span className="text-xs px-1.5 py-0.5 rounded" style={{background:"var(--primary)15",color:"var(--primary)"}}>You</span>}
                      </div>
                      {isAdmin && <div className="text-xs" style={{color:"var(--muted)"}}>{m.user_email}</div>}
                      {payoutDates.length > 0 && (
                        <div className="text-xs mt-0.5" style={{color:"var(--muted)"}}>
                          Payout{payoutDates.length > 1 ? "s" : ""}: {payoutDates.join(" & ")}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 flex-wrap justify-end shrink-0">
                      {m.slots.map(pos => (
                        <span key={pos} className="badge s-Payout_Eligible">#{pos}</span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {group.enable_comments !== false && (
          <section className="mt-8 sm:mt-10">
            <Comments groupId={id} />
          </section>
        )}

        {!isAdmin && (
          <button onClick={() => setMsgOpen(true)}
            className="fixed bottom-6 right-5 z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center"
            style={{background:"var(--primary)",color:"#fff"}} title="Message admin" data-testid="msg-admin-fab">
            <MessageCircle size={22}/>
          </button>
        )}
      </main>

      {/* Upload modal */}
      {uploadOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center" onClick={()=>setUploadOpen(false)}>
          <form onClick={e=>e.stopPropagation()} onSubmit={submitUpload}
            className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto"
            data-testid="upload-modal">
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4 sm:hidden" />
            <h3 className="font-display text-xl mb-1">Upload payment proof</h3>
            <p className="text-sm mb-4" style={{color:"var(--muted)"}}>Month {uploadCycle} — amount due: <strong>{fmtMoney(Number(uploadAmount))}</strong></p>
            <div className="space-y-4">
              <div>
                <label className="form-label">Amount paid (₦)</label>
                <input type="number" required value={uploadAmount} onChange={e=>setUploadAmount(e.target.value)} className="form-input" data-testid="upload-amount" />
              </div>
              <div>
                <label className="form-label">Receipt (photo or PDF)</label>
                <input type="file" accept="image/*,application/pdf" required onChange={e=>setUploadFile(e.target.files[0])} className="w-full text-sm" data-testid="upload-file" />
              </div>
              <div>
                <label className="form-label">Note (optional)</label>
                <textarea value={uploadNote} onChange={e=>setUploadNote(e.target.value)} className="form-input" rows={2} data-testid="upload-note" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button type="button" onClick={()=>setUploadOpen(false)} className="btn-secondary flex-1 text-sm" data-testid="upload-cancel">Cancel</button>
              <button type="submit" disabled={uploading} className="btn-primary flex-1 text-sm" data-testid="upload-submit">
                {uploading ? "Uploading…" : "Submit"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Message admin modal */}
      {msgOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center" onClick={()=>setMsgOpen(false)}>
          <div onClick={e=>e.stopPropagation()}
            className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto"
            data-testid="msg-admin-modal">
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4 sm:hidden" />
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-xl">Message admin</h3>
              <button onClick={()=>setMsgOpen(false)} className="p-1 rounded opacity-60 hover:opacity-100"><X size={18}/></button>
            </div>
            {msgDone ? (
              <div className="py-8 text-center">
                <div className="text-3xl mb-2">✓</div>
                <div className="font-medium">Message sent!</div>
                <div className="text-sm mt-1" style={{color:"var(--muted)"}}>The admin will see it in their dashboard.</div>
              </div>
            ) : (
              <form onSubmit={sendMsgToAdmin} className="space-y-4">
                <div>
                  <label className="form-label">Subject</label>
                  <input required value={msgSubject} onChange={e=>setMsgSubject(e.target.value)}
                    className="form-input" placeholder="e.g. Question about my payment" data-testid="msg-subject" />
                </div>
                <div>
                  <label className="form-label">Message</label>
                  <textarea required rows={4} value={msgBody} onChange={e=>setMsgBody(e.target.value)}
                    className="form-input" placeholder="Type your message here…" data-testid="msg-body" />
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={()=>setMsgOpen(false)} className="btn-secondary flex-1 text-sm">Cancel</button>
                  <button type="submit" disabled={msgBusy} className="btn-primary flex-1 text-sm" data-testid="msg-send">
                    {msgBusy ? "Sending…" : "Send message"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
