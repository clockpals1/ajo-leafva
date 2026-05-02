import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api, { fmtMoney, fmtDate, formatErr } from "../api";
import TopNav from "../components/TopNav";
import StatusBadge from "../components/StatusBadge";
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
  useEffect(() => { load(); }, [id]);

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
      <main className="max-w-7xl mx-auto px-6 py-10">
        <button onClick={()=>nav(-1)} className="text-sm mb-4" style={{color:"var(--muted)"}} data-testid="back-btn">← Back</button>
        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="label-eyebrow">{group.frequency} · {group.total_cycles} cycles</div>
            <h1 className="font-display text-4xl">{group.name}</h1>
            <p className="text-sm mt-2 max-w-2xl" style={{color:"var(--muted)"}}>{group.description}</p>
          </div>
          <div className="card-tactile p-5 min-w-[220px]">
            <div className="label-eyebrow">Contribution</div>
            <div className="font-display text-3xl mt-1">{fmtMoney(group.contribution_amount)}</div>
            <div className="text-xs mt-2" style={{color:"var(--muted)"}}>Due day: {group.due_day} · {group.due_time}</div>
          </div>
        </div>

        {group.payment_account_details && (
          <div className="card-tactile p-5 mb-8">
            <div className="label-eyebrow mb-1">Payment Account Details</div>
            <pre className="text-sm whitespace-pre-wrap font-sans">{group.payment_account_details}</pre>
          </div>
        )}

        <section className="mb-10">
          <h2 className="font-display text-2xl mb-4">Cycles & status</h2>
          <div className="card-tactile overflow-x-auto">
            <table className="w-full text-sm" data-testid="cycles-table">
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
          <h2 className="font-display text-2xl mb-4">Group members ({members.length})</h2>
          <div className="card-tactile overflow-hidden">
            <table className="w-full text-sm">
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
                    <td className="px-4 py-3">{m.user_name}</td>
                    {isAdmin && <td className="px-4 py-3" style={{color:"var(--muted)"}}>{m.user_email}</td>}
                    <td className="px-4 py-3" style={{color:"var(--muted)"}}>{fmtDate(m.joined_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {uploadOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={()=>setUploadOpen(false)}>
          <form onClick={e=>e.stopPropagation()} onSubmit={submitUpload} className="bg-white rounded-lg max-w-md w-full p-6" data-testid="upload-modal">
            <h3 className="font-display text-2xl mb-4">Upload payment proof — Cycle #{uploadCycle}</h3>
            <div className="space-y-3">
              <div>
                <label className="label-eyebrow block mb-1">Amount</label>
                <input type="number" required value={uploadAmount} onChange={e=>setUploadAmount(e.target.value)} className="w-full border rounded px-3 py-2" data-testid="upload-amount" />
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Receipt (image)</label>
                <input type="file" accept="image/*,application/pdf" required onChange={e=>setUploadFile(e.target.files[0])} data-testid="upload-file" />
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Note (optional)</label>
                <textarea value={uploadNote} onChange={e=>setUploadNote(e.target.value)} className="w-full border rounded px-3 py-2" rows={2} data-testid="upload-note" />
              </div>
            </div>
            <div className="flex gap-2 mt-6 justify-end">
              <button type="button" onClick={()=>setUploadOpen(false)} className="btn-secondary text-sm" data-testid="upload-cancel">Cancel</button>
              <button type="submit" disabled={uploading} className="btn-primary text-sm" data-testid="upload-submit">
                {uploading ? "Uploading..." : "Submit for review"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
