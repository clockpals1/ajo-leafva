# Ajo / ROSCA Platform — PRD

## Original problem statement
Production-ready Ajo / Contribution / ROSCA management web application. Admins control group creation, membership, approvals; members sign up, contribute, upload proofs. 12-state monthly cycle ledger, visibility rules, audit log, configurable rules, email/WhatsApp invitations.

## Architecture
- FastAPI + MongoDB (motor) + React 19 + Tailwind + shadcn
- JWT httpOnly cookies, bcrypt, RBAC (`require_admin`)
- **All platform config in DB** — `settings` collection, editable from Admin → Settings UI
- Email via Resend (DB-backed key + sender)
- WhatsApp via Twilio (DB-backed SID/token/from number)
- Receipts stored as base64 data-URLs (MVP)

## User personas
1. Platform/Super Admin — full control
2. Group Admin — approves, manages groups
3. Member — signs up or joins via invite, uploads proof, comments

## Core collections
users, groups, group_members, cycles, member_cycle_status, payments, visibility_requests, notifications, audit_logs, **settings**, **invitations**, **group_comments**

## Implemented

### Iteration 1 (MVP core)
Auth (register/login/logout/me), group CRUD + auto cycle generation, member add/remove, payment upload + approve/reject, payout confirmation, visibility requests, per-user notifications, dashboard stats, audit logs, full RBAC. 12 status badges wired end-to-end.

### Iteration 2 (this release)
- **DB-backed settings** — brand, support email, Resend API key/sender, Twilio SID/token/from, frontend URL. Admin Settings page with masked secrets, live `has_resend`/`has_twilio` status.
- **Invitations system** — admin sends invite via email + optional WhatsApp; token link; public `/invite/:token` onboarding page showing group rules; rules must be accepted before join; auto-creates account for new emails, auto-joins logged-in users; list/revoke from admin; email subject/CTA linked back to FE URL.
- **Group rules & comments** — `rules_text` and `enable_comments` on groups. Shown on invite page and member group page. Comments feed per group with optional cycle_no; admins can always post; members blocked if comments disabled; owner + admin can delete.
- **Email events** — welcome, added-to-group, payment approved/rejected, payout completed, invitation (all via DB settings, non-blocking, silent-fail logged).
- **WhatsApp event** — invitation (more events easy to add once Twilio creds in place).
- **Extra super_admin seeded** — `sunday@isunday.me / Ronkus123@`.

## Test results
- Iteration 2: **32/32 new pytest tests + 21/21 regression = 53/53 passing**.
- Frontend smoke: admin login, settings save, create-group with rules, invitations panel create+list, public invite → signup → join → redirect, comments feed all verified.

## Test credentials
- Admin: `admin@ajo.com / admin123` (super_admin)
- Admin: `sunday@isunday.me / Ronkus123@` (super_admin)
- Members: create via `/register` or accept an invite

## Known limitations & future work

### P1
- Secrets at rest: Twilio/Resend tokens stored plaintext in DB. Future: encrypt column or external vault.
- Clearing a setting via UI: empty string is ignored (treated as "no change"). Add explicit null support.
- Retroactive comments hide when `enable_comments` toggled off (currently still visible — intentional for history).
- Rules_text: no size cap yet; add ~10KB Pydantic limit.
- Invitation accept: no transactional wrap — if group_members insert fails mid-signup, user is created without membership.

### P2
- Automatic Overdue / Overdue_Penalty transitions on due-date passage
- Late-fee auto-apply after grace period
- CSV export for ledger & payments
- Object Storage for receipts (migrate from base64)
- Brute-force login lockout
- Multi-currency (currently NGN formatter hardcoded on frontend)
- Two-factor auth for admins

## Next tasks
1. Wire Twilio creds via admin UI (once user provides) → WhatsApp notifications for payment events
2. Secrets encryption at rest
3. Overdue transition scheduler
4. CSV export
