# Ajo / ROSCA Platform — PRD

## Original problem statement
Production-ready Ajo / Contribution / ROSCA management web application with strong admin-controlled workflow, transparent payment tracking, approval logic, audit trails, and reliable data model. Roles: Super Admin, Group Admin, Member. Only admins create groups and add members. Members upload payment proof; admins approve. Each member has 12 distinct monthly status states per cycle. Visibility approval, configurable rules, audit logs, ledger.

## Architecture
- **Stack**: FastAPI + MongoDB (motor) + React 19 + Tailwind + shadcn UI
- **Auth**: JWT in httpOnly cookies, bcrypt password hashing, role-based dependencies (require_admin)
- **Storage**: Receipt images stored as base64 data URLs in `payments` collection (MVP)
- **Routing**: All backend routes under `/api`, frontend uses `REACT_APP_BACKEND_URL`

## User personas
1. **Platform Admin / Super Admin** — full platform control, seeded as `admin@ajo.com / admin123`
2. **Group Admin** — manages groups, approves payments and payouts
3. **Member** — signs up freely, contributes to assigned groups, uploads receipts

## Core entities
users, groups, group_members, cycles, member_cycle_status, payments, visibility_requests, notifications, audit_logs

## Monthly status lifecycle (12 states)
Not_Due → Due → Submitted → Paid (approved) | Rejected (resubmit) | Partial | Overdue → Overdue_Penalty → Carried_Forward; Payout_Eligible → Payout_Completed

## Implemented (2026-02-XX, iteration 1)
### Backend
- JWT auth: register, login, logout, /me; bcrypt; httpOnly cookie
- Admin seeded on startup (`admin@ajo.com / admin123`)
- Group CRUD: create with auto-cycle generation (12 month-friendly periods), list, detail, archive support
- Member management: add (existing user by email) with payout position, remove
- Cycle status auto-generated per member on join
- Payment workflow: upload (base64 receipt), pending queue, approve/reject with cycle status transition
- Payout confirmation per cycle
- Visibility requests with admin approval
- Audit logs with actor info
- Per-user notifications (in-app log)
- Dashboard stats (groups, members, pending, overdue, due, payouts, total collections)
- RBAC: members blocked from admin endpoints (verified by tests)
- Indexes: users.email unique, group_members composite unique, cycles + member_cycle_status composite unique

### Frontend
- Organic Earthy theme (#FDFBF7 / #1E3F33 / #C05A3A / #D99C3D), Outfit + Manrope fonts
- Landing with hero image, features grid, CTAs
- Auth pages (login, register) with cookie-based session
- Member dashboard: assigned groups, payment history, stats
- Group detail (member): cycles table with personal status, upload payment proof modal
- Admin dashboard: tabs (Overview, Groups, Approvals, Members, Audit Log) with KPI cards, create group modal
- Admin group detail: members table, add member dropdown, ledger matrix (members × cycles), payouts tab
- Receipt review modal with image preview + approve/reject + decision note
- 12 status badge variants per design guidelines
- Notifications page, profile page with bank details + visibility request

## Test results (iteration 1)
- Backend: **21/21 pytest passing** (auth, groups, members, payments, payouts, visibility, RBAC)
- Frontend smoke: landing, login, admin dashboard, create group modal verified

## Backlog (P0 / P1 / P2)
### P1
- Email notifications (Resend/SendGrid integration)
- Late-fee auto-calculation cron (currently stored but not auto-applied)
- Auto Overdue/Overdue_Penalty status transition based on due date + grace period
- Object Storage migration for receipts (base64 grows MongoDB payload)
- Visibility request UI for admin (queue + approve buttons) — backend done, UI minimal
- CSV export for ledger and payment history

### P2
- Brute-force login lockout (currently no rate limit)
- Group archive / suspend UI
- Payment partial / carried-forward logic
- Push notifications (web push)
- Multi-currency support (currently NGN hardcoded in frontend formatter)
- Group rule version history (currently single config per group)
- Two-factor auth for admins
- Idempotency on payment decision endpoint

## Next tasks
1. Wire up email notifications via Resend
2. Implement automatic Overdue transition (background scheduler or per-request compute)
3. Add CSV export buttons in admin ledger
4. Add visibility request review UI in admin tabs
