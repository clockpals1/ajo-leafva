import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api, { fmtMoney, fmtDate, formatErr } from "../api";
import TopNav from "../components/TopNav";
import StatusBadge from "../components/StatusBadge";
import Comments from "../components/Comments";
import { useAuth } from "../AuthContext";
import { Upload } from "lucide-react";

export default function GroupDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  // Upload modal state
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
  const myStatuses = statuses.filter(s => s.user_id === user.id);
  const statusByCycle = Object.fromEntries(myStatuses.map(s=>[s.cycle_no, s]));
  const isAdmin = user.role === "admin" || user.role === "super_admin";

  const fileToDataUrl = (f) => new Promise((res, rej) => { const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(f); });

  const submitUpload = async (e) => {
    e.preventDefault();
    if (!uploadFile) return;
    setUploading(true);
    try {
      const dataUrl = await fileToDataUrl(uploadFile);
      await api.post("/payments/upload", {
        group_id: id,
        cycle_no: uploadCycle,
        amount: Number(uploadAmount),
        receipt_data_url: dataUrl,
        note: uploadNote,
      });
      setUploadOpen(false); setUploadFile(null); setUploadAmount(""); setUploadNote("");
      load();
    } catch (e) {
      alert(formatErr(e?.response?.data?.detail));
    } finally { setUploading(false); }
  };

  const openUpload = (cycle) => {
    setUploadCycle(cycle.cycle_no);
    setUploadAmount(String(cycle.expected_amount));
    setUploadOpen(true);
  };

  return (
    <div className="min-h-screen bg-app">
      <TopNav />
      <main className="page-main">
        <button onClick={()=>nav(-1)} className="text-sm mb-4 inline-flex items-center gap-1" style={{color:"var(--muted)"}} data-testid="back-btn">← Back</button>

        {/* Header — stacks vertically on mobile */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6 sm:mb-8">
          <div className="min-w-0">
            <div className="label-eyebrow">{group.frequency} · {group.total_cycles} cycles</div>
            <h1 className="font-display text-2xl sm:text-4xl mt-1">{group.name}</h1>
            {group.description && <p className="text-sm mt-2" style={{color:"var(--muted)"}}>{group.description}</p>}
          </div>
          <div className="card-tactile p-4 sm:p-5 flex sm:flex-col gap-4 sm:gap-0 sm:min-w-[200px] items-center sm:items-start">
            <div>
              <div className="label-eyebrow">Contribution</div>
              <div className="font-display text-2xl sm:text-3xl mt-0.5">{fmtMoney(group.contribution_amount)}</div>
            </div>
            <div className="text-xs sm:mt-2" style={{color:"var(--muted)"}}>Due day {group.due_day} · {group.due_time}</div>
          </div>
        </div>

        {group.rules_text && (
          <div className="card-tactile p-4 sm:p-5 mb-4 sm:mb-6" data-testid="rules-card">
            <div className="label-eyebrow mb-2">Group rules</div>
            <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{group.rules_text}</pre>
          </div>
        )}

        {group.payment_account_details && (
          <div className="card-tactile p-4 sm:p-5 mb-4 sm:mb-6">
            <div className="label-eyebrow mb-1">Payment account details</div>
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
              className="btn-primary text-sm shrink-0 !py-2.5 !px-4" data-testid="whatsapp-join">
              Join
            </a>
          </div>
        )}

        <section className="mb-8 sm:mb-10">
          <h2 className="font-display text-xl sm:text-2xl mb-3 sm:mb-4">Cycles &amp; status</h2>
          <div className="card-tactile overflow-hidden">
            {/* Mobile cycle cards */}
            <div className="mobile-list-card divide-y" style={{borderColor:"var(--border)"}} data-testid="cycles-table">
              {cycles.map(c => {
                const s = statusByCycle[c.cycle_no];
                const canUpload = !isAdmin && s && (s.status === "Due" || s.status === "Rejected" || s.status === "Not_Due");
                return (
                  <div key={c.id} className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="font-semibold text-sm">Cycle #{c.cycle_no}</div>
                        <div className="text-xs mt-0.5" style={{color:"var(--muted)"}}>{fmtDate(c.due_date)} · {fmtMoney(c.expected_amount)}</div>
                        {c.payout_user_name && <div className="text-xs mt-0.5" style={{color:"var(--muted)"}}>Payout: {c.payout_user_name}</div>}
                      </div>
                      <div className="shrink-0">
                        {isAdmin
                          ? <span className={`badge ${c.payout_status==="completed"?"s-Payout_Completed":"s-Payout_Eligible"}`}>{c.payout_status}</span>
                          : s ? <StatusBadge status={s.status} /> : null}
                      </div>
                    </div>
                    {canUpload && (
                      <button onClick={()=>openUpload(c)} className="btn-primary w-full text-sm !py-2.5 inline-flex items-center justify-center gap-1.5 mt-1" data-testid={`upload-cycle-${c.cycle_no}`}>
                        <Upload size={14}/> Upload payment proof
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Desktop table */}
            <table className="desktop-table w-full text-sm">
              <thead className="bg-white/50">
                <tr className="text-left">
                  <th className="px-4 py-3 label-eyebrow">#</th>
                  <th className="px-4 py-3 label-eyebrow">Due date</th>
                  <th className="px-4 py-3 label-eyebrow text-right">Expected</th>
                  <th className="px-4 py-3 label-eyebrow">Payout to</th>
                  <th className="px-4 py-3 label-eyebrow">{isAdmin ? "Payout status" : "My status"}</th>
                  <th className="px-4 py-3 label-eyebrow text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {cycles.map(c => {
                  const s = statusByCycle[c.cycle_no];
                  const canUpload = !isAdmin && s && (s.status === "Due" || s.status === "Rejected" || s.status === "Not_Due");
                  return (
                    <tr key={c.id} className="border-t" style={{borderColor:"var(--border)"}}>
                      <td className="px-4 py-3 font-display">{c.cycle_no}</td>
                      <td className="px-4 py-3">{fmtDate(c.due_date)}</td>
                      <td className="px-4 py-3 text-right font-display">{fmtMoney(c.expected_amount)}</td>
                      <td className="px-4 py-3">{c.payout_user_name || <span style={{color:"var(--muted)"}}>—</span>}</td>
                      <td className="px-4 py-3">
                        {isAdmin ? (
                          <span className={`badge ${c.payout_status==="completed"?"s-Payout_Completed":"s-Payout_Eligible"}`}>{c.payout_status}</span>
                        ) : s ? <StatusBadge status={s.status} /> : <span style={{color:"var(--muted)"}}>—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canUpload && (
                          <button onClick={()=>openUpload(c)} className="btn-primary !py-1.5 !px-3 text-xs inline-flex items-center gap-1" data-testid={`upload-cycle-${c.cycle_no}`}>
                            <Upload size={12}/> Upload proof
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="font-display text-xl sm:text-2xl mb-3 sm:mb-4">Group members ({members.length})</h2>
          <div className="card-tactile overflow-hidden">
            {/* Mobile member cards */}
            <div className="mobile-list-card divide-y" style={{borderColor:"var(--border)"}}>
              {[...members].sort((a,b)=>a.payout_position-b.payout_position).map(m => (
                <div key={m.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{m.display_name || m.user_name}</div>
                    {isAdmin && <div className="text-xs truncate" style={{color:"var(--muted)"}}>{m.user_email}</div>}
                    <div className="text-xs mt-0.5" style={{color:"var(--muted)"}}>Joined {fmtDate(m.joined_at)}</div>
                  </div>
                  <span className="badge s-Payout_Eligible shrink-0">#{m.payout_position}</span>
                </div>
              ))}
            </div>
            {/* Desktop table */}
            <table className="desktop-table w-full text-sm">
              <thead className="bg-white/50">
                <tr className="text-left">
                  <th className="px-4 py-3 label-eyebrow">Position</th>
                  <th className="px-4 py-3 label-eyebrow">Member</th>
                  {isAdmin && <th className="px-4 py-3 label-eyebrow">Email</th>}
                  <th className="px-4 py-3 label-eyebrow">Joined</th>
                </tr>
              </thead>
              <tbody>
                {[...members].sort((a,b)=>a.payout_position-b.payout_position).map(m => (
                  <tr key={m.id} className="border-t" style={{borderColor:"var(--border)"}}>
                    <td className="px-4 py-3 font-display">#{m.payout_position}</td>
                    <td className="px-4 py-3">{m.display_name || m.user_name}</td>
                    {isAdmin && <td className="px-4 py-3" style={{color:"var(--muted)"}}>{m.user_email}</td>}
                    <td className="px-4 py-3" style={{color:"var(--muted)"}}>{fmtDate(m.joined_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {group.enable_comments !== false && (
          <section className="mt-8 sm:mt-10">
            <Comments groupId={id} />
          </section>
        )}
      </main>

      {/* Upload modal — full screen slide-up on mobile */}
      {uploadOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center" onClick={()=>setUploadOpen(false)}>
          <form onClick={e=>e.stopPropagation()} onSubmit={submitUpload}
            className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto"
            data-testid="upload-modal">
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4 sm:hidden" />
            <h3 className="font-display text-xl mb-4">Upload proof — Cycle #{uploadCycle}</h3>
            <div className="space-y-4">
              <div>
                <label className="form-label">Amount (₦)</label>
                <input type="number" required value={uploadAmount} onChange={e=>setUploadAmount(e.target.value)} className="form-input" data-testid="upload-amount" />
              </div>
              <div>
                <label className="form-label">Receipt (image or PDF)</label>
                <input type="file" accept="image/*,application/pdf" required onChange={e=>setUploadFile(e.target.files[0])}
                  className="w-full text-sm" data-testid="upload-file" />
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
    </div>
  );
}
