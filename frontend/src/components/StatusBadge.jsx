import React from "react";

const labels = {
  Not_Due: "Not Due",
  Due: "Due",
  Submitted: "Submitted",
  Under_Review: "Under Review",
  Paid: "Paid & Confirmed",
  Partial: "Partial",
  Rejected: "Rejected",
  Overdue: "Overdue",
  Overdue_Penalty: "Overdue + Penalty",
  Carried_Forward: "Carried Forward",
  Payout_Eligible: "Payout Eligible",
  Payout_Completed: "Payout Completed",
};

export default function StatusBadge({ status, className = "" }) {
  const cls = `badge s-${status} ${className}`;
  return <span className={cls} data-testid={`status-badge-${status}`}>{labels[status] || status}</span>;
}
