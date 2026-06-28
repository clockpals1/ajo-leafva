from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import secrets
import logging
import json
import httpx
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta, date
from typing import List, Optional, Literal
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
from email_service import send_email, send_email_with_error, _wrap as _email_wrap
from twilio_service import send_whatsapp

# ---------------- DB & APP ----------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Ajo Platform API")
api = APIRouter(prefix="/api")

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALG = "HS256"

# ---------------- HELPERS ----------------
def now_utc():
    return datetime.now(timezone.utc)

def _primary_fe_url() -> str:
    """Return the first (primary) frontend URL — FRONTEND_URL may be comma-separated for CORS."""
    raw = os.environ.get('FRONTEND_URL', 'http://localhost:3000')
    return raw.split(',')[0].strip().rstrip('/')

def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_pw(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False

def make_token(user_id: str, email: str, role: str, ttl_min=60*24):
    payload = {"sub": user_id, "email": email, "role": role,
               "exp": now_utc() + timedelta(minutes=ttl_min), "type": "access"}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def set_auth_cookie(response: Response, token: str):
    response.set_cookie(key="access_token", value=token, httponly=True,
                        secure=True, samesite="none", max_age=60*60*24, path="/")

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

async def require_admin(user=Depends(get_current_user)):
    if user.get("role") not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Admin only")
    return user

# ---------------- MODELS ----------------
class RegisterIn(BaseModel):
    name: str
    email: EmailStr
    password: str

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account_number: Optional[str] = None
    bank_account_name: Optional[str] = None
    visibility_preference: Optional[Literal["visible", "limited", "hidden"]] = None
    display_name: Optional[str] = None
    use_alias: Optional[bool] = None

class GroupCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    contribution_amount: float
    frequency: Literal["monthly", "weekly", "biweekly"] = "monthly"
    start_date: str  # YYYY-MM-DD
    total_cycles: int
    member_limit: int
    due_day: int = 1  # day of month / day index
    due_time: str = "23:59"
    first_payment_fee: float = 0.0
    late_fee_amount: float = 0.0
    late_fee_method: Literal["fixed", "percent"] = "fixed"
    grace_period_days: int = 0
    payment_account_details: Optional[str] = ""
    whatsapp_invite_link: Optional[str] = ""
    whatsapp_group_name: Optional[str] = ""
    rules_text: Optional[str] = ""
    enable_comments: bool = True
    allow_multiple_slots: bool = False

class GroupUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    contribution_amount: Optional[float] = None
    frequency: Optional[Literal["monthly", "weekly", "biweekly"]] = None
    start_date: Optional[str] = None  # YYYY-MM-DD — changing this does NOT auto-recalculate cycles; use /recalculate-dates
    total_cycles: Optional[int] = None
    member_limit: Optional[int] = None
    due_day: Optional[int] = None
    due_time: Optional[str] = None
    first_payment_fee: Optional[float] = None
    late_fee_amount: Optional[float] = None
    late_fee_method: Optional[Literal["fixed", "percent"]] = None
    grace_period_days: Optional[int] = None
    payment_account_details: Optional[str] = None
    whatsapp_invite_link: Optional[str] = None
    whatsapp_group_name: Optional[str] = None
    rules_text: Optional[str] = None
    enable_comments: Optional[bool] = None
    allow_multiple_slots: Optional[bool] = None
    status: Optional[Literal["active", "paused", "completed"]] = None

class AddMember(BaseModel):
    email: EmailStr
    payout_position: Optional[int] = None

class PaymentUpload(BaseModel):
    group_id: str
    cycle_no: int
    amount: float
    receipt_data_url: str  # base64 data url
    note: Optional[str] = ""

class DecisionIn(BaseModel):
    decision: Literal["approve", "reject"]
    note: Optional[str] = ""

class VisibilityDecision(BaseModel):
    decision: Literal["approve", "reject"]
    note: Optional[str] = ""

class AdminCreateUser(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: Literal["member", "admin", "super_admin"] = "member"

class AdminProvisionUser(BaseModel):
    name: str
    email: EmailStr
    phone: Optional[str] = ""
    group_id: Optional[str] = None
    payout_position: Optional[int] = None
    use_alias: bool = False
    display_name: Optional[str] = ""
    visibility_preference: Literal["visible", "limited", "hidden"] = "visible"

class SetPasswordFromTokenIn(BaseModel):
    token: str
    password: str

class UserRoleUpdate(BaseModel):
    role: Literal["member", "admin", "super_admin"]

# ---------------- AUDIT ----------------
async def log_audit(actor_id: str, action: str, target: str = "", meta: dict = None):
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "actor_id": actor_id,
        "action": action,
        "target": target,
        "meta": meta or {},
        "timestamp": now_utc().isoformat(),
    })

async def push_notification(user_id: str, title: str, body: str, link: str = ""):
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "title": title,
        "body": body,
        "link": link,
        "read": False,
        "timestamp": now_utc().isoformat(),
    })

async def notify_group(group_id: str, title: str, body: str, link: str = "", exclude: str = ""):
    """Broadcast a notification to every active member of a group."""
    members = await db.group_members.find({"group_id": group_id, "status": {"$ne": "removed"}}).to_list(1000)
    for m in members:
        if m["user_id"] == exclude:
            continue
        await push_notification(m["user_id"], title, body, link)

def display_name_for(user_doc: dict, viewer_is_admin: bool) -> str:
    """Return the name to display. Admins always see the real name."""
    if viewer_is_admin:
        return user_doc.get("name", "Member")
    if user_doc.get("use_alias") and user_doc.get("display_name"):
        return user_doc["display_name"]
    return user_doc.get("name", "Member")

# ---------------- AUTH ROUTES ----------------
@api.post("/auth/register")
async def register(data: RegisterIn, response: Response):
    email = data.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    user = {
        "id": user_id,
        "email": email,
        "name": data.name,
        "password_hash": hash_pw(data.password),
        "role": "member",
        "phone": "",
        "bank_name": "",
        "bank_account_number": "",
        "bank_account_name": "",
        "visibility_preference": "visible",
        "visibility_status": "approved",
        "created_at": now_utc().isoformat(),
    }
    await db.users.insert_one(user.copy())
    token = make_token(user_id, email, "member")
    set_auth_cookie(response, token)
    await push_notification(user_id, "Welcome to Ajo Platform",
                            "Your account is created. Wait for an admin to assign you to a group.")
    await send_email(db, email, "Welcome to Ajo Platform",
                     f"Hi {data.name},",
                     "Your member account is ready. An admin will add you to a group shortly. "
                     "You can update your bank details and profile preferences from your dashboard.",
                     cta_label="Open dashboard",
                     cta_link=f"{_primary_fe_url()}/dashboard")
    user.pop("password_hash", None)
    return {"user": user, "token": token}

@api.post("/auth/login")
async def login(data: LoginIn, response: Response):
    email = data.email.lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_pw(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = make_token(user["id"], user["email"], user["role"])
    set_auth_cookie(response, token)
    user.pop("password_hash", None)
    return {"user": user, "token": token}

@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}

@api.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return user

# ---------------- PROFILE ----------------
@api.put("/me/profile")
async def update_profile(data: ProfileUpdate, user=Depends(get_current_user)):
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    current_pref = user.get("visibility_preference", "visible")
    if "visibility_preference" in update and update["visibility_preference"] != current_pref:
        # Visibility change requires admin approval
        await db.visibility_requests.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "user_email": user["email"],
            "user_name": user["name"],
            "requested_preference": update["visibility_preference"],
            "current_preference": user.get("visibility_preference", "visible"),
            "status": "pending",
            "created_at": now_utc().isoformat(),
        })
        update["visibility_status"] = "pending"
        await log_audit(user["id"], "visibility_request", meta={"requested": update["visibility_preference"]})
    if update:
        await db.users.update_one({"id": user["id"]}, {"$set": update})
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    return fresh

# ---------------- ADMIN: GROUP CREATE ----------------
def _add_period(start: date, frequency: str, n: int) -> date:
    if frequency == "weekly":
        return start + timedelta(weeks=n)
    if frequency == "biweekly":
        return start + timedelta(weeks=2*n)
    # monthly
    month = start.month - 1 + n
    year = start.year + month // 12
    month = month % 12 + 1
    day = min(start.day, 28)
    return date(year, month, day)

def _add_period_with_day(start: date, frequency: str, n: int, due_day: int) -> date:
    """Like _add_period but uses explicit due_day for the day-of-month in monthly cycles.
    If due_day is 31 or higher, use the last day of the month."""
    if frequency == "weekly":
        return start + timedelta(weeks=n)
    if frequency == "biweekly":
        return start + timedelta(weeks=2*n)
    # monthly — honour due_day (31 = last day of month)
    month = start.month - 1 + n
    year = start.year + month // 12
    month = month % 12 + 1
    if due_day >= 31:
        # Last day of the month
        if month == 12:
            last_day = 31
        else:
            last_day = (date(year, month + 1, 1) - timedelta(days=1)).day
        day = last_day
    else:
        day = min(due_day, 28)
    return date(year, month, day)

@api.post("/admin/groups")
async def create_group(data: GroupCreate, admin=Depends(require_admin)):
    gid = str(uuid.uuid4())
    start = date.fromisoformat(data.start_date)
    group_doc = {
        "id": gid,
        "name": data.name,
        "description": data.description,
        "contribution_amount": data.contribution_amount,
        "frequency": data.frequency,
        "start_date": data.start_date,
        "total_cycles": data.total_cycles,
        "member_limit": data.member_limit,
        "due_day": data.due_day,
        "due_time": data.due_time,
        "first_payment_fee": data.first_payment_fee,
        "late_fee_amount": data.late_fee_amount,
        "late_fee_method": data.late_fee_method,
        "grace_period_days": data.grace_period_days,
        "payment_account_details": data.payment_account_details,
        "whatsapp_invite_link": data.whatsapp_invite_link or "",
        "whatsapp_group_name": data.whatsapp_group_name or "",
        "rules_text": data.rules_text or "",
        "enable_comments": data.enable_comments,
        "allow_multiple_slots": data.allow_multiple_slots,
        "status": "active",
        "created_by": admin["id"],
        "created_at": now_utc().isoformat(),
        "join_token": uuid.uuid4().hex,
    }
    await db.groups.insert_one(group_doc.copy())
    # generate cycles
    cycles = []
    for i in range(data.total_cycles):
        due = _add_period(start, data.frequency, i)
        cycles.append({
            "id": str(uuid.uuid4()),
            "group_id": gid,
            "cycle_no": i + 1,
            "due_date": due.isoformat(),
            "due_time": data.due_time,
            "expected_amount": data.contribution_amount + (data.first_payment_fee if i == 0 else 0),
            "payout_user_id": None,
            "payout_status": "pending",
            "payout_confirmed_at": None,
        })
    if cycles:
        await db.cycles.insert_many(cycles)
    await log_audit(admin["id"], "group_created", target=gid, meta={"name": data.name})
    group_doc.pop("_id", None)
    return group_doc

@api.get("/admin/groups")
async def list_groups_admin(admin=Depends(require_admin)):
    groups = await db.groups.find({}, {"_id": 0}).to_list(1000)
    for g in groups:
        g["member_count"] = await db.group_members.count_documents({"group_id": g["id"]})
    return groups

@api.get("/admin/groups/{group_id}")
async def get_group_admin(group_id: str, admin=Depends(require_admin)):
    g = await db.groups.find_one({"id": group_id}, {"_id": 0})
    if not g:
        raise HTTPException(404, "Group not found")
    await _sync_cycle_payouts(group_id)  # keep payout_user_id in sync
    members = await db.group_members.find({"group_id": group_id}, {"_id": 0}).to_list(1000)
    cycles = await db.cycles.find({"group_id": group_id}, {"_id": 0}).sort("cycle_no", 1).to_list(1000)
    return {"group": g, "members": members, "cycles": cycles}

@api.patch("/admin/groups/{group_id}")
async def update_group(group_id: str, data: GroupUpdate, admin=Depends(require_admin)):
    g = await db.groups.find_one({"id": group_id})
    if not g:
        raise HTTPException(404, "Group not found")
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")

    # ── Handle total_cycles change: add or remove cycle records ──────────────
    if "total_cycles" in updates:
        new_total = int(updates["total_cycles"])
        if new_total < 1:
            raise HTTPException(400, "total_cycles must be at least 1")
        old_total = int(g.get("total_cycles", 0))

        if new_total < old_total:
            # Guard: don't remove cycles that already have a completed payout
            blocked = await db.cycles.find_one({
                "group_id": group_id,
                "cycle_no": {"$gt": new_total},
                "payout_status": "completed",
            })
            if blocked:
                raise HTTPException(400,
                    f"Cannot reduce to {new_total} cycles — cycle {blocked['cycle_no']} "
                    "already has a completed payout.")
            await db.cycles.delete_many({"group_id": group_id, "cycle_no": {"$gt": new_total}})
            await db.member_cycle_status.delete_many({"group_id": group_id, "cycle_no": {"$gt": new_total}})

        elif new_total > old_total:
            start = date.fromisoformat(g["start_date"])
            freq = g["frequency"]
            amt = float(g["contribution_amount"])
            new_cycle_docs = []
            for i in range(old_total, new_total):
                due = _add_period(start, freq, i)
                new_cycle_docs.append({
                    "id": str(uuid.uuid4()),
                    "group_id": group_id,
                    "cycle_no": i + 1,
                    "due_date": due.isoformat(),
                    "expected_amount": amt,
                    "payout_user_id": None,
                    "payout_status": "pending",
                    "payout_confirmed_at": None,
                })
            if new_cycle_docs:
                await db.cycles.insert_many(new_cycle_docs)
                # Add member_cycle_status rows for each active member
                members = await db.group_members.find(
                    {"group_id": group_id, "status": {"$ne": "removed"}}, {"_id": 0}
                ).to_list(1000)
                today_d = now_utc().date()
                status_docs = []
                for m in members:
                    for c in new_cycle_docs:
                        due_d = date.fromisoformat(c["due_date"])
                        status_docs.append({
                            "id": str(uuid.uuid4()),
                            "group_id": group_id,
                            "cycle_no": c["cycle_no"],
                            "user_id": m["user_id"],
                            "status": "Due" if due_d <= today_d else "Not_Due",
                            "expected_amount": amt,
                            "paid_amount": 0,
                            "approved_at": None,
                            "approver_id": None,
                            "updated_at": now_utc().isoformat(),
                        })
                if status_docs:
                    await db.member_cycle_status.insert_many(status_docs)

    await db.groups.update_one({"id": group_id}, {"$set": updates})

    # ── Auto-recalculate pending cycle due_dates when schedule fields change ──
    if any(k in updates for k in ("start_date", "due_day", "frequency")):
        merged = {**g, **updates}   # current doc merged with new values
        start_str = merged.get("start_date")
        if start_str:
            try:
                sdate = date.fromisoformat(start_str)
                freq  = merged.get("frequency", "monthly")
                dday  = int(merged.get("due_day") or sdate.day)
                today_d = now_utc().date()
                pending = await db.cycles.find(
                    {"group_id": group_id, "payout_status": {"$ne": "completed"}},
                    {"_id": 0}
                ).sort("cycle_no", 1).to_list(1000)
                for c in pending:
                    n = c["cycle_no"] - 1
                    new_due     = _add_period_with_day(sdate, freq, n, dday)
                    new_due_str = new_due.isoformat()
                    if new_due_str != c.get("due_date"):
                        ns = "Due" if new_due <= today_d else "Not_Due"
                        await db.cycles.update_one(
                            {"id": c["id"]}, {"$set": {"due_date": new_due_str}}
                        )
                        await db.member_cycle_status.update_many(
                            {"group_id": group_id, "cycle_no": c["cycle_no"],
                             "status": {"$in": ["Due", "Not_Due"]}},
                            {"$set": {"status": ns, "updated_at": now_utc().isoformat()}}
                        )
            except Exception:
                pass  # never fail the save because of date recalculation

    await log_audit(admin["id"], "group_updated", target=group_id, meta=updates)
    updated = await db.groups.find_one({"id": group_id}, {"_id": 0})
    return updated

class CycleUpdate(BaseModel):
    due_date: Optional[str] = None  # YYYY-MM-DD

@api.patch("/admin/groups/{group_id}/cycles/{cycle_id}")
async def update_cycle(group_id: str, cycle_id: str, data: CycleUpdate, admin=Depends(require_admin)):
    c = await db.cycles.find_one({"id": cycle_id, "group_id": group_id})
    if not c:
        raise HTTPException(404, "Cycle not found")
    if not data.due_date:
        return {"ok": True}
    try:
        new_date = date.fromisoformat(data.due_date)
    except ValueError:
        raise HTTPException(400, "Invalid date format. Use YYYY-MM-DD.")
    await db.cycles.update_one({"id": cycle_id}, {"$set": {"due_date": data.due_date}})
    # Update member_cycle_status statuses based on new date
    today_d = now_utc().date()
    new_status = "Due" if new_date <= today_d else "Not_Due"
    await db.member_cycle_status.update_many(
        {"group_id": group_id, "cycle_no": c["cycle_no"], "status": {"$in": ["Due", "Not_Due"]}},
        {"$set": {"status": new_status}}
    )
    await log_audit(admin["id"], "cycle_updated", target=group_id,
                    meta={"cycle_id": cycle_id, "due_date": data.due_date})
    updated = await db.cycles.find_one({"id": cycle_id}, {"_id": 0})
    return updated

class RecalculateDatesIn(BaseModel):
    start_date: Optional[str] = None   # YYYY-MM-DD; if omitted, use current group start_date
    due_day: Optional[int] = None      # day-of-month; if omitted, use current group due_day

@api.post("/admin/groups/{group_id}/recalculate-dates")
async def recalculate_group_dates(group_id: str, data: RecalculateDatesIn, admin=Depends(require_admin)):
    """Recalculate due_dates for all non-completed cycles using the group's start_date, frequency and due_day.
    Only updates cycles whose payout_status is not 'completed'. Safe to call after changing start_date or due_day."""
    g = await db.groups.find_one({"id": group_id})
    if not g:
        raise HTTPException(404, "Group not found")

    start_str = data.start_date or g.get("start_date")
    if not start_str:
        raise HTTPException(400, "Group has no start_date set.")
    try:
        start = date.fromisoformat(start_str)
    except ValueError:
        raise HTTPException(400, "Invalid start_date format — use YYYY-MM-DD.")

    freq = g.get("frequency", "monthly")
    due_day = data.due_day or g.get("due_day") or start.day
    today_d = now_utc().date()

    pending_cycles = await db.cycles.find(
        {"group_id": group_id, "payout_status": {"$ne": "completed"}},
        {"_id": 0}
    ).sort("cycle_no", 1).to_list(1000)

    if not pending_cycles:
        return {"ok": True, "updated": 0, "message": "No pending cycles to update."}

    updated = 0
    for c in pending_cycles:
        n = c["cycle_no"] - 1  # 0-indexed offset from start
        new_due = _add_period_with_day(start, freq, n, due_day)
        new_due_str = new_due.isoformat()
        if new_due_str != c.get("due_date"):
            new_status = "Due" if new_due <= today_d else "Not_Due"
            await db.cycles.update_one({"id": c["id"]}, {"$set": {"due_date": new_due_str}})
            # Cascade to member_cycle_status rows that are still pending
            await db.member_cycle_status.update_many(
                {"group_id": group_id, "cycle_no": c["cycle_no"], "status": {"$in": ["Due", "Not_Due"]}},
                {"$set": {"status": new_status, "updated_at": now_utc().isoformat()}}
            )
            updated += 1

    # Persist updated start_date and/or due_day to the group document
    group_patch = {}
    if data.start_date and data.start_date != g.get("start_date"):
        group_patch["start_date"] = data.start_date
    if data.due_day and data.due_day != g.get("due_day"):
        group_patch["due_day"] = data.due_day
    if group_patch:
        await db.groups.update_one({"id": group_id}, {"$set": group_patch})

    await log_audit(admin["id"], "cycle_dates_recalculated", target=group_id,
                    meta={"start_date": start_str, "due_day": due_day, "updated": updated})
    return {"ok": True, "updated": updated,
            "message": f"Updated {updated} pending cycle date{'s' if updated != 1 else ''}."}


@api.delete("/admin/groups/{group_id}")
async def delete_group(group_id: str, admin=Depends(require_admin)):
    g = await db.groups.find_one({"id": group_id})
    if not g:
        raise HTTPException(404, "Group not found")
    await db.groups.delete_one({"id": group_id})
    await db.group_members.delete_many({"group_id": group_id})
    await db.cycles.delete_many({"group_id": group_id})
    await db.member_cycle_status.delete_many({"group_id": group_id})
    await db.payments.delete_many({"group_id": group_id})
    await db.invitations.delete_many({"group_id": group_id})
    await db.group_comments.delete_many({"group_id": group_id})
    await log_audit(admin["id"], "group_deleted", target=group_id, meta={"name": g.get("name", "")})
    return {"ok": True}

@api.post("/admin/groups/{group_id}/members")
async def add_member(group_id: str, data: AddMember, admin=Depends(require_admin)):
    group = await db.groups.find_one({"id": group_id})
    if not group:
        raise HTTPException(404, "Group not found")
    user = await db.users.find_one({"email": data.email.lower()}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found. Member must sign up first.")
    if user["role"] not in ("member", "admin", "super_admin"):
        raise HTTPException(400, "Invalid user")
    count = await db.group_members.count_documents({"group_id": group_id})
    if count >= group["member_limit"]:
        raise HTTPException(400, "Group member limit reached")
    if data.payout_position:
        position = data.payout_position
    else:
        # Auto-assign: find first gap in existing positions (keeps slots sequential)
        all_existing = await db.group_members.find({"group_id": group_id}, {"payout_position": 1}).to_list(1000)
        taken = set(m["payout_position"] for m in all_existing if m.get("payout_position") is not None)
        position = 1
        while position in taken:
            position += 1
    # If position is taken, displace the existing member using a temp slot
    pos_taken = await db.group_members.find_one({"group_id": group_id, "payout_position": position})
    if pos_taken:
        # Find the next available position excluding the target position itself
        all_members_now = await db.group_members.find({"group_id": group_id}).to_list(1000)
        used_positions = set(
            m["payout_position"] for m in all_members_now
            if m.get("payout_position") is not None
        )
        max_pos = max(used_positions) if used_positions else count
        temp_pos = max_pos + 1000  # guaranteed free temp slot

        # Step 1: park pos_taken at temp (frees 'position')
        await db.group_members.update_one({"id": pos_taken["id"]}, {"$set": {"payout_position": temp_pos}})

        # Find next_pos: first free slot excluding 'position' (which the new member will take)
        used_after = (used_positions - {position}) | {temp_pos}
        next_pos = 1
        while next_pos in used_after or next_pos == position:
            next_pos += 1

        # Step 2: move pos_taken to next_pos (temp is now free, but we don't need it)
        await db.group_members.update_one({"id": pos_taken["id"]}, {"$set": {"payout_position": next_pos}})

        # Update cycle assignments for the displaced member
        displaced_cycle = await db.cycles.find_one({"group_id": group_id, "cycle_no": next_pos})
        if displaced_cycle and displaced_cycle.get("payout_status") != "completed":
            await db.cycles.update_one({"id": displaced_cycle["id"]}, {"$set": {"payout_user_id": pos_taken["user_id"]}})
        # Recalculate expected_amount for the displaced member
        conflict_slots = await db.group_members.count_documents({"group_id": group_id, "user_id": pos_taken["user_id"]})
        await db.member_cycle_status.update_many(
            {"group_id": group_id, "user_id": pos_taken["user_id"]},
            {"$set": {"expected_amount": group["contribution_amount"] * conflict_slots, "updated_at": now_utc().isoformat()}}
        )
    gm = {
        "id": str(uuid.uuid4()),
        "group_id": group_id,
        "user_id": user["id"],
        "user_email": user["email"],
        "user_name": user["name"],
        "payout_position": position,
        "joined_at": now_utc().isoformat(),
        "status": "active",
    }
    await db.group_members.insert_one(gm.copy())
    # create cycle status records (skip cycles where the user already has a record)
    cycles = await db.cycles.find({"group_id": group_id}).to_list(1000)
    existing_status_nos = {
        s["cycle_no"] for s in
        await db.member_cycle_status.find({"group_id": group_id, "user_id": user["id"]}, {"cycle_no": 1}).to_list(1000)
    }
    today = now_utc().date()
    docs = []
    for c in cycles:
        if c["cycle_no"] in existing_status_nos:
            continue
        due = date.fromisoformat(c["due_date"])
        status_val = "Due" if due <= today else "Not_Due"
        docs.append({
            "id": str(uuid.uuid4()),
            "group_id": group_id,
            "cycle_no": c["cycle_no"],
            "user_id": user["id"],
            "status": status_val,
            "expected_amount": c["expected_amount"],
            "paid_amount": 0,
            "approved_at": None,
            "approver_id": None,
            "updated_at": now_utc().isoformat(),
        })
    if docs:
        try:
            await db.member_cycle_status.insert_many(docs, ordered=False)
        except Exception:
            pass  # duplicate key on extra slot — existing records are kept
    # Recalculate per-cycle expected_amount for this user based on total slot count
    slot_count = await db.group_members.count_documents({"group_id": group_id, "user_id": user["id"]})
    per_cycle_due = group["contribution_amount"] * slot_count
    await db.member_cycle_status.update_many(
        {"group_id": group_id, "user_id": user["id"]},
        {"$set": {"expected_amount": per_cycle_due, "updated_at": now_utc().isoformat()}}
    )
    # assign payout if no other for this position
    cycle = await db.cycles.find_one({"group_id": group_id, "cycle_no": position})
    if cycle and not cycle.get("payout_user_id"):
        await db.cycles.update_one({"id": cycle["id"]}, {"$set": {"payout_user_id": user["id"]}})
    await log_audit(admin["id"], "member_added", target=group_id, meta={"user": user["email"]})
    await push_notification(user["id"], "Added to a group",
                            f"You have been added to '{group['name']}' (Payout #{position}).",
                            link=f"/groups/{group_id}")
    # Broadcast to existing members
    public_name = display_name_for(user, False)
    await notify_group(group_id, "New member joined",
                       f"{public_name} has joined '{group['name']}'.",
                       link=f"/groups/{group_id}", exclude=user["id"])
    wa_html = ""
    if group.get("whatsapp_invite_link"):
        wa_html = f'<p style="margin-top:12px">Join the WhatsApp group: <a href="{group["whatsapp_invite_link"]}">{group.get("whatsapp_group_name") or "Open invite"}</a></p>'
    await send_email(db, user["email"], f"You've been added to {group['name']}",
                     f"Welcome to {group['name']}",
                     f"You are payout #{position} in this {group['frequency']} contribution. "
                     f"Contribution amount: {group['contribution_amount']}.{wa_html}",
                     cta_label="View group",
                     cta_link=f"{_primary_fe_url()}/groups/{group_id}")
    return gm

class UpdateMemberIn(BaseModel):
    payout_position: Optional[int] = None

@api.patch("/admin/groups/{group_id}/members/{member_id}")
async def update_member(group_id: str, member_id: str, data: UpdateMemberIn, admin=Depends(require_admin)):
    gm = await db.group_members.find_one({"group_id": group_id, "id": member_id})
    if not gm:
        raise HTTPException(404, "Member not found")
    if data.payout_position is None:
        return {"ok": True, "changed": 0}
    if data.payout_position < 1:
        raise HTTPException(400, "Payout position must be at least 1")

    old_position = gm.get("payout_position")
    new_position = data.payout_position

    if new_position == old_position:
        return {"ok": True, "changed": 0}

    grp = await db.groups.find_one({"id": group_id}, {"_id": 0, "contribution_amount": 1})
    conflict = await db.group_members.find_one({
        "group_id": group_id, "payout_position": new_position, "id": {"$ne": member_id}
    })

    if conflict:
        # Swap using a guaranteed-free temp slot to avoid duplicate key errors
        all_members = await db.group_members.find({"group_id": group_id}).to_list(1000)
        max_pos = max((m.get("payout_position") or 0) for m in all_members)
        temp_pos = max_pos + 1000  # safely above all existing positions

        # Step 1: park member at temp position (frees old_position)
        await db.group_members.update_one({"id": member_id}, {"$set": {"payout_position": temp_pos}})
        # Step 2: move conflict to old_position (frees new_position)
        await db.group_members.update_one({"id": conflict["id"]}, {"$set": {"payout_position": old_position}})
        # Step 3: move member to new_position (now free)
        await db.group_members.update_one({"id": member_id}, {"$set": {"payout_position": new_position}})

        # Update cycles for conflict member (now at old_position)
        old_cycle = await db.cycles.find_one({"group_id": group_id, "cycle_no": old_position})
        if old_cycle and old_cycle.get("payout_status") != "completed":
            await db.cycles.update_one({"id": old_cycle["id"]}, {"$set": {"payout_user_id": conflict["user_id"]}})
        # Recalculate expected_amount for conflict
        c_slots = await db.group_members.count_documents({"group_id": group_id, "user_id": conflict["user_id"]})
        await db.member_cycle_status.update_many(
            {"group_id": group_id, "user_id": conflict["user_id"]},
            {"$set": {"expected_amount": grp["contribution_amount"] * c_slots, "updated_at": now_utc().isoformat()}}
        )
    else:
        # No conflict: direct update
        await db.group_members.update_one({"id": member_id}, {"$set": {"payout_position": new_position}})
        # Clear old cycle assignment for this member
        await db.cycles.update_one(
            {"group_id": group_id, "cycle_no": old_position, "payout_status": {"$ne": "completed"}},
            {"$set": {"payout_user_id": None}}
        )

    # Assign new cycle to this member
    new_cycle = await db.cycles.find_one({"group_id": group_id, "cycle_no": new_position})
    if new_cycle and new_cycle.get("payout_status") != "completed":
        await db.cycles.update_one({"id": new_cycle["id"]}, {"$set": {"payout_user_id": gm["user_id"]}})

    # Recalculate expected_amount for this member
    my_slots = await db.group_members.count_documents({"group_id": group_id, "user_id": gm["user_id"]})
    await db.member_cycle_status.update_many(
        {"group_id": group_id, "user_id": gm["user_id"]},
        {"$set": {"expected_amount": grp["contribution_amount"] * my_slots, "updated_at": now_utc().isoformat()}}
    )

    await log_audit(admin["id"], "member_updated", target=group_id,
                    meta={"member_id": member_id, "changes": {"payout_position": new_position}})
    return {"ok": True, "changed": 1}

@api.delete("/admin/groups/{group_id}/members/{member_id}")
async def remove_member(group_id: str, member_id: str, reason: Optional[str] = None, admin=Depends(require_admin)):
    gm = await db.group_members.find_one({"group_id": group_id, "id": member_id})
    if not gm:
        raise HTTPException(404, "Member not found")
    res = await db.group_members.delete_one({"id": member_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Member not found")
    # Clear this slot's payout assignment from the cycle (only if payout not yet completed)
    await db.cycles.update_one(
        {"group_id": group_id, "cycle_no": gm["payout_position"], "payout_status": {"$ne": "completed"}},
        {"$set": {"payout_user_id": None}}
    )
    # Recalculate cycle obligations after slot removal
    remaining_slots = await db.group_members.count_documents({"group_id": group_id, "user_id": gm["user_id"]})
    if remaining_slots == 0:
        # Last slot — remove all cycle status records for this user in this group
        await db.member_cycle_status.delete_many({"group_id": group_id, "user_id": gm["user_id"]})
    else:
        grp = await db.groups.find_one({"id": group_id}, {"_id": 0, "contribution_amount": 1})
        per_cycle_due = grp["contribution_amount"] * remaining_slots
        await db.member_cycle_status.update_many(
            {"group_id": group_id, "user_id": gm["user_id"]},
            {"$set": {"expected_amount": per_cycle_due, "updated_at": now_utc().isoformat()}}
        )
    await log_audit(admin["id"], "member_removed", target=group_id,
                    meta={"user_id": gm["user_id"], "member_id": member_id, "reason": reason or ""})
    return {"ok": True}

# ---------------- PRIVATE MEMBER MESSAGES ----------------
class MemberMessageIn(BaseModel):
    subject: str
    body: str

@api.post("/groups/{group_id}/message-admin")
async def send_message_to_admin(group_id: str, data: MemberMessageIn, user=Depends(get_current_user)):
    gm = await db.group_members.find_one({"group_id": group_id, "user_id": user["id"]})
    if not gm:
        raise HTTPException(403, "Not a member of this group")
    if not data.subject.strip() or not data.body.strip():
        raise HTTPException(400, "Subject and body are required")
    msg = {
        "id": str(uuid.uuid4()),
        "group_id": group_id,
        "from_user_id": user["id"],
        "from_user_name": user["name"],
        "from_user_email": user["email"],
        "subject": data.subject.strip(),
        "body": data.body.strip(),
        "read": False,
        "created_at": now_utc().isoformat(),
    }
    await db.member_messages.insert_one(msg.copy())
    return {"ok": True}

@api.get("/admin/groups/{group_id}/member-messages")
async def list_member_messages(group_id: str, admin=Depends(require_admin)):
    items = await db.member_messages.find({"group_id": group_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return items

@api.patch("/admin/member-messages/{msg_id}/read")
async def mark_message_read(msg_id: str, admin=Depends(require_admin)):
    await db.member_messages.update_one({"id": msg_id}, {"$set": {"read": True}})
    return {"ok": True}

class AdminReplyIn(BaseModel):
    body: str

@api.post("/admin/member-messages/{msg_id}/reply")
async def reply_to_member_message(msg_id: str, data: AdminReplyIn, admin=Depends(require_admin)):
    """Admin replies to a member's private message. Sends email and notification to the member."""
    msg = await db.member_messages.find_one({"id": msg_id})
    if not msg:
        raise HTTPException(404, "Message not found")
    
    if not data.body.strip():
        raise HTTPException(400, "Reply body is required")
    
    # Mark original message as read
    await db.member_messages.update_one({"id": msg_id}, {"$set": {"read": True}})
    
    # Send reply via email
    await send_email(
        db,
        msg["from_user_email"],
        f"Re: {msg['subject']}",
        f"Admin reply to your message",
        f"<p><strong>Original message:</strong></p><p>{msg['body']}</p><hr><p><strong>Admin reply:</strong></p><p>{data.body}</p>",
        cta_label="View group",
        cta_link=f"{_primary_fe_url()}/groups/{msg['group_id']}"
    )
    
    # Send notification
    await push_notification(
        msg["from_user_id"],
        f"Re: {msg['subject']}",
        data.body,
        link=f"/groups/{msg['group_id']}"
    )
    
    await log_audit(admin["id"], "admin_replied_to_member_message",
                    meta={"message_id": msg_id, "group_id": msg["group_id"], "to_user_id": msg["from_user_id"]})
    
    return {"ok": True}

# ---------------- PAYMENTS ----------------
@api.post("/payments/upload")
async def upload_payment(data: PaymentUpload, user=Depends(get_current_user)):
    gm = await db.group_members.find_one({"group_id": data.group_id, "user_id": user["id"]})
    if not gm:
        raise HTTPException(403, "You are not a member of this group")
    cycle = await db.cycles.find_one({"group_id": data.group_id, "cycle_no": data.cycle_no})
    if not cycle:
        raise HTTPException(404, "Cycle not found")
    pid = str(uuid.uuid4())
    doc = {
        "id": pid,
        "group_id": data.group_id,
        "cycle_no": data.cycle_no,
        "user_id": user["id"],
        "user_name": user["name"],
        "user_email": user["email"],
        "amount": data.amount,
        "receipt_data_url": data.receipt_data_url,
        "note": data.note,
        "status": "submitted",
        "decision_note": "",
        "approver_id": None,
        "submitted_at": now_utc().isoformat(),
        "decided_at": None,
    }
    await db.payments.insert_one(doc.copy())
    await db.member_cycle_status.update_one(
        {"group_id": data.group_id, "cycle_no": data.cycle_no, "user_id": user["id"]},
        {"$set": {"status": "Submitted", "paid_amount": data.amount,
                  "updated_at": now_utc().isoformat(), "last_payment_id": pid}}
    )
    await log_audit(user["id"], "payment_uploaded", target=pid,
                    meta={"group_id": data.group_id, "cycle": data.cycle_no})
    # notify admin — in-app + email
    group_doc = await db.groups.find_one({"id": data.group_id}, {"_id": 0, "name": 1})
    group_name = group_doc["name"] if group_doc else data.group_id
    settings_doc = await db.settings.find_one({"key": "global"}, {"_id": 0}) or {}
    extra_emails_raw = settings_doc.get("payment_approval_emails") or ""
    extra_emails = [e.strip() for e in extra_emails_raw.split(",") if e.strip()]
    admins = await db.users.find({"role": {"$in": ["admin", "super_admin"]}}).to_list(100)
    email_subject = f"💰 New payment submitted — {group_name}"
    email_title = "New Payment Submitted"
    email_body = (
        f"<p><b>{user['name']}</b> has submitted a payment proof for <b>{group_name}</b>.</p>"
        f"<p><b>Amount:</b> ₦{data.amount:,.0f}<br>"
        f"<b>Month:</b> Cycle {data.cycle_no}<br>"
        f"<b>Submitted at:</b> {now_utc().strftime('%d %b %Y, %H:%M UTC')}</p>"
        f"<p>Please log in to the admin panel to review and approve or reject this payment.</p>"
    )
    for a in admins:
        await push_notification(a["id"], "New payment submitted",
                                f"{user['name']} submitted ₦{data.amount:,.0f} for cycle {data.cycle_no} in {group_name}.",
                                link=f"/admin")
        if a.get("email"):
            await send_email(db, a["email"], email_subject, email_title, email_body,
                             cta_label="Review payment", cta_link=f"{_primary_fe_url()}/admin")
    # also notify extra approval emails from Settings
    admin_emails = {a["email"] for a in admins if a.get("email")}
    for email_addr in extra_emails:
        if email_addr not in admin_emails:  # avoid duplicates
            await send_email(db, email_addr, email_subject, email_title, email_body,
                             cta_label="Review payment", cta_link=f"{_primary_fe_url()}/admin")
    doc.pop("_id", None)
    return doc

@api.get("/payments/my")
async def my_payments(user=Depends(get_current_user)):
    items = await db.payments.find({"user_id": user["id"]}, {"_id": 0, "receipt_data_url": 0}).sort("submitted_at", -1).to_list(500)
    return items

@api.get("/payments/{payment_id}")
async def get_payment(payment_id: str, user=Depends(get_current_user)):
    p = await db.payments.find_one({"id": payment_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Not found")
    if user["role"] not in ("admin", "super_admin") and p["user_id"] != user["id"]:
        raise HTTPException(403, "Forbidden")
    return p

@api.get("/admin/payments/pending")
async def pending_payments(admin=Depends(require_admin)):
    items = await db.payments.find({"status": "submitted"}, {"_id": 0, "receipt_data_url": 0}).sort("submitted_at", -1).to_list(500)
    if items:
        gids = list({p["group_id"] for p in items if p.get("group_id")})
        grps = await db.groups.find({"id": {"$in": gids}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
        gmap = {g["id"]: g["name"] for g in grps}
        for p in items:
            p["group_name"] = gmap.get(p.get("group_id"), "")
    return items

@api.post("/admin/payments/{payment_id}/decision")
async def decide_payment(payment_id: str, data: DecisionIn, admin=Depends(require_admin)):
    p = await db.payments.find_one({"id": payment_id})
    if not p:
        raise HTTPException(404, "Payment not found")
    new_status = "approved" if data.decision == "approve" else "rejected"
    cycle_status = "Paid" if data.decision == "approve" else "Rejected"
    await db.payments.update_one({"id": payment_id}, {"$set": {
        "status": new_status,
        "decision_note": data.note,
        "approver_id": admin["id"],
        "decided_at": now_utc().isoformat(),
    }})
    await db.member_cycle_status.update_one(
        {"group_id": p["group_id"], "cycle_no": p["cycle_no"], "user_id": p["user_id"]},
        {"$set": {"status": cycle_status,
                  "approved_at": now_utc().isoformat() if data.decision == "approve" else None,
                  "approver_id": admin["id"] if data.decision == "approve" else None,
                  "updated_at": now_utc().isoformat()}}
    )
    await log_audit(admin["id"], f"payment_{new_status}", target=payment_id,
                    meta={"group_id": p["group_id"], "user_id": p["user_id"]})
    await push_notification(
        p["user_id"],
        "Payment approved" if data.decision == "approve" else "Payment rejected",
        f"Your payment for cycle {p['cycle_no']} was {new_status}." + (f" Note: {data.note}" if data.note else ""),
        link=f"/groups/{p['group_id']}"
    )
    if data.decision == "approve":
        payer = await db.users.find_one({"id": p["user_id"]}, {"_id": 0}) or {}
        public_name = display_name_for(payer, False)
        await notify_group(p["group_id"], "Contribution received",
                           f"{public_name} contributed for cycle {p['cycle_no']}.",
                           link=f"/groups/{p['group_id']}", exclude=p["user_id"])
    await send_email(
        db,
        p["user_email"],
        f"Payment {new_status} — Cycle {p['cycle_no']}",
        f"Payment {new_status}",
        f"Your payment of {p['amount']} for cycle {p['cycle_no']} was <b>{new_status}</b>." +
        (f"<br><br>Admin note: {data.note}" if data.note else ""),
        cta_label="View group",
        cta_link=f"{_primary_fe_url()}/groups/{p['group_id']}"
    )
    return {"ok": True, "status": new_status}

# ---------------- PAYOUTS ----------------
@api.post("/admin/payouts/{group_id}/{cycle_no}/confirm")
async def confirm_payout(group_id: str, cycle_no: int, admin=Depends(require_admin)):
    await _sync_cycle_payouts(group_id)  # ensure payout_user_id is fresh before confirming
    cycle = await db.cycles.find_one({"group_id": group_id, "cycle_no": cycle_no})
    if not cycle:
        raise HTTPException(404, "Cycle not found")
    if not cycle.get("payout_user_id"):
        raise HTTPException(400, "No payout recipient assigned for this slot")
    await db.cycles.update_one({"id": cycle["id"]}, {"$set": {
        "payout_status": "completed",
        "payout_confirmed_at": now_utc().isoformat(),
    }})
    await db.member_cycle_status.update_one(
        {"group_id": group_id, "cycle_no": cycle_no, "user_id": cycle["payout_user_id"]},
        {"$set": {"status": "Payout_Completed", "updated_at": now_utc().isoformat()}}
    )
    await log_audit(admin["id"], "payout_confirmed", target=group_id,
                    meta={"cycle": cycle_no, "user_id": cycle["payout_user_id"]})
    await push_notification(cycle["payout_user_id"], "Payout completed",
                            f"Your payout for cycle {cycle_no} has been confirmed.",
                            link=f"/groups/{group_id}")
    recipient = await db.users.find_one({"id": cycle["payout_user_id"]}, {"_id": 0})
    if recipient:
        group = await db.groups.find_one({"id": group_id}, {"_id": 0, "name": 1})
        public_name = display_name_for(recipient, False)
        await notify_group(group_id, "Payout completed",
                           f"{public_name} received the cycle {cycle_no} payout.",
                           link=f"/groups/{group_id}", exclude=cycle["payout_user_id"])
        await send_email(db, recipient["email"], "Payout completed",
                         "Your payout has been confirmed",
                         f"The payout for cycle {cycle_no} of <b>{group.get('name','your group')}</b> has been confirmed by the admin.",
                         cta_label="View group",
                         cta_link=f"{_primary_fe_url()}/groups/{group_id}")
    return {"ok": True}

# ---------------- MEMBER VIEWS ----------------
@api.get("/groups/my")
async def my_groups(user=Depends(get_current_user)):
    memberships = await db.group_members.find({"user_id": user["id"]}, {"_id": 0}).to_list(100)
    # Aggregate all slots per group
    by_group: dict = {}
    for m in memberships:
        gid = m["group_id"]
        if gid not in by_group:
            by_group[gid] = []
        by_group[gid].append(m)
    out = []
    for gid, slots in by_group.items():
        g = await db.groups.find_one({"id": gid}, {"_id": 0})
        if not g:
            continue
        slot_positions = sorted([s["payout_position"] for s in slots if s.get("payout_position") is not None])
        if not slot_positions:
            continue
        out.append({
            **g,
            "my_slots": slot_positions,
            "payout_position": slot_positions[0],          # kept for backward compat
            "my_monthly_due": g["contribution_amount"] * len(slot_positions),
        })
    return out

@api.get("/groups/{group_id}/detail")
async def group_detail(group_id: str, user=Depends(get_current_user)):
    g = await db.groups.find_one({"id": group_id}, {"_id": 0})
    if not g:
        raise HTTPException(404, "Group not found")
    is_admin = user["role"] in ("admin", "super_admin")
    is_member = await db.group_members.find_one({"group_id": group_id, "user_id": user["id"]})
    if not is_admin and not is_member:
        raise HTTPException(403, "Not a member of this group")
    await _sync_cycle_payouts(group_id)  # keep payout_user_id consistent before serving
    await _refresh_cycle_statuses(group_id)  # advance Not_Due -> Due as time passes
    cycles = await db.cycles.find({"group_id": group_id}, {"_id": 0}).sort("cycle_no", 1).to_list(1000)
    members_raw = await db.group_members.find({"group_id": group_id}, {"_id": 0}).to_list(1000)
    members = [m for m in members_raw if m.get("payout_position") is not None]
    # Resolve display names (alias for non-admin viewers if user opts in)
    member_user_ids = [m["user_id"] for m in members]
    user_docs = await db.users.find({"id": {"$in": member_user_ids}},
                                    {"_id": 0, "id": 1, "name": 1, "display_name": 1, "use_alias": 1,
                                     "visibility_preference": 1}).to_list(1000)
    udoc_map = {u["id"]: u for u in user_docs}
    for m in members:
        u = udoc_map.get(m["user_id"], {})
        m["display_name"] = display_name_for(u, is_admin)
        # privacy: hide real name from non-admin if "hidden"
        if not is_admin and u.get("visibility_preference") == "hidden":
            m["user_email"] = ""
    for c in cycles:
        uid = c.get("payout_user_id")
        u = udoc_map.get(uid, {})
        c["payout_user_name"] = display_name_for(u, is_admin) if u else None
    if is_admin:
        my_status = await db.member_cycle_status.find({"group_id": group_id}, {"_id": 0}).to_list(5000)
    else:
        my_status = await db.member_cycle_status.find({"group_id": group_id, "user_id": user["id"]}, {"_id": 0}).to_list(1000)

    # ── Active cycle: first cycle whose payout is not yet completed ──
    first_pending = await db.cycles.find(
        {"group_id": group_id, "payout_status": {"$ne": "completed"}},
        {"_id": 0, "cycle_no": 1}
    ).sort("cycle_no", 1).limit(1).to_list(1)
    active_cycle_no = first_pending[0]["cycle_no"] if first_pending else None

    # ── Per-member payment status for the active cycle only ──
    member_payment_statuses: dict = {}
    if active_cycle_no:
        active_statuses = await db.member_cycle_status.find(
            {"group_id": group_id, "cycle_no": active_cycle_no},
            {"_id": 0, "user_id": 1, "status": 1}
        ).to_list(5000)
        for s in active_statuses:
            member_payment_statuses[s["user_id"]] = s["status"]
    else:
        # All cycles completed — show most recent status per member
        all_statuses = await db.member_cycle_status.find(
            {"group_id": group_id},
            {"_id": 0, "user_id": 1, "cycle_no": 1, "status": 1}
        ).to_list(5000)
        for uid in {s["user_id"] for s in all_statuses}:
            user_cycles = sorted([s for s in all_statuses if s["user_id"] == uid],
                                 key=lambda x: x["cycle_no"], reverse=True)
            member_payment_statuses[uid] = user_cycles[0]["status"] if user_cycles else "Not_Due"

    return {
        "group": g, "cycles": cycles, "members": members, "statuses": my_status,
        "member_payment_statuses": member_payment_statuses,
        "active_cycle_no": active_cycle_no,
    }

# ── Helper: auto-advance Not_Due -> Due when a cycle's due_date passes ──
async def _refresh_cycle_statuses(group_id: str):
    """Transition member_cycle_status from Not_Due -> Due when the cycle due_date has arrived.
    Called before group_detail so members always see the correct current status."""
    from datetime import date as _date
    today_d = now_utc().date()
    pending_cycles = await db.cycles.find(
        {"group_id": group_id, "payout_status": {"$ne": "completed"}},
        {"_id": 0, "cycle_no": 1, "due_date": 1}
    ).sort("cycle_no", 1).to_list(1000)
    for c in pending_cycles:
        try:
            due_d = _date.fromisoformat(c["due_date"])
        except Exception:
            continue
        if due_d <= today_d:
            await db.member_cycle_status.update_many(
                {"group_id": group_id, "cycle_no": c["cycle_no"], "status": "Not_Due"},
                {"$set": {"status": "Due", "updated_at": now_utc().isoformat()}}
            )

# ── Helper: keep cycles.payout_user_id in sync with group_members.payout_position ──
async def _sync_cycle_payouts(gid: str):
    """Sync payout_user_id on all pending cycles to match group_members.payout_position.
    The authoritative source is payout_position; payout_user_id is derived from it."""
    members_list = await db.group_members.find(
        {"group_id": gid, "payout_position": {"$ne": None}},
        {"_id": 0, "user_id": 1, "payout_position": 1}
    ).to_list(1000)
    pos_to_uid = {m["payout_position"]: m["user_id"] for m in members_list}
    cycles_list = await db.cycles.find(
        {"group_id": gid, "payout_status": {"$ne": "completed"}},
        {"_id": 0, "id": 1, "cycle_no": 1, "payout_user_id": 1}
    ).to_list(1000)
    for c in cycles_list:
        expected = pos_to_uid.get(c["cycle_no"])  # None if no member owns this slot
        if c.get("payout_user_id") != expected:
            await db.cycles.update_one({"id": c["id"]}, {"$set": {"payout_user_id": expected}})

# ---------------- RECONCILE CYCLE PAYOUTS ----------------
@api.post("/admin/reconcile-cycle-payouts")
async def reconcile_cycle_payouts(admin=Depends(require_admin)):
    """
    Fix stale payout_user_id assignments in cycles.
    A cycle's payout_user_id must match a group_member record where
    user_id = payout_user_id AND payout_position = cycle_no.
    Any mismatch (e.g. from previously removed or repositioned slots)
    is cleared to None — unless payout_status = 'completed'.
    Returns a summary of changes made.
    """
    groups = await db.groups.find({}, {"_id": 0, "id": 1}).to_list(1000)
    total_cleared = 0
    for g in groups:
        gid = g["id"]
        cycles_list = await db.cycles.find(
            {"group_id": gid, "payout_user_id": {"$ne": None}, "payout_status": {"$ne": "completed"}},
            {"_id": 0, "id": 1, "cycle_no": 1, "payout_user_id": 1}
        ).to_list(1000)
        for c in cycles_list:
            # Valid assignment: there must be a group_member with this user AND this position
            valid = await db.group_members.find_one({
                "group_id": gid,
                "user_id": c["payout_user_id"],
                "payout_position": c["cycle_no"]
            })
            if not valid:
                await db.cycles.update_one({"id": c["id"]}, {"$set": {"payout_user_id": None}})
                total_cleared += 1
    await log_audit(admin["id"], "reconcile_cycle_payouts", meta={"cleared": total_cleared})
    return {"ok": True, "cycles_cleared": total_cleared}

# ---------------- DASHBOARD STATS ----------------
@api.get("/admin/dashboard-stats")
async def dashboard_stats(admin=Depends(require_admin)):
    active_groups = await db.groups.count_documents({"status": "active"})
    total_members = await db.users.count_documents({"role": "member"})
    pending_payments = await db.payments.count_documents({"status": "submitted"})
    overdue = await db.member_cycle_status.count_documents({"status": "Overdue"})
    due_now = await db.member_cycle_status.count_documents({"status": "Due"})
    # total collections = sum of approved payments
    pipeline = [{"$match": {"status": "approved"}}, {"$group": {"_id": None, "total": {"$sum": "$amount"}}}]
    res = await db.payments.aggregate(pipeline).to_list(1)
    total_collections = res[0]["total"] if res else 0
    upcoming_payouts = await db.cycles.count_documents({"payout_status": "pending"})
    return {
        "active_groups": active_groups,
        "total_members": total_members,
        "pending_payments": pending_payments,
        "overdue_payments": overdue,
        "due_now": due_now,
        "upcoming_payouts": upcoming_payouts,
        "total_collections": total_collections,
    }

@api.get("/admin/users")
async def list_users(admin=Depends(require_admin)):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
    return users

@api.post("/admin/users")
async def admin_create_user(data: AdminCreateUser, admin=Depends(require_admin)):
    email = data.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "Email already registered")
    user_id = str(uuid.uuid4())
    user = {
        "id": user_id,
        "email": email,
        "name": data.name,
        "password_hash": hash_pw(data.password),
        "role": data.role,
        "phone": "",
        "bank_name": "",
        "bank_account_number": "",
        "bank_account_name": "",
        "visibility_preference": "visible",
        "visibility_status": "approved",
        "created_at": now_utc().isoformat(),
    }
    await db.users.insert_one(user.copy())
    await log_audit(admin["id"], "user_created", target=email, meta={"role": data.role})
    user.pop("password_hash", None)
    user.pop("_id", None)
    return user

@api.post("/admin/users/provision")
async def provision_user(data: AdminProvisionUser, admin=Depends(require_admin)):
    """Admin creates a member account without needing a password — member sets their own via email link."""
    email = data.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "An account with this email already exists.")
    group = None
    if data.group_id:
        group = await db.groups.find_one({"id": data.group_id})
        if not group:
            raise HTTPException(404, "Group not found")
    user_id = str(uuid.uuid4())
    temp_pw = secrets.token_urlsafe(24)
    user_doc = {
        "id": user_id, "email": email, "name": data.name,
        "password_hash": hash_pw(temp_pw),
        "role": "member", "phone": data.phone or "",
        "bank_name": "", "bank_account_number": "", "bank_account_name": "",
        "display_name": data.display_name or "",
        "use_alias": data.use_alias,
        "visibility_preference": data.visibility_preference,
        "visibility_status": "approved",
        "must_change_password": True,
        "created_at": now_utc().isoformat(),
        "provisioned_by": admin["id"],
    }
    await db.users.insert_one(user_doc.copy())
    setup_token = secrets.token_urlsafe(32)
    await db.password_set_tokens.insert_one({
        "id": str(uuid.uuid4()), "user_id": user_id, "token": setup_token,
        "expires_at": (now_utc() + timedelta(days=7)).isoformat(), "used": False,
    })
    position = None
    if group:
        count = await db.group_members.count_documents({"group_id": data.group_id})
        if count >= group["member_limit"]:
            await db.users.delete_one({"id": user_id})
            await db.password_set_tokens.delete_many({"user_id": user_id})
            raise HTTPException(400, "Group member limit reached.")
        position = data.payout_position or (count + 1)
        pos_taken = await db.group_members.find_one({"group_id": data.group_id, "payout_position": position})
        if pos_taken:
            # Use temp slot pattern to avoid duplicate key errors
            all_members_now = await db.group_members.find({"group_id": data.group_id}).to_list(1000)
            used_positions = set(
                m["payout_position"] for m in all_members_now
                if m.get("payout_position") is not None
            )
            max_pos = max(used_positions) if used_positions else count
            temp_pos = max_pos + 1000

            # Step 1: park pos_taken at temp (frees 'position')
            await db.group_members.update_one({"id": pos_taken["id"]}, {"$set": {"payout_position": temp_pos}})

            # Find next_pos: first free slot excluding 'position' (which new member takes)
            used_after = (used_positions - {position}) | {temp_pos}
            next_pos = 1
            while next_pos in used_after or next_pos == position:
                next_pos += 1

            # Step 2: move pos_taken to next_pos
            await db.group_members.update_one({"id": pos_taken["id"]}, {"$set": {"payout_position": next_pos}})

            # Update cycle assignment for displaced member
            displaced_cycle = await db.cycles.find_one({"group_id": data.group_id, "cycle_no": next_pos})
            if displaced_cycle and displaced_cycle.get("payout_status") != "completed":
                await db.cycles.update_one({"id": displaced_cycle["id"]}, {"$set": {"payout_user_id": pos_taken["user_id"]}})
            # Recalculate expected_amount for displaced member
            conflict_slots = await db.group_members.count_documents({"group_id": data.group_id, "user_id": pos_taken["user_id"]})
            await db.member_cycle_status.update_many(
                {"group_id": data.group_id, "user_id": pos_taken["user_id"]},
                {"$set": {"expected_amount": group["contribution_amount"] * conflict_slots, "updated_at": now_utc().isoformat()}}
            )
        gm = {
            "id": str(uuid.uuid4()), "group_id": data.group_id, "user_id": user_id,
            "user_email": email, "user_name": data.name, "payout_position": position,
            "joined_at": now_utc().isoformat(), "status": "active",
        }
        await db.group_members.insert_one(gm.copy())
        cycles_list = await db.cycles.find({"group_id": data.group_id}).to_list(1000)
        today_d = now_utc().date()
        status_docs = [{"id": str(uuid.uuid4()), "group_id": data.group_id, "cycle_no": c["cycle_no"],
            "user_id": user_id, "status": "Due" if date.fromisoformat(c["due_date"]) <= today_d else "Not_Due",
            "expected_amount": c["expected_amount"], "paid_amount": 0,
            "approved_at": None, "approver_id": None, "updated_at": now_utc().isoformat(),
        } for c in cycles_list]
        if status_docs:
            await db.member_cycle_status.insert_many(status_docs)
        pc = await db.cycles.find_one({"group_id": data.group_id, "cycle_no": position})
        if pc and not pc.get("payout_user_id"):
            await db.cycles.update_one({"id": pc["id"]}, {"$set": {"payout_user_id": user_id}})
    fe = _primary_fe_url()
    setup_link = f"{fe}/set-password?token={setup_token}"
    freq_map = {"monthly": "monthly", "weekly": "weekly", "biweekly": "every 2 weeks"}
    group_html = ""
    if group and position:
        privacy_note = ""
        if data.use_alias or data.visibility_preference != "visible":
            privacy_note = "<p style='margin-top:12px;padding:12px;background:#f0fdf4;border-radius:8px;font-size:14px;color:#166534;'>&#128274; <strong>Your privacy is protected.</strong> Your alias name will be shown to other members — your real identity stays confidential.</p>"
        group_html = (
            f"<div style='margin:20px 0;padding:16px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;'>"
            f"<div style='font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;'>Your Group</div>"
            f"<div style='font-size:20px;font-weight:700;color:#1e293b;margin-bottom:14px;'>{group['name']}</div>"
            f"<table style='font-size:14px;border-collapse:collapse;'>"
            f"<tr><td style='padding:3px 20px 3px 0;color:#64748b;'>Monthly contribution</td>"
            f"<td style='font-weight:600;color:#1e293b;'>&#8358;{group['contribution_amount']:,.0f} ({freq_map.get(group['frequency'], group['frequency'])})</td></tr>"
            f"<tr><td style='padding:3px 20px 3px 0;color:#64748b;'>Your payout slot</td>"
            f"<td style='font-weight:600;color:#1e293b;'>#{position} of {group['total_cycles']}</td></tr>"
            f"</table>{privacy_note}</div>"
        )
    await send_email(db, email,
        "Activate your Ajo account",
        f"Welcome, {data.name}!",
        f"Your administrator has created an Ajo account for you. "
        f"Ajo is a trusted contribution savings circle — every member contributes regularly and takes turns receiving the full pot."
        f"{group_html}"
        f"<p style='margin-top:16px;color:#475569;font-size:14px;'>Click the button below to set your password and access your dashboard. "
        f"This link is valid for <strong>7 days</strong>. If it expires, contact your admin for a new link.</p>",
        cta_label="Set my password &amp; activate account",
        cta_link=setup_link,
    )
    await push_notification(user_id, "Welcome to Ajo Platform",
        f"Your account is ready. Check your email to set your password.")
    await log_audit(admin["id"], "user_provisioned", target=user_id, meta={"email": email, "group_id": data.group_id})
    user_doc.pop("password_hash", None); user_doc.pop("_id", None)
    return user_doc

@api.post("/admin/users/{user_id}/resend-setup-email")
async def resend_setup_email(user_id: str, admin=Depends(require_admin)):
    u = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not u:
        raise HTTPException(404, "User not found")
    await db.password_set_tokens.delete_many({"user_id": user_id})
    setup_token = secrets.token_urlsafe(32)
    await db.password_set_tokens.insert_one({
        "id": str(uuid.uuid4()), "user_id": user_id, "token": setup_token,
        "expires_at": (now_utc() + timedelta(days=7)).isoformat(), "used": False,
    })
    setup_link = f"{_primary_fe_url()}/set-password?token={setup_token}"
    await send_email(db, u["email"],
        "Set your Ajo password",
        f"Hi {u['name']},",
        "Your admin has sent you a new account activation link. Click the button below to set your password and access your dashboard.",
        cta_label="Set my password",
        cta_link=setup_link,
    )
    await log_audit(admin["id"], "setup_email_resent", target=user_id, meta={"email": u["email"]})
    return {"ok": True}

@api.post("/auth/setup/complete")
async def complete_account_setup(data: SetPasswordFromTokenIn, response: Response):
    """Public endpoint — member sets their password using the emailed token. Returns JWT for auto-login."""
    if len(data.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    tok = await db.password_set_tokens.find_one({"token": data.token})
    if not tok or tok.get("used"):
        raise HTTPException(400, "This link is invalid or has already been used. Ask your admin to resend the setup email.")
    if now_utc().isoformat() > tok["expires_at"]:
        raise HTTPException(400, "This link has expired (7 days). Ask your admin to resend the setup email.")
    u = await db.users.find_one({"id": tok["user_id"]}, {"_id": 0})
    if not u:
        raise HTTPException(404, "Account not found.")
    await db.users.update_one({"id": u["id"]}, {"$set": {
        "password_hash": hash_pw(data.password), "must_change_password": False,
    }})
    await db.password_set_tokens.update_one({"id": tok["id"]}, {"$set": {"used": True}})
    jwt_token = make_token(u["id"], u["email"], u["role"])
    set_auth_cookie(response, jwt_token)
    fresh = await db.users.find_one({"id": u["id"]}, {"_id": 0, "password_hash": 0})
    return {"user": fresh, "token": jwt_token}

class UpdateUserIn(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None

class SetPasswordIn(BaseModel):
    password: str

@api.patch("/admin/users/{user_id}")
async def admin_update_user(user_id: str, data: UpdateUserIn, admin=Depends(require_admin)):
    u = await db.users.find_one({"id": user_id})
    if not u:
        raise HTTPException(404, "User not found")
    update: dict = {}
    if data.name and data.name.strip():
        update["name"] = data.name.strip()
    if data.email and data.email.strip():
        email = data.email.lower().strip()
        conflict = await db.users.find_one({"email": email, "id": {"$ne": user_id}})
        if conflict:
            raise HTTPException(400, "Email already in use by another account")
        update["email"] = email
    if not update:
        return {"ok": True, "changed": 0}
    await db.users.update_one({"id": user_id}, {"$set": update})
    await log_audit(admin["id"], "user_updated", target=user_id, meta={"changes": list(update.keys())})
    return {"ok": True, "changed": len(update)}

@api.post("/admin/users/{user_id}/set-password")
async def admin_set_password(user_id: str, data: SetPasswordIn, admin=Depends(require_admin)):
    u = await db.users.find_one({"id": user_id})
    if not u:
        raise HTTPException(404, "User not found")
    if len(data.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    await db.users.update_one({"id": user_id}, {"$set": {"password_hash": hash_pw(data.password), "must_change_password": False}})
    await log_audit(admin["id"], "password_reset_by_admin", target=user_id)
    return {"ok": True}

@api.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: str, admin=Depends(require_admin)):
    u = await db.users.find_one({"id": user_id})
    if not u:
        raise HTTPException(404, "User not found")
    if user_id == admin["id"]:
        raise HTTPException(400, "You cannot delete your own account")
    await db.users.delete_one({"id": user_id})
    await db.group_members.delete_many({"user_id": user_id})
    await db.notifications.delete_many({"user_id": user_id})
    await log_audit(admin["id"], "user_deleted", target=user_id, meta={"email": u.get("email", "")})
    return {"ok": True}

@api.patch("/admin/users/{user_id}/role")
async def update_user_role(user_id: str, data: UserRoleUpdate, admin=Depends(require_admin)):
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(404, "User not found")
    await db.users.update_one({"id": user_id}, {"$set": {"role": data.role}})
    await log_audit(admin["id"], "user_role_changed", target=user_id, meta={"new_role": data.role})
    return {"ok": True, "role": data.role}

# ---------------- VISIBILITY ----------------
@api.get("/admin/visibility-requests")
async def list_visibility_requests(admin=Depends(require_admin)):
    items = await db.visibility_requests.find({"status": "pending"}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return items

@api.post("/admin/visibility-requests/{rid}/decision")
async def decide_visibility(rid: str, data: VisibilityDecision, admin=Depends(require_admin)):
    r = await db.visibility_requests.find_one({"id": rid})
    if not r:
        raise HTTPException(404, "Request not found")
    new_status = "approved" if data.decision == "approve" else "rejected"
    await db.visibility_requests.update_one({"id": rid}, {"$set": {
        "status": new_status,
        "decision_note": data.note,
        "decided_by": admin["id"],
        "decided_at": now_utc().isoformat(),
    }})
    upd = {"visibility_status": new_status}
    if data.decision == "approve":
        upd["visibility_preference"] = r["requested_preference"]
    await db.users.update_one({"id": r["user_id"]}, {"$set": upd})
    await log_audit(admin["id"], f"visibility_{new_status}", target=r["user_id"])
    await push_notification(r["user_id"], f"Visibility request {new_status}",
                            f"Your visibility preference change was {new_status}.")
    return {"ok": True}

# ---------------- AUDIT LOGS & NOTIFS ----------------
@api.get("/admin/audit-logs")
async def audit_logs(admin=Depends(require_admin)):
    logs = await db.audit_logs.find({}, {"_id": 0}).sort("timestamp", -1).limit(500).to_list(500)
    # attach actor names
    actor_ids = list({l["actor_id"] for l in logs})
    users = await db.users.find({"id": {"$in": actor_ids}}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(1000)
    umap = {u["id"]: u for u in users}
    for l in logs:
        u = umap.get(l["actor_id"], {})
        l["actor_name"] = u.get("name", "Unknown")
        l["actor_email"] = u.get("email", "")
    return logs

@api.get("/notifications/my")
async def my_notifications(user=Depends(get_current_user)):
    items = await db.notifications.find({"user_id": user["id"]}, {"_id": 0}).sort("timestamp", -1).limit(200).to_list(200)
    return items

@api.post("/notifications/read-all")
async def read_all(user=Depends(get_current_user)):
    await db.notifications.update_many({"user_id": user["id"]}, {"$set": {"read": True}})
    return {"ok": True}

# ---------------- SETTINGS ----------------
class SettingsIn(BaseModel):
    brand_name: Optional[str] = None
    support_email: Optional[str] = None
    resend_api_key: Optional[str] = None
    resend_sender: Optional[str] = None
    twilio_account_sid: Optional[str] = None
    twilio_auth_token: Optional[str] = None
    twilio_whatsapp_from: Optional[str] = None
    frontend_url: Optional[str] = None
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    smtp_from: Optional[str] = None
    smtp_secure: Optional[bool] = None
    groq_api_key: Optional[str] = None
    groq_model: Optional[str] = None
    payment_approval_emails: Optional[str] = None  # comma-separated extra emails for payment notifications

def _mask(v: str) -> str:
    if not v: return ""
    if len(v) <= 8: return "***"
    return v[:4] + "***" + v[-4:]

@api.get("/admin/settings")
async def get_settings(admin=Depends(require_admin)):
    s = await db.settings.find_one({"key": "global"}, {"_id": 0}) or {}
    return {
        "brand_name": s.get("brand_name") or "Ajo Platform",
        "support_email": s.get("support_email") or "",
        "resend_sender": s.get("resend_sender") or "",
        "resend_api_key_masked": _mask(s.get("resend_api_key", "")),
        "twilio_account_sid_masked": _mask(s.get("twilio_account_sid", "")),
        "twilio_auth_token_masked": _mask(s.get("twilio_auth_token", "")),
        "twilio_whatsapp_from": s.get("twilio_whatsapp_from") or "",
        "frontend_url": s.get("frontend_url") or "",
        "has_resend": bool(s.get("resend_api_key")),
        "has_twilio": bool(s.get("twilio_account_sid") and s.get("twilio_auth_token") and s.get("twilio_whatsapp_from")),
        "smtp_host": s.get("smtp_host") or "",
        "smtp_port": s.get("smtp_port") or 587,
        "smtp_user": s.get("smtp_user") or "",
        "smtp_from": s.get("smtp_from") or "",
        "smtp_secure": bool(s.get("smtp_secure", False)),
        "smtp_password_masked": _mask(s.get("smtp_password", "")),
        "has_smtp": bool(s.get("smtp_host") and s.get("smtp_user") and s.get("smtp_password")),
        "groq_api_key_masked": _mask(s.get("groq_api_key", "")),
        "has_groq": bool(s.get("groq_api_key")),
        "groq_model": s.get("groq_model") or "llama-3.3-70b-versatile",
        "payment_approval_emails": s.get("payment_approval_emails") or "",
    }

@api.put("/admin/settings")
async def update_settings(data: SettingsIn, admin=Depends(require_admin)):
    update = {k: v for k, v in data.model_dump().items() if v is not None and v != ""}
    if not update:
        return {"ok": True, "changed": 0}
    update["updated_at"] = now_utc().isoformat()
    update["updated_by"] = admin["id"]
    await db.settings.update_one({"key": "global"}, {"$set": update, "$setOnInsert": {"key": "global"}}, upsert=True)
    await log_audit(admin["id"], "settings_updated", meta={"fields": list(update.keys())})
    return {"ok": True, "changed": len(update)}

def _get_fe_url(settings: dict, request: Request = None) -> str:
    raw = settings.get("frontend_url") or os.environ.get("FRONTEND_URL", "")
    return raw.split(',')[0].strip().rstrip('/')

# ---------------- INVITATIONS ----------------
class InviteCreate(BaseModel):
    group_id: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    send_email: bool = True
    send_whatsapp: bool = False
    note: Optional[str] = ""

@api.post("/admin/invitations")
async def create_invite(data: InviteCreate, admin=Depends(require_admin)):
    group = await db.groups.find_one({"id": data.group_id}, {"_id": 0})
    if not group:
        raise HTTPException(404, "Group not found")
    if not data.email and not data.phone:
        raise HTTPException(400, "Provide email or phone")
    token = uuid.uuid4().hex
    inv = {
        "id": str(uuid.uuid4()),
        "token": token,
        "group_id": data.group_id,
        "group_name": group["name"],
        "email": (data.email or "").lower(),
        "phone": data.phone or "",
        "note": data.note or "",
        "status": "pending",
        "created_by": admin["id"],
        "created_at": now_utc().isoformat(),
        "expires_at": (now_utc() + timedelta(days=14)).isoformat(),
        "accepted_at": None,
        "accepted_user_id": None,
    }
    await db.invitations.insert_one(inv.copy())
    settings = await db.settings.find_one({"key": "global"}, {"_id": 0}) or {}
    fe = _get_fe_url(settings)
    invite_url = f"{fe}/invite/{token}"
    msg_body = f"You're invited to join '{group['name']}' on {settings.get('brand_name') or 'Ajo Platform'}. Accept here: {invite_url}"
    sent = {"email": False, "whatsapp": False}
    if data.send_email and data.email:
        sent["email"] = await send_email(db, data.email, f"Invitation to {group['name']}",
                         f"You're invited to {group['name']}",
                         f"An admin has invited you to join the Ajo group <b>{group['name']}</b>. "
                         f"Click the button to review the group rules and accept the invitation.<br><br>"
                         f"{'<i>Note from admin: ' + data.note + '</i>' if data.note else ''}",
                         cta_label="Review & accept", cta_link=invite_url)
    if data.send_whatsapp and data.phone:
        sent["whatsapp"] = await send_whatsapp(db, data.phone, msg_body)
    await db.invitations.update_one({"id": inv["id"]}, {"$set": {"sent": sent}})
    await log_audit(admin["id"], "invite_created", target=data.group_id,
                    meta={"email": data.email, "phone": data.phone, "sent": sent})
    inv["sent"] = sent
    inv["invite_url"] = invite_url
    return inv

@api.get("/admin/invitations")
async def list_invites(group_id: Optional[str] = None, admin=Depends(require_admin)):
    q = {"group_id": group_id} if group_id else {}
    items = await db.invitations.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return items

@api.delete("/admin/invitations/{invite_id}")
async def revoke_invite(invite_id: str, admin=Depends(require_admin)):
    await db.invitations.update_one({"id": invite_id}, {"$set": {"status": "revoked"}})
    await log_audit(admin["id"], "invite_revoked", target=invite_id)
    return {"ok": True}

@api.get("/invite/{token}")
async def view_invite(token: str):
    inv = await db.invitations.find_one({"token": token}, {"_id": 0})
    if not inv:
        raise HTTPException(404, "Invitation not found")
    if inv["status"] not in ("pending", "accepted"):
        return {"status": inv["status"], "group_name": inv.get("group_name", "")}
    group = await db.groups.find_one({"id": inv["group_id"]}, {"_id": 0})
    if not group:
        raise HTTPException(404, "Group no longer exists")
    expired = inv.get("expires_at") and now_utc().isoformat() > inv["expires_at"]
    return {
        "status": "expired" if expired else inv["status"],
        "invitation": {
            "token": inv["token"],
            "email": inv["email"],
            "phone": inv["phone"],
            "note": inv["note"],
            "expires_at": inv["expires_at"],
        },
        "group": {
            "id": group["id"],
            "name": group["name"],
            "description": group.get("description", ""),
            "contribution_amount": group["contribution_amount"],
            "frequency": group["frequency"],
            "total_cycles": group["total_cycles"],
            "start_date": group["start_date"],
            "due_day": group["due_day"],
            "due_time": group["due_time"],
            "first_payment_fee": group.get("first_payment_fee", 0),
            "late_fee_amount": group.get("late_fee_amount", 0),
            "grace_period_days": group.get("grace_period_days", 0),
            "rules_text": group.get("rules_text", ""),
            "whatsapp_group_name": group.get("whatsapp_group_name", ""),
        },
    }

class AcceptIn(BaseModel):
    name: Optional[str] = None
    password: Optional[str] = None
    accepted_rules: bool

@api.post("/invite/{token}/accept")
async def accept_invite(token: str, data: AcceptIn, request: Request, response: Response):
    if not data.accepted_rules:
        raise HTTPException(400, "You must accept the group rules to join.")
    inv = await db.invitations.find_one({"token": token})
    if not inv or inv["status"] != "pending":
        raise HTTPException(400, "Invitation not available")
    if inv.get("expires_at") and now_utc().isoformat() > inv["expires_at"]:
        await db.invitations.update_one({"id": inv["id"]}, {"$set": {"status": "expired"}})
        raise HTTPException(400, "Invitation expired")
    group = await db.groups.find_one({"id": inv["group_id"]}, {"_id": 0})
    if not group:
        raise HTTPException(404, "Group not found")

    current_user = None
    # Check Bearer token first (more reliable on mobile), then cookie
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        bearer = auth_header[7:]
        try:
            payload = jwt.decode(bearer, JWT_SECRET, algorithms=[JWT_ALG])
            current_user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
        except Exception:
            pass

    if not current_user:
        cookie_tok = request.cookies.get("access_token")
        if cookie_tok:
            try:
                payload = jwt.decode(cookie_tok, JWT_SECRET, algorithms=[JWT_ALG])
                current_user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
            except Exception:
                pass

    if current_user and inv.get("email") and current_user["email"].lower() != inv["email"].lower():
        raise HTTPException(403, f"This invitation was sent to {inv['email']}. Please sign in with that email address to continue.")

    if not current_user:
        email = inv["email"]
        if not email:
            raise HTTPException(400, "This invitation requires email sign-up.")
        existing = await db.users.find_one({"email": email}, {"_id": 0})
        if existing:
            raise HTTPException(409, "An account with this email already exists. Please log in first, then reopen the invitation link.")
        if not data.name or not data.password or len(data.password) < 6:
            raise HTTPException(400, "Name and a 6+ char password are required to create an account.")
        user_id = str(uuid.uuid4())
        new_user = {
            "id": user_id, "email": email, "name": data.name,
            "password_hash": hash_pw(data.password), "role": "member",
            "phone": inv.get("phone", ""),
            "bank_name": "", "bank_account_number": "", "bank_account_name": "",
            "visibility_preference": "visible", "visibility_status": "approved",
            "created_at": now_utc().isoformat(),
        }
        await db.users.insert_one(new_user.copy())
        current_user = new_user
        tok = make_token(user_id, email, "member")
        set_auth_cookie(response, tok)

    already = await db.group_members.find_one({"group_id": group["id"], "user_id": current_user["id"]})
    if not already:
        count = await db.group_members.count_documents({"group_id": group["id"]})
        if count >= group["member_limit"]:
            raise HTTPException(400, "Group member limit reached")
        position = count + 1
        gm = {
            "id": str(uuid.uuid4()),
            "group_id": group["id"],
            "user_id": current_user["id"],
            "user_email": current_user["email"],
            "user_name": current_user["name"],
            "payout_position": position,
            "joined_at": now_utc().isoformat(),
            "status": "active",
            "rules_accepted_at": now_utc().isoformat(),
            "joined_via": "invitation",
        }
        await db.group_members.insert_one(gm.copy())
        cycles = await db.cycles.find({"group_id": group["id"]}).to_list(1000)
        today = now_utc().date()
        docs = []
        for c in cycles:
            due = date.fromisoformat(c["due_date"])
            sv = "Due" if due <= today else "Not_Due"
            docs.append({
                "id": str(uuid.uuid4()),
                "group_id": group["id"],
                "cycle_no": c["cycle_no"],
                "user_id": current_user["id"],
                "status": sv,
                "expected_amount": c["expected_amount"],
                "paid_amount": 0,
                "approved_at": None,
                "approver_id": None,
                "updated_at": now_utc().isoformat(),
            })
        if docs:
            await db.member_cycle_status.insert_many(docs)
        cycle = await db.cycles.find_one({"group_id": group["id"], "cycle_no": position})
        if cycle and not cycle.get("payout_user_id"):
            await db.cycles.update_one({"id": cycle["id"]}, {"$set": {"payout_user_id": current_user["id"]}})

    await db.invitations.update_one({"id": inv["id"]}, {"$set": {
        "status": "accepted",
        "accepted_at": now_utc().isoformat(),
        "accepted_user_id": current_user["id"],
    }})
    await log_audit(current_user["id"], "invite_accepted", target=group["id"])
    await push_notification(current_user["id"], "Joined group",
                            f"You successfully joined '{group['name']}'.",
                            link=f"/groups/{group['id']}")
    safe_user = {k: v for k, v in current_user.items() if k != "password_hash"}
    return {"ok": True, "group_id": group["id"], "user": safe_user}

# ---------------- OPEN GROUP JOIN LINK ----------------

@api.get("/admin/groups/{group_id}/join-link")
async def get_group_join_link(group_id: str, admin=Depends(require_admin)):
    group = await db.groups.find_one({"id": group_id}, {"_id": 0, "id": 1, "join_token": 1})
    if group is None:
        raise HTTPException(404, "Group not found")
    if not group.get("join_token"):
        new_token = uuid.uuid4().hex
        await db.groups.update_one({"id": group_id}, {"$set": {"join_token": new_token}})
        return {"join_token": new_token}
    return {"join_token": group["join_token"]}

@api.post("/admin/groups/{group_id}/regenerate-join-link")
async def regenerate_group_join_link(group_id: str, admin=Depends(require_admin)):
    new_token = uuid.uuid4().hex
    result = await db.groups.update_one({"id": group_id}, {"$set": {"join_token": new_token}})
    if result.matched_count == 0:
        raise HTTPException(404, "Group not found")
    await log_audit(admin["id"], "join_link_regenerated", target=group_id)
    return {"join_token": new_token}

@api.get("/join/{token}")
async def view_group_join(token: str):
    group = await db.groups.find_one({"join_token": token}, {"_id": 0})
    if not group:
        raise HTTPException(404, "Join link not found or expired")
    if group.get("status") != "active":
        return {"status": group["status"], "group_name": group["name"]}
    count = await db.group_members.count_documents({"group_id": group["id"]})
    return {
        "status": "active",
        "group": {
            "id": group["id"],
            "name": group["name"],
            "description": group.get("description", ""),
            "contribution_amount": group["contribution_amount"],
            "frequency": group["frequency"],
            "total_cycles": group["total_cycles"],
            "start_date": group["start_date"],
            "due_day": group["due_day"],
            "due_time": group["due_time"],
            "first_payment_fee": group.get("first_payment_fee", 0),
            "late_fee_amount": group.get("late_fee_amount", 0),
            "grace_period_days": group.get("grace_period_days", 0),
            "rules_text": group.get("rules_text", ""),
            "member_limit": group.get("member_limit", 12),
            "members_count": count,
        }
    }

class JoinIn(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    accepted_rules: bool

@api.post("/join/{token}/accept")
async def accept_group_join(token: str, data: JoinIn, request: Request, response: Response):
    if not data.accepted_rules:
        raise HTTPException(400, "You must accept the group rules to join.")
    group = await db.groups.find_one({"join_token": token}, {"_id": 0})
    if not group:
        raise HTTPException(404, "Join link not found or expired")
    if group.get("status") != "active":
        raise HTTPException(400, f"Group is {group.get('status', 'unavailable')}")

    current_user = None
    # Check Bearer token first (more reliable on mobile), then cookie
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        bearer = auth_header[7:]
        try:
            payload = jwt.decode(bearer, JWT_SECRET, algorithms=[JWT_ALG])
            current_user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
        except Exception:
            pass

    if not current_user:
        cookie_tok = request.cookies.get("access_token")
        if cookie_tok:
            try:
                payload = jwt.decode(cookie_tok, JWT_SECRET, algorithms=[JWT_ALG])
                current_user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
            except Exception:
                pass

    new_token_str = None
    if not current_user:
        if not data.email or not data.name or not data.password or len(data.password) < 6:
            raise HTTPException(400, "Name, email and a 6+ character password are required to create your account.")
        email_lc = data.email.lower()
        existing = await db.users.find_one({"email": email_lc}, {"_id": 0})
        if existing:
            raise HTTPException(409, "An account with this email already exists. Please log in first, then reopen the link.")
        user_id = str(uuid.uuid4())
        new_user = {
            "id": user_id, "email": email_lc, "name": data.name,
            "password_hash": hash_pw(data.password), "role": "member",
            "phone": "",
            "bank_name": "", "bank_account_number": "", "bank_account_name": "",
            "visibility_preference": "visible", "visibility_status": "approved",
            "created_at": now_utc().isoformat(),
        }
        await db.users.insert_one(new_user.copy())
        current_user = new_user
        new_token_str = make_token(user_id, email_lc, "member")
        set_auth_cookie(response, new_token_str)

    already = await db.group_members.find_one({"group_id": group["id"], "user_id": current_user["id"]})
    if already:
        safe = {k: v for k, v in current_user.items() if k != "password_hash"}
        return {"ok": True, "group_id": group["id"], "user": safe, **({"token": new_token_str} if new_token_str else {})}

    count = await db.group_members.count_documents({"group_id": group["id"]})
    if count >= group["member_limit"]:
        raise HTTPException(400, "Group member limit reached")

    position = count + 1
    gm = {
        "id": str(uuid.uuid4()),
        "group_id": group["id"],
        "user_id": current_user["id"],
        "user_email": current_user["email"],
        "user_name": current_user["name"],
        "payout_position": position,
        "joined_at": now_utc().isoformat(),
        "status": "active",
        "rules_accepted_at": now_utc().isoformat(),
        "joined_via": "join_link",
    }
    await db.group_members.insert_one(gm.copy())
    cycles = await db.cycles.find({"group_id": group["id"]}).to_list(1000)
    today = now_utc().date()
    docs = []
    for c in cycles:
        due = date.fromisoformat(c["due_date"])
        sv = "Due" if due <= today else "Not_Due"
        docs.append({
            "id": str(uuid.uuid4()), "group_id": group["id"],
            "cycle_no": c["cycle_no"], "user_id": current_user["id"],
            "status": sv, "expected_amount": c["expected_amount"],
            "paid_amount": 0, "approved_at": None, "approver_id": None,
            "updated_at": now_utc().isoformat(),
        })
    if docs:
        await db.member_cycle_status.insert_many(docs)
    cycle = await db.cycles.find_one({"group_id": group["id"], "cycle_no": position})
    if cycle and not cycle.get("payout_user_id"):
        await db.cycles.update_one({"id": cycle["id"]}, {"$set": {"payout_user_id": current_user["id"]}})
    await log_audit(current_user["id"], "group_joined_via_link", target=group["id"])
    await push_notification(current_user["id"], "Joined group",
                            f"You successfully joined '{group['name']}'.",
                            link=f"/groups/{group['id']}")
    safe = {k: v for k, v in current_user.items() if k != "password_hash"}
    return {"ok": True, "group_id": group["id"], "user": safe, **({"token": new_token_str} if new_token_str else {})}

# ---------------- GROUP COMMENTS ----------------
class CommentIn(BaseModel):
    body: str
    cycle_no: Optional[int] = None

@api.get("/groups/{group_id}/comments")
async def list_comments(group_id: str, user=Depends(get_current_user)):
    is_admin = user["role"] in ("admin", "super_admin")
    is_member = await db.group_members.find_one({"group_id": group_id, "user_id": user["id"]})
    if not is_admin and not is_member:
        raise HTTPException(403, "Not a member of this group")
    items = await db.group_comments.find({"group_id": group_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
    if items:
        user_ids = list({c["user_id"] for c in items})
        docs = await db.users.find({"id": {"$in": user_ids}},
                                   {"_id": 0, "id": 1, "name": 1, "display_name": 1, "use_alias": 1}).to_list(1000)
        dmap = {u["id"]: u for u in docs}
        for c in items:
            u = dmap.get(c["user_id"], {})
            c["user_name"] = display_name_for(u, is_admin)
            # tag if current viewer is author
            c["is_self"] = (c["user_id"] == user["id"])
    return items

@api.post("/groups/{group_id}/comments")
async def post_comment(group_id: str, data: CommentIn, user=Depends(get_current_user)):
    group = await db.groups.find_one({"id": group_id})
    if not group:
        raise HTTPException(404, "Group not found")
    is_admin = user["role"] in ("admin", "super_admin")
    if not group.get("enable_comments", True) and not is_admin:
        raise HTTPException(403, "Comments are disabled by admin")
    is_member = await db.group_members.find_one({"group_id": group_id, "user_id": user["id"]})
    if not is_admin and not is_member:
        raise HTTPException(403, "Not a member of this group")
    if not data.body.strip():
        raise HTTPException(400, "Empty comment")
    # stored with author's real name; display layer resolves alias per viewer
    doc = {
        "id": str(uuid.uuid4()),
        "group_id": group_id,
        "user_id": user["id"],
        "user_name": user["name"],
        "is_admin": is_admin,
        "cycle_no": data.cycle_no,
        "body": data.body.strip()[:2000],
        "created_at": now_utc().isoformat(),
    }
    await db.group_comments.insert_one(doc.copy())
    # broadcast: light notification when admin posts or a cycle-tagged message
    if is_admin:
        await notify_group(group_id, "Admin posted in chat",
                           data.body.strip()[:120], link=f"/groups/{group_id}", exclude=user["id"])
    # apply display-name for the response (so sender sees it consistent)
    doc["user_name"] = display_name_for(user, is_admin)
    doc["is_self"] = True
    return doc

@api.delete("/groups/{group_id}/comments/{comment_id}")
async def delete_comment(group_id: str, comment_id: str, user=Depends(get_current_user)):
    c = await db.group_comments.find_one({"id": comment_id, "group_id": group_id})
    if not c:
        raise HTTPException(404, "Comment not found")
    if c["user_id"] != user["id"] and user["role"] not in ("admin", "super_admin"):
        raise HTTPException(403, "Cannot delete others' comments")
    await db.group_comments.delete_one({"id": comment_id})
    return {"ok": True}

class BroadcastIn(BaseModel):
    title: str
    body: str
    group_id: Optional[str] = None  # None = all groups

@api.get("/admin/email-config")
async def email_config_check(admin=Depends(require_admin)):
    """Return what email channel and sender are currently active — no secrets exposed."""
    s = await db.settings.find_one({"key": "global"}, {"_id": 0}) or {}
    smtp_host = s.get("smtp_host") or os.environ.get("SMTP_HOST", "")
    smtp_user = s.get("smtp_user") or os.environ.get("SMTP_USER", "")
    smtp_pw   = s.get("smtp_password") or os.environ.get("SMTP_PASSWORD", "")
    has_smtp  = bool(smtp_host and smtp_user and smtp_pw)
    resend_key    = s.get("resend_api_key") or os.environ.get("RESEND_API_KEY", "")
    resend_sender = s.get("resend_sender") or os.environ.get("SENDER_EMAIL", "")
    has_resend    = bool(resend_key and resend_sender)
    return {
        "smtp": {
            "configured": has_smtp,
            "host": smtp_host,
            "port": int(s.get("smtp_port") or os.environ.get("SMTP_PORT", 587)),
            "user": smtp_user,
            "from": s.get("smtp_from") or smtp_user,
            "secure": bool(s.get("smtp_secure", False)),
        },
        "resend": {
            "configured": has_resend,
            "key_set": bool(resend_key),
            "sender": resend_sender or "(NOT SET — emails will fail)",
        },
        "active_channel": "smtp" if has_smtp else ("resend" if has_resend else "none"),
    }

@api.post("/admin/test-email")
async def test_email_endpoint(admin=Depends(require_admin)):
    """Send a test email to the calling admin so they can verify SMTP / Resend config."""
    ok, err = await send_email_with_error(
        db,
        admin["email"],
        "Ajo Platform — test email",
        "Email delivery test",
        "If you received this, your email configuration is working correctly. "
        "Broadcasts and notifications will be delivered by the same channel.",
        cta_label="Go to Admin",
        cta_link=_primary_fe_url(),
    )
    if not ok:
        raise HTTPException(500, err or "Email delivery failed. Check SMTP / Resend settings.")
    return {"ok": True, "sent_to": admin["email"]}

@api.post("/admin/broadcast")
async def admin_broadcast(data: BroadcastIn, admin=Depends(require_admin)):
    """Admin broadcasts in-app notification + email to all members of a group (or all groups)."""
    settings = await db.settings.find_one({"key": "global"}, {"_id": 0}) or {}
    fe = _get_fe_url(settings)

    async def _email_members(group_id: str, group_name: str, sent: set):
        mems = await db.group_members.find(
            {"group_id": group_id, "status": {"$ne": "removed"}}).to_list(1000)
        for m in mems:
            if m["user_id"] in sent:
                continue
            u = await db.users.find_one({"id": m["user_id"]}, {"_id": 0})
            if u and u.get("email"):
                await send_email(
                    db, u["email"],
                    f"{data.title}",
                    data.title, data.body,
                    cta_label=f"View {group_name}",
                    cta_link=f"{fe}/groups/{group_id}"
                )
                sent.add(m["user_id"])
        return mems

    if data.group_id:
        group = await db.groups.find_one({"id": data.group_id}, {"_id": 0})
        gname = group["name"] if group else "group"
        await notify_group(data.group_id, data.title, data.body, link=f"/groups/{data.group_id}")
        mems = await _email_members(data.group_id, gname, set())
        await log_audit(admin["id"], "admin_broadcast",
                        meta={"scope": data.group_id, "members": len(mems)})
        return {"ok": True, "scope": "group", "members": len(mems)}

    groups = await db.groups.find({"status": "active"}).to_list(1000)
    sent: set = set()
    for g in groups:
        await notify_group(g["id"], data.title, data.body, link=f"/groups/{g['id']}")
        await _email_members(g["id"], g["name"], sent)
    await log_audit(admin["id"], "admin_broadcast",
                    meta={"scope": "all", "groups": len(groups), "members": len(sent)})
    return {"ok": True, "scope": "all", "groups": len(groups)}

# ---------------- PAYMENT REMINDER ----------------
class PaymentReminderIn(BaseModel):
    custom_message: Optional[str] = None  # optional extra note from admin

@api.post("/admin/groups/{group_id}/payment-reminder")
async def send_payment_reminder(group_id: str, data: PaymentReminderIn, admin=Depends(require_admin)):
    """Send a payment reminder email + in-app notification to every member who hasn't paid
    for the current active cycle. Members who have already submitted/paid are automatically skipped."""
    g = await db.groups.find_one({"id": group_id}, {"_id": 0})
    if not g:
        raise HTTPException(404, "Group not found")
    settings_doc = await db.settings.find_one({"key": "global"}, {"_id": 0}) or {}
    fe = _get_fe_url(settings_doc)
    brand = settings_doc.get("brand_name") or "Ajo Platform"

    # Find the active cycle
    first_pending = await db.cycles.find(
        {"group_id": group_id, "payout_status": {"$ne": "completed"}},
        {"_id": 0, "cycle_no": 1, "due_date": 1}
    ).sort("cycle_no", 1).limit(1).to_list(1)
    if not first_pending:
        raise HTTPException(400, "No active cycle found for this group — all cycles are completed.")
    active_cycle = first_pending[0]
    cycle_no = active_cycle["cycle_no"]
    due_date_str = active_cycle.get("due_date", "")

    # Statuses that mean the member has already paid / is in review
    PAID_STATUSES = {"Submitted", "Paid", "Payout_Completed", "Approved"}

    # Get all member_cycle_status rows for the active cycle
    cycle_statuses = await db.member_cycle_status.find(
        {"group_id": group_id, "cycle_no": cycle_no},
        {"_id": 0, "user_id": 1, "status": 1, "expected_amount": 1}
    ).to_list(1000)
    status_by_user = {s["user_id"]: s for s in cycle_statuses}

    members = await db.group_members.find(
        {"group_id": group_id, "status": {"$ne": "removed"}},
        {"_id": 0, "user_id": 1}
    ).to_list(1000)

    sent_count = 0
    skipped_count = 0
    for m in members:
        uid = m["user_id"]
        st = status_by_user.get(uid, {})
        member_status = st.get("status", "Due")
        expected_amount = st.get("expected_amount") or g.get("contribution_amount", 0)

        if member_status in PAID_STATUSES:
            skipped_count += 1
            continue

        u = await db.users.find_one({"id": uid}, {"_id": 0})
        if not u:
            continue
        name = u.get("name", "Member")
        email_addr = u.get("email", "")

        status_note = ""
        if member_status == "Overdue":
            status_note = "<p style='color:#b91c1c;font-weight:600'>⚠️ Your payment is overdue. Please pay as soon as possible to avoid penalties.</p>"
        elif member_status == "Due":
            status_note = "<p style='color:#b45309;font-weight:600'>Your payment is now due for this month.</p>"
        else:
            due_display = fmtdate_simple(due_date_str)
            status_note = f"<p>Your contribution for this month is coming up (due {due_display}).</p>"

        custom_note = f"<p><em>{data.custom_message}</em></p>" if data.custom_message else ""

        body_html = (
            f"<p>Hi <b>{name}</b>,</p>"
            f"{status_note}"
            f"<p><b>Group:</b> {g['name']}<br>"
            f"<b>Month:</b> Cycle {cycle_no}"
            + (f"<br><b>Due date:</b> {fmtdate_simple(due_date_str)}" if due_date_str else "")
            + f"<br><b>Amount:</b> ₦{expected_amount:,.0f}</p>"
            + custom_note
            + "<p>Please log in and upload your payment proof to confirm your contribution.</p>"
        )
        subject = f"💳 Payment reminder — {g['name']} (Month {cycle_no})"

        if email_addr:
            await send_email(db, email_addr, subject, "Payment Reminder", body_html,
                             cta_label="Pay now", cta_link=f"{fe}/groups/{group_id}")
        await push_notification(uid, f"Payment reminder — {g['name']}",
                                f"Month {cycle_no} payment of ₦{expected_amount:,.0f} is {member_status.lower()}.",
                                link=f"/groups/{group_id}")
        sent_count += 1

    await log_audit(admin["id"], "payment_reminder_sent",
                    meta={"group_id": group_id, "cycle_no": cycle_no,
                          "sent": sent_count, "skipped_already_paid": skipped_count})
    return {
        "ok": True,
        "cycle_no": cycle_no,
        "sent": sent_count,
        "skipped_already_paid": skipped_count,
        "message": f"Reminder sent to {sent_count} member{'s' if sent_count != 1 else ''}. "
                   f"{skipped_count} already paid member{'s' if skipped_count != 1 else ''} skipped."
    }


def fmtdate_simple(iso: str) -> str:
    """Format YYYY-MM-DD to '5 Jul 2026'."""
    try:
        from datetime import date as _date
        d = _date.fromisoformat(iso)
        return d.strftime("%-d %b %Y") if hasattr(d, "strftime") else iso
    except Exception:
        return iso


# ---------------- AI-POWERED MESSAGING ----------------
class AIMessageIn(BaseModel):
    prompt: str
    context: Optional[str] = None  # e.g., "remind unpaid members for cycle 3"
    group_id: Optional[str] = None

class TargetedMessageIn(BaseModel):
    title: str
    body: str
    group_id: Optional[str] = None  # Optional: if provided, link to group
    user_ids: List[str]  # specific recipients
    payment_status_filter: Optional[Literal["Due", "Overdue", "Paid", "Submitted", "Not_Due"]] = None

@api.post("/admin/ai/generate-message")
async def generate_ai_message(data: AIMessageIn, admin=Depends(require_admin)):
    """Generate a message using AI based on admin's prompt. Returns preview only — doesn't send."""
    s = await db.settings.find_one({"key": "global"}, {"_id": 0}) or {}
    api_key = s.get("groq_api_key")
    if not api_key:
        raise HTTPException(400, "Groq API key not configured. Go to Admin Settings → AI Assistant to add it.")
    model = s.get("groq_model") or "llama-3.3-70b-versatile"
    
    # Build context about the group if provided
    group_context = ""
    if data.group_id:
        group = await db.groups.find_one({"id": data.group_id}, {"_id": 0})
        if group:
            group_context = f"\nGroup: {group['name']}\nContribution: {group['contribution_amount']} NGN\nFrequency: {group['frequency']}"
    
    system_prompt = """You are an Ajo (savings group) admin assistant. Write short, friendly, professional messages for group members.
Keep messages under 150 words. Be encouraging but clear about payment expectations.
Format your response as JSON with keys: "title" (short subject line) and "body" (message content)."""
    
    user_prompt = f"Prompt: {data.prompt}\n{data.context or ''}{group_context}"
    
    try:
        raw = await call_groq(api_key, system_prompt, user_prompt, model)
        import json
        # Try to parse JSON directly
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            # If raw response isn't JSON, try to extract JSON from markdown code blocks
            import re
            json_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', raw, re.DOTALL)
            if json_match:
                parsed = json.loads(json_match.group(1))
            else:
                # Fallback: try to find any JSON-like structure
                json_match = re.search(r'\{.*?\}', raw, re.DOTALL)
                if json_match:
                    parsed = json.loads(json_match.group(0))
                else:
                    raise HTTPException(500, f"AI returned non-JSON response: {raw[:500]}")
        return {"title": parsed.get("title", ""), "body": parsed.get("body", "")}
    except Exception as e:
        raise HTTPException(500, f"AI generation failed: {str(e)}")

@api.post("/admin/send-targeted")
async def send_targeted_message(data: TargetedMessageIn, admin=Depends(require_admin)):
    """Send message to specific users. Can filter by payment status within a group, or send to specific user_ids without group context."""
    settings = await db.settings.find_one({"key": "global"}, {"_id": 0}) or {}
    fe = _get_fe_url(settings)
    
    # Determine recipients
    recipients = []
    
    if data.payment_status_filter:
        # Filter by payment status - requires group_id
        if not data.group_id:
            raise HTTPException(400, "group_id is required when using payment_status_filter")
        group = await db.groups.find_one({"id": data.group_id}, {"_id": 0})
        if not group:
            raise HTTPException(404, "Group not found")
        active_rec = await db.member_cycle_status.find(
            {"group_id": data.group_id, "status": data.payment_status_filter},
            {"_id": 0, "user_id": 1}
        ).to_list(1000)
        recipients = [r["user_id"] for r in active_rec]
    
    # Add explicitly specified user_ids
    for uid in data.user_ids:
        if uid not in recipients:
            recipients.append(uid)
    
    if not recipients:
        return {"ok": True, "sent": 0, "message": "No recipients matched the criteria"}
    
    # Send to each recipient
    sent_count = 0
    for user_id in recipients:
        u = await db.users.find_one({"id": user_id}, {"_id": 0})
        if u and u.get("email"):
            # If group_id provided, link to group; otherwise link to dashboard
            if data.group_id:
                group = await db.groups.find_one({"id": data.group_id}, {"_id": 0})
                cta_label = f"View {group['name']}" if group else "View Dashboard"
                cta_link = f"{fe}/groups/{data.group_id}"
                notification_link = f"/groups/{data.group_id}"
            else:
                cta_label = "View Dashboard"
                cta_link = f"{fe}/dashboard"
                notification_link = "/dashboard"
            
            await send_email(
                db, u["email"],
                data.title, data.title, data.body,
                cta_label=cta_label,
                cta_link=cta_link
            )
            await push_notification(user_id, data.title, data.body, link=notification_link)
            sent_count += 1
    
    await log_audit(admin["id"], "targeted_message_sent",
                    meta={"group_id": data.group_id, "recipients": sent_count, "filter": data.payment_status_filter})
    
    return {"ok": True, "sent": sent_count}

# ---------------- MANUAL LEDGER MANAGEMENT ----------------
class ManualLedgerUpdate(BaseModel):
    group_id: str
    user_id: str
    cycle_no: int
    status: Literal["Not_Due", "Due", "Overdue", "Submitted", "Paid", "Rejected", "Payout_Completed"]
    paid_amount: Optional[float] = None
    note: Optional[str] = None

@api.post("/admin/ledger/manual-update")
async def manual_ledger_update(data: ManualLedgerUpdate, admin=Depends(require_admin)):
    """Allow admin to manually update a member's cycle status in the ledger."""
    # Verify group exists
    group = await db.groups.find_one({"id": data.group_id}, {"_id": 0})
    if not group:
        raise HTTPException(404, "Group not found")
    
    # Verify cycle exists
    cycle = await db.cycles.find_one({"group_id": data.group_id, "cycle_no": data.cycle_no}, {"_id": 0})
    if not cycle:
        raise HTTPException(404, "Cycle not found")
    
    # Verify user is a member
    member = await db.group_members.find_one({"group_id": data.group_id, "user_id": data.user_id}, {"_id": 0})
    if not member:
        raise HTTPException(404, "User is not a member of this group")
    
    # Build update document
    update_doc = {
        "status": data.status,
        "updated_at": now_utc().isoformat(),
        "manual_override": True,
        "manual_override_by": admin["id"],
        "manual_override_at": now_utc().isoformat(),
    }
    
    if data.paid_amount is not None:
        update_doc["paid_amount"] = data.paid_amount
    if data.note:
        update_doc["manual_override_note"] = data.note
    
    # Update or create the member_cycle_status record
    result = await db.member_cycle_status.update_one(
        {"group_id": data.group_id, "cycle_no": data.cycle_no, "user_id": data.user_id},
        {"$set": update_doc},
        upsert=True
    )
    
    await log_audit(admin["id"], "manual_ledger_update",
                    meta={"group_id": data.group_id, "user_id": data.user_id, 
                          "cycle_no": data.cycle_no, "status": data.status, 
                          "note": data.note})
    
    return {"ok": True, "updated": result.modified_count > 0 or result.upserted_id is not None}

@api.get("/admin/ledger/{group_id}/{user_id}")
async def get_member_ledger(group_id: str, user_id: str, admin=Depends(require_admin)):
    """Get full ledger history for a specific member in a group."""
    statuses = await db.member_cycle_status.find(
        {"group_id": group_id, "user_id": user_id},
        {"_id": 0}
    ).sort("cycle_no", 1).to_list(200)
    
    # Add cycle due dates
    for s in statuses:
        cycle = await db.cycles.find_one(
            {"group_id": group_id, "cycle_no": s["cycle_no"]},
            {"_id": 0, "due_date": 1}
        )
        s["due_date"] = cycle["due_date"] if cycle else None
    
    return {"ledger": statuses}

# ---------------- MIDDLEWARE & LOGGING ----------------
_raw_origins = os.environ.get("FRONTEND_URL", "http://localhost:3000")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ajo")

# ---------------- STARTUP ----------------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    # Drop old (group_id, user_id) unique index that prevents multi-slot members
    try:
        await db.group_members.drop_index("group_id_1_user_id_1")
    except Exception:
        pass
    # Uniqueness is per slot position, not per user — allows same user at multiple positions
    await db.group_members.create_index([("group_id", 1), ("payout_position", 1)], unique=True)
    # Also drop old member_cycle_status unique index if it blocks per-slot records
    try:
        await db.member_cycle_status.drop_index("group_id_1_cycle_no_1_user_id_1")
    except Exception:
        pass
    await db.member_cycle_status.create_index([("group_id", 1), ("cycle_no", 1), ("user_id", 1)], unique=True)
    await db.cycles.create_index([("group_id", 1), ("cycle_no", 1)], unique=True)
    # Seed admin
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@ajo.com").lower()
    admin_pw = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": admin_email,
            "name": "Platform Admin",
            "password_hash": hash_pw(admin_pw),
            "role": "super_admin",
            "phone": "",
            "bank_name": "",
            "bank_account_number": "",
            "bank_account_name": "",
            "visibility_preference": "visible",
            "visibility_status": "approved",
            "created_at": now_utc().isoformat(),
        })
        logger.info(f"Seeded admin: {admin_email}")
    # Seed extra super_admin from env if provided
    extra_email = os.environ.get("EXTRA_ADMIN_EMAIL", "").lower()
    extra_pw = os.environ.get("EXTRA_ADMIN_PASSWORD", "")
    extra_name = os.environ.get("EXTRA_ADMIN_NAME", "Admin")
    if extra_email and extra_pw:
        if not await db.users.find_one({"email": extra_email}):
            await db.users.insert_one({
                "id": str(uuid.uuid4()),
                "email": extra_email,
                "name": extra_name,
                "password_hash": hash_pw(extra_pw),
                "role": "super_admin",
                "phone": "",
                "bank_name": "",
                "bank_account_number": "",
                "bank_account_name": "",
                "visibility_preference": "visible",
                "visibility_status": "approved",
                "created_at": now_utc().isoformat(),
            })
            logger.info(f"Seeded extra admin: {extra_email}")
    # Seed initial settings ONCE (admin can edit via UI after)
    existing_settings = await db.settings.find_one({"key": "global"})
    if not existing_settings:
        init_resend = os.environ.get("INITIAL_RESEND_API_KEY", "")
        init_sender = os.environ.get("INITIAL_SENDER_EMAIL", "")
        init_fe = os.environ.get("FRONTEND_URL", "")
        await db.settings.insert_one({
            "key": "global",
            "brand_name": "Ajo Platform",
            "support_email": "",
            "resend_api_key": init_resend,
            "resend_sender": init_sender,
            "twilio_account_sid": "",
            "twilio_auth_token": "",
            "twilio_whatsapp_from": "",
            "frontend_url": init_fe,
            "created_at": now_utc().isoformat(),
        })
        logger.info("Seeded initial settings doc")
    await db.invitations.create_index("token", unique=True)
    await db.group_comments.create_index([("group_id", 1), ("created_at", -1)])

async def _build_member_email_content(uid: str, email_type: str, brand: str, fe: str, groq_key: str, model: str) -> dict | None:
    """Shared logic: build beautiful email content for one member without sending."""
    user_doc = await db.users.find_one({"id": uid}, {"_id": 0})
    if not user_doc or not user_doc.get("email"):
        return None
    memberships = await db.group_members.find({"user_id": uid}).to_list(100)
    if not memberships:
        return None

    groups_data, total_monthly, seen = [], 0.0, set()
    ai_context_lines = []

    for mem in memberships:
        gid = mem["group_id"]
        if gid in seen:
            continue
        seen.add(gid)
        g = await db.groups.find_one({"id": gid}, {"_id": 0})
        if not g:
            continue
        slots = await db.group_members.find({"group_id": gid, "user_id": uid}).to_list(10)
        positions = sorted([s["payout_position"] for s in slots if s.get("payout_position") is not None])
        total_members = await db.group_members.count_documents({"group_id": gid})
        monthly = g["contribution_amount"] * max(len(positions), 1)
        payout_total = g["contribution_amount"] * total_members
        total_monthly += monthly
        payout_cycles = await db.cycles.find(
            {"group_id": gid, "cycle_no": {"$in": positions}, "payout_status": {"$ne": "completed"}},
            {"_id": 0, "cycle_no": 1, "due_date": 1}
        ).sort("cycle_no", 1).to_list(20) if positions else []
        payout_dates_text = ", ".join(
            f"Month {c['cycle_no']} ({c['due_date'][:7]})" for c in payout_cycles
        ) or "Not yet assigned"
        statuses = await db.member_cycle_status.find({"group_id": gid, "user_id": uid}).to_list(200)
        overdue = sum(1 for st in statuses if st["status"] == "Overdue")
        due_now = sum(1 for st in statuses if st["status"] == "Due")
        paid = sum(1 for st in statuses if st["status"] in ("Approved", "Paid", "Payout_Completed"))

        groups_data.append({
            "name": g["name"], "frequency": g["frequency"], "status": g.get("status", "active"),
            "total_cycles": g["total_cycles"], "contribution_amount": g["contribution_amount"],
            "positions": positions, "total_members": total_members,
            "monthly": monthly, "payout_total": payout_total,
            "payout_dates": payout_dates_text, "payout_cycles": payout_cycles,
            "overdue": overdue, "due_now": due_now, "paid": paid,
        })
        ai_context_lines.append(
            f"- {g['name']}: slot(s) {positions or 'unassigned'}, monthly ₦{monthly:,.0f}, "
            f"payout ₦{payout_total:,.0f}, payout month: {payout_dates_text}"
            + (f", ⚠{overdue} overdue" if overdue else "")
        )

    if not groups_data:
        return None

    first_name = user_doc["name"].split()[0]
    total_overdue = sum(g["overdue"] for g in groups_data)
    total_due_now  = sum(g["due_now"]  for g in groups_data)

    # ── Short, specific subject / heading / default intro ─────────────────
    if email_type == "reminder":
        subject = f"⏰ Payment due — {brand}"
        heading = "Payment Reminder"
        overdue_groups = [g for g in groups_data if g["overdue"] > 0]
        due_groups     = [g for g in groups_data if g["due_now"]  > 0]
        if overdue_groups:
            g0 = overdue_groups[0]
            default_intro = (
                f"Hi {first_name}, you have an overdue payment of "
                f"<strong>&#8358;{g0['monthly']:,.0f}</strong> in <em>{g0['name']}</em>. "
                "Settle now to avoid further late fees."
            )
        elif due_groups:
            g0 = due_groups[0]
            default_intro = (
                f"Hi {first_name}, your <strong>&#8358;{g0['monthly']:,.0f}</strong> "
                f"contribution to <em>{g0['name']}</em> is due. Please pay today."
            )
        else:
            default_intro = (
                f"Hi {first_name}, your upcoming Ajo contribution"
                f"{'s are' if len(groups_data) > 1 else ' is'} listed below."
            )
    else:
        subject = f"Your Ajo snapshot — {brand}"
        heading = "Your Ajo Snapshot"
        default_intro = (
            f"Hi {first_name}, here's your quick Ajo snapshot across "
            f"{len(groups_data)} group{'s' if len(groups_data) != 1 else ''}."
        )

    # ── AI intro — capped at 1 short sentence ─────────────────────────────
    if groq_key:
        ai_system = (
            f"You are a {brand} Ajo finance assistant. "
            f"Write EXACTLY ONE short sentence (10–18 words) as an email opener for a '{email_type}' email. "
            "Be direct and reference the specific amount or action needed. "
            "No encouragement paragraphs. No fluff. Start with 'Hi [FirstName],'."
        )
        ai_user = (
            f"Name: {first_name}. Monthly: &#8358;{total_monthly:,.0f}. "
            f"Groups: {len(groups_data)}. Overdue: {total_overdue}. "
            + "; ".join(ai_context_lines[:2])
        )
        try:
            raw_ai = await call_groq(groq_key, ai_system, ai_user, model)
            ai_intro = raw_ai if len(raw_ai.split()) <= 40 else default_intro
        except Exception:
            ai_intro = default_intro
    else:
        ai_intro = default_intro

    # ── Payout banner (green) — shown when member has upcoming payout ─────
    payout_banner = ""
    for gd in groups_data:
        if gd["payout_cycles"]:
            pc0 = gd["payout_cycles"][0]
            slot_label = f"Slot #{gd['positions'][0]}" if gd["positions"] else "your slot"
            payout_banner = f"""
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px">
  <tr><td style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:14px 18px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#15803d;margin-bottom:3px">&#127881; Payout coming</div>
        <div style="font-size:20px;font-weight:800;color:#15803d;letter-spacing:-0.5px">&#8358;{gd['payout_total']:,.0f}</div>
        <div style="font-size:11px;color:#166534;margin-top:3px">{gd['name']} &middot; {slot_label} &middot; Month {pc0['cycle_no']} &middot; {pc0['due_date']}</div>
      </td>
      <td align="right" style="font-size:32px;padding-left:8px">&#128176;</td>
    </tr></table>
  </td></tr>
</table>"""
            break

    # ── Overdue / due-now banner ─────────────────────────────────────────
    alert_banner = ""
    if total_overdue > 0:
        alert_banner = f"""
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px">
  <tr><td style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:11px 16px">
    <span style="font-size:13px;font-weight:700;color:#dc2626">&#9888; {total_overdue} overdue payment{'s' if total_overdue>1 else ''}</span>
    <span style="font-size:12px;color:#b91c1c;margin-left:6px">— settle immediately to avoid extra late fees.</span>
  </td></tr>
</table>"""
    elif total_due_now > 0:
        alert_banner = f"""
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px">
  <tr><td style="background:#fefce8;border:1px solid #fde68a;border-radius:10px;padding:11px 16px">
    <span style="font-size:13px;font-weight:700;color:#92400e">&#9201; {total_due_now} payment{'s' if total_due_now>1 else ''} due now</span>
    <span style="font-size:12px;color:#78350f;margin-left:6px">— please pay today.</span>
  </td></tr>
</table>"""

    # ── Stats row (compact) ───────────────────────────────────────────────
    stats_html = f"""
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
  <tr>
    <td width="50%" style="padding:14px 16px;border-right:1px solid #e5e7eb;text-align:center;vertical-align:top">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:#9ca3af;margin-bottom:4px">Monthly due</div>
      <div style="font-size:20px;font-weight:800;color:#1E3F33;letter-spacing:-0.5px">&#8358;{total_monthly:,.0f}</div>
    </td>
    <td width="50%" style="padding:14px 16px;text-align:center;vertical-align:top">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:#9ca3af;margin-bottom:4px">Active groups</div>
      <div style="font-size:20px;font-weight:800;color:#111827">{len(groups_data)}</div>
    </td>
  </tr>
</table>"""

    # ── Short intro line ──────────────────────────────────────────────────
    intro_html = f'<p style="font-size:14px;color:#374151;margin:0 0 16px;line-height:1.5">{ai_intro}</p>'

    # ── Compact group cards ───────────────────────────────────────────────
    cards_html = ""
    for gd in groups_data:
        slot_badges = "".join(
            f'<span style="display:inline-block;background:#1E3F33;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;margin-left:4px">#{p}</span>'
            for p in gd["positions"]
        ) or '<span style="font-size:10px;color:#9ca3af">unassigned</span>'

        paid_bar_pct = int((gd["paid"] / gd["total_cycles"]) * 100) if gd["total_cycles"] else 0
        multi_note = (
            f'<div style="font-size:10px;color:#9ca3af;margin-top:1px">'
            f'{len(gd["positions"])} slots &times; &#8358;{gd["contribution_amount"]:,.0f}</div>'
            if len(gd["positions"]) > 1 else ""
        )
        payout_line = ""
        if gd["payout_cycles"]:
            pc0 = gd["payout_cycles"][0]
            payout_line = (
                f'<div style="font-size:11px;font-weight:700;color:#15803d;margin-top:6px">'
                f'&#128176; Payout month: Month {pc0["cycle_no"]} &middot; {pc0["due_date"]}</div>'
            )
        status_color = "#dc2626" if gd["overdue"] > 0 else ("#d97706" if gd["due_now"] > 0 else "#16a34a")
        status_icon  = "&#9888;" if gd["overdue"] > 0 else ("&#9201;" if gd["due_now"] > 0 else "&#10003;")
        status_label = (
            f'{gd["overdue"]} overdue' if gd["overdue"] > 0
            else (f'{gd["due_now"]} due now' if gd["due_now"] > 0 else "up to date")
        )

        cards_html += f"""
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
  <tr>
    <td style="background:#f8f7f4;padding:10px 16px;border-bottom:1px solid #e5e7eb">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-size:13px;font-weight:700;color:#111827">{gd['name']}</td>
        <td align="right">{slot_badges}</td>
      </tr></table>
    </td>
  </tr>
  <tr>
    <td style="padding:12px 16px">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="33%" style="vertical-align:top;border-right:1px solid #f3f4f6;padding-right:10px">
            <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:3px">Monthly</div>
            <div style="font-size:16px;font-weight:800;color:#1E3F33">&#8358;{gd['monthly']:,.0f}</div>
            {multi_note}
          </td>
          <td width="33%" style="vertical-align:top;padding:0 10px;border-right:1px solid #f3f4f6">
            <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:3px">You receive</div>
            <div style="font-size:16px;font-weight:800;color:#15803d">&#8358;{gd['payout_total']:,.0f}</div>
            <div style="font-size:10px;color:#9ca3af;margin-top:1px">{gd['total_members']} members</div>
          </td>
          <td width="34%" style="vertical-align:top;padding-left:10px">
            <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:3px">Progress</div>
            <div style="font-size:15px;font-weight:800;color:#111827">{gd['paid']}<span style="font-size:12px;font-weight:400;color:#9ca3af">/{gd['total_cycles']}</span></div>
            <div style="font-size:10px;color:#9ca3af;margin-top:1px;text-transform:capitalize">{gd['frequency']}</div>
          </td>
        </tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px">
        <tr><td style="background:#f3f4f6;border-radius:99px;height:4px;overflow:hidden">
          <div style="background:#1E3F33;height:4px;width:{paid_bar_pct}%;border-radius:99px"></div>
        </td></tr>
      </table>
      {payout_line}
      <div style="font-size:11px;font-weight:600;color:{status_color};margin-top:7px">{status_icon} {status_label}</div>
    </td>
  </tr>
</table>"""

    body_html = payout_banner + alert_banner + stats_html + intro_html + cards_html
    return {
        "subject": subject,
        "heading": heading,
        "body_html": body_html,
        "recipient_name": user_doc["name"],
        "recipient_email": user_doc["email"],
        "ai_intro": ai_intro,
    }


# ──────────────────────────────────────────────
# AI ASSISTANT  (Groq / open-source Llama 3)
# ──────────────────────────────────────────────

async def call_groq(api_key: str, system_prompt: str, user_message: str, model: str = "llama-3.3-70b-versatile") -> str:
    """Call Groq inference API (open-source Llama 3 models, free tier available)."""
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                "temperature": 0.7,
                "max_tokens": 1500,
            },
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"].strip()


class AIGenerateGroupIn(BaseModel):
    prompt: str

class AISummaryEmailIn(BaseModel):
    group_id: Optional[str] = None    # None = all groups
    user_ids: Optional[List[str]] = None  # None = all members in scope
    email_type: Literal["summary", "reminder"] = "summary"


@api.post("/admin/ai/generate-group")
async def ai_generate_group(data: AIGenerateGroupIn, admin=Depends(require_admin)):
    """Use Groq AI to draft an Ajo group config from a plain-text prompt."""
    s = await db.settings.find_one({"key": "global"}, {"_id": 0}) or {}
    api_key = s.get("groq_api_key")
    if not api_key:
        raise HTTPException(400, "Groq API key not configured. Go to Admin Settings → AI Assistant to add it.")
    model = s.get("groq_model") or "llama-3.3-70b-versatile"
    today = now_utc().date().isoformat()
    system = (
        f"You are an expert Ajo (Nigerian rotating savings group) coordinator. Today is {today}. "
        "Given a plain-English description, produce a JSON object for creating an Ajo group. "
        "Respond ONLY with valid JSON — no markdown, no explanation — matching this exact schema:\n"
        '{"name":"","description":"","contribution_amount":50000,"frequency":"monthly",'
        '"start_date":"YYYY-MM-DD","total_cycles":12,"member_limit":12,"due_day":1,'
        '"due_time":"23:59","first_payment_fee":0,"late_fee_amount":500,"late_fee_method":"fixed",'
        '"grace_period_days":3,"payment_account_details":"","rules_text":"",'
        '"enable_comments":true,"allow_multiple_slots":false}\n'
        "Rules: frequency = monthly|weekly|biweekly. start_date must be in the future. "
        "total_cycles usually equals member_limit. contribution_amount is a plain number in Naira. "
        "Write 2-3 sentences of rules_text about punctuality and respect."
    )
    try:
        raw = await call_groq(api_key, system, data.prompt, model)
        start = raw.find("{")
        end = raw.rfind("}") + 1
        parsed = json.loads(raw[start:end])
        defaults = {"due_time": "23:59", "first_payment_fee": 0, "late_fee_amount": 500,
                    "late_fee_method": "fixed", "grace_period_days": 3, "payment_account_details": "",
                    "enable_comments": True, "allow_multiple_slots": False}
        for k, v in defaults.items():
            parsed.setdefault(k, v)
        return {"ok": True, "group": parsed}
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, f"Groq API error: {e.response.status_code}. Check your API key.")
    except Exception:
        raise HTTPException(500, "AI returned an unexpected response. Try rephrasing your prompt.")


@api.post("/admin/ai/send-summary-emails")
async def ai_send_summary_emails(data: AISummaryEmailIn, admin=Depends(require_admin)):
    """Generate and send personalised Ajo summary or reminder emails to members (AI-enhanced when Groq key is set)."""
    s = await db.settings.find_one({"key": "global"}, {"_id": 0}) or {}
    groq_key = s.get("groq_api_key")
    model = s.get("groq_model") or "llama-3.3-70b-versatile"
    brand = s.get("brand_name") or "Ajo Platform"
    fe = _get_fe_url(s)

    # Resolve target user IDs via group_members — no payout_position filter
    if data.user_ids:
        target_user_ids = data.user_ids
    elif data.group_id:
        mems = await db.group_members.find({"group_id": data.group_id}, {"user_id": 1}).to_list(1000)
        seen_uid: set = set()
        target_user_ids = []
        for m in mems:
            uid_val = m.get("user_id")
            if uid_val and uid_val not in seen_uid:
                seen_uid.add(uid_val)
                target_user_ids.append(uid_val)
    else:
        # All members who have any group membership
        all_mems = await db.group_members.find({}, {"user_id": 1}).to_list(5000)
        seen_uid2: set = set()
        target_user_ids = []
        for m in all_mems:
            uid_val = m.get("user_id")
            if uid_val and uid_val not in seen_uid2:
                seen_uid2.add(uid_val)
                target_user_ids.append(uid_val)

    if not target_user_ids:
        raise HTTPException(404, "No members found. Make sure members are assigned to groups first.")

    sent_count = 0
    errors = []

    for uid in target_user_ids:
        try:
            content = await _build_member_email_content(uid, data.email_type, brand, fe, groq_key, model)
            if not content:
                continue
            await send_email(
                db, content["recipient_email"], content["subject"], content["heading"],
                content["body_html"], cta_label="View my dashboard", cta_link=f"{fe}/dashboard"
            )
            sent_count += 1
        except Exception as exc:
            errors.append({"user_id": uid, "error": str(exc)})

    await log_audit(admin["id"], "ai_summary_emails",
                    meta={"type": data.email_type, "sent": sent_count, "errors": len(errors)})

    if sent_count == 0 and not errors:
        raise HTTPException(404, "No members with group data found. Make sure members are assigned to groups first.")

    return {"ok": True, "sent": sent_count, "errors": errors}


class AIPreviewEmailIn(BaseModel):
    group_id: Optional[str] = None
    email_type: Literal["summary", "reminder"] = "summary"

@api.post("/admin/ai/preview-summary-email")
async def ai_preview_summary_email(data: AIPreviewEmailIn, admin=Depends(require_admin)):
    """Build and return full email HTML for one sample member — pixel-perfect preview before sending."""
    s = await db.settings.find_one({"key": "global"}, {"_id": 0}) or {}
    groq_key = s.get("groq_api_key")
    model = s.get("groq_model") or "llama-3.3-70b-versatile"
    brand = s.get("brand_name") or "Ajo Platform"
    fe = _get_fe_url(s)

    # Find real members who have group memberships (most reliable source)
    if data.group_id:
        mems = await db.group_members.find({"group_id": data.group_id}, {"user_id": 1}).to_list(200)
        target_user_ids = list({m["user_id"] for m in mems})
    else:
        # Query group_members directly — these users definitely have group data
        sample_mems = await db.group_members.find({}, {"user_id": 1}).limit(100).to_list(100)
        seen_uid: set = set()
        target_user_ids = []
        for m in sample_mems:
            uid = m.get("user_id")
            if uid and uid not in seen_uid:
                seen_uid.add(uid)
                target_user_ids.append(uid)

    for uid in target_user_ids:
        content = await _build_member_email_content(uid, data.email_type, brand, fe, groq_key, model)
        if content:
            # Wrap with the same template used for real sends — pixel-perfect preview
            full_html = _email_wrap(
                content["heading"], content["body_html"],
                "View my dashboard", f"{fe}/dashboard", brand
            )
            content["full_html"] = full_html
            return {"ok": True, "preview": content}

    raise HTTPException(404, "No members with group data found. Make sure members are assigned to groups first.")


# ── Member: own Ajo summary ──
@api.get("/member/my-summary")
async def member_my_summary(user=Depends(get_current_user)):
    """Return the authenticated member's full contribution summary across all groups."""
    memberships = await db.group_members.find({"user_id": user["id"]}).to_list(100)
    seen_groups: set = set()
    groups_out = []
    total_monthly = 0.0

    for mem in memberships:
        gid = mem["group_id"]
        if gid in seen_groups:
            continue
        seen_groups.add(gid)
        g = await db.groups.find_one({"id": gid}, {"_id": 0})
        if not g:
            continue

        my_slots_docs = await db.group_members.find({"group_id": gid, "user_id": user["id"]}).to_list(20)
        positions = sorted([s["payout_position"] for s in my_slots_docs if s.get("payout_position") is not None])
        total_members = await db.group_members.count_documents({"group_id": gid, "payout_position": {"$ne": None}})
        monthly_due = g["contribution_amount"] * len(positions)
        payout_total = g["contribution_amount"] * total_members
        total_monthly += monthly_due

        payout_cycles = await db.cycles.find(
            {"group_id": gid, "cycle_no": {"$in": positions}, "payout_status": {"$ne": "completed"}},
            {"_id": 0, "cycle_no": 1, "due_date": 1}
        ).sort("cycle_no", 1).to_list(20) if positions else []

        statuses = await db.member_cycle_status.find({"group_id": gid, "user_id": user["id"]}, {"_id": 0}).to_list(500)
        paid = sum(1 for st in statuses if st["status"] in ("Approved", "Paid", "Payout_Completed"))
        overdue = sum(1 for st in statuses if st["status"] == "Overdue")
        due_now = sum(1 for st in statuses if st["status"] == "Due")
        next_due = next(
            (st for st in sorted(statuses, key=lambda x: x.get("cycle_no", 0)) if st["status"] in ("Due", "Overdue")),
            None
        )

        groups_out.append({
            "group_id": gid,
            "group_name": g["name"],
            "frequency": g["frequency"],
            "contribution_amount": g["contribution_amount"],
            "start_date": g.get("start_date"),
            "status": g.get("status", "active"),
            "total_cycles": g["total_cycles"],
            "total_members": total_members,
            "my_slots": positions,
            "monthly_due": monthly_due,
            "payout_total": payout_total,
            "payout_cycles": payout_cycles,
            "paid_cycles": paid,
            "overdue_cycles": overdue,
            "due_now": due_now,
            "next_due_cycle": next_due["cycle_no"] if next_due else None,
            "next_due_amount": next_due.get("expected_amount") if next_due else None,
        })

    return {
        "user_name": user["name"],
        "total_groups": len(groups_out),
        "total_monthly_due": total_monthly,
        "groups": sorted(groups_out, key=lambda x: x["group_name"]),
    }


# Register all routes — must come AFTER all @api.* decorators are defined
app.include_router(api)

@app.on_event("shutdown")
async def shutdown():
    client.close()
