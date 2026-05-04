from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import logging
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta, date
from typing import List, Optional, Literal
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
from email_service import send_email
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

class GroupUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    contribution_amount: Optional[float] = None
    frequency: Optional[Literal["monthly", "weekly", "biweekly"]] = None
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
                     cta_link=f"{os.environ.get('FRONTEND_URL','')}/dashboard")
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
    if "visibility_preference" in update:
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
    members = await db.group_members.find({"group_id": group_id}, {"_id": 0}).to_list(1000)
    cycles = await db.cycles.find({"group_id": group_id}, {"_id": 0}).sort("cycle_no", 1).to_list(1000)
    return {"group": g, "members": members, "cycles": cycles}

@api.patch("/admin/groups/{group_id}")
async def update_group(group_id: str, data: GroupUpdate, admin=Depends(require_admin)):
    g = await db.groups.find_one({"id": group_id})
    if not g:
        raise HTTPException(404, "Group not found")
    updates = {k: v for k, v in data.dict().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")
    await db.groups.update_one({"id": group_id}, {"$set": updates})
    await log_audit(admin["id"], "group_updated", target=group_id, meta=updates)
    updated = await db.groups.find_one({"id": group_id}, {"_id": 0})
    return updated

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
    existing = await db.group_members.find_one({"group_id": group_id, "user_id": user["id"]})
    if existing:
        raise HTTPException(400, "User already in group")
    count = await db.group_members.count_documents({"group_id": group_id})
    if count >= group["member_limit"]:
        raise HTTPException(400, "Group member limit reached")
    position = data.payout_position or (count + 1)
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
    # create cycle status records
    cycles = await db.cycles.find({"group_id": group_id}).to_list(1000)
    today = now_utc().date()
    docs = []
    for c in cycles:
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
        await db.member_cycle_status.insert_many(docs)
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
                     cta_link=f"{os.environ.get('FRONTEND_URL','')}/groups/{group_id}")
    return gm

@api.delete("/admin/groups/{group_id}/members/{user_id}")
async def remove_member(group_id: str, user_id: str, reason: Optional[str] = None, admin=Depends(require_admin)):
    res = await db.group_members.delete_one({"group_id": group_id, "user_id": user_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Member not found")
    await log_audit(admin["id"], "member_removed", target=group_id,
                    meta={"user_id": user_id, "reason": reason or ""})
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
    # notify admin
    admins = await db.users.find({"role": {"$in": ["admin", "super_admin"]}}).to_list(100)
    for a in admins:
        await push_notification(a["id"], "New payment submitted",
                                f"{user['name']} submitted ₦{data.amount} for cycle {data.cycle_no}.",
                                link=f"/admin")
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
        cta_link=f"{os.environ.get('FRONTEND_URL','')}/groups/{p['group_id']}"
    )
    return {"ok": True, "status": new_status}

# ---------------- PAYOUTS ----------------
@api.post("/admin/payouts/{group_id}/{cycle_no}/confirm")
async def confirm_payout(group_id: str, cycle_no: int, admin=Depends(require_admin)):
    cycle = await db.cycles.find_one({"group_id": group_id, "cycle_no": cycle_no})
    if not cycle:
        raise HTTPException(404, "Cycle not found")
    if not cycle.get("payout_user_id"):
        raise HTTPException(400, "No payout recipient assigned")
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
                         cta_link=f"{os.environ.get('FRONTEND_URL','')}/groups/{group_id}")
    return {"ok": True}

# ---------------- MEMBER VIEWS ----------------
@api.get("/groups/my")
async def my_groups(user=Depends(get_current_user)):
    memberships = await db.group_members.find({"user_id": user["id"]}, {"_id": 0}).to_list(100)
    out = []
    for m in memberships:
        g = await db.groups.find_one({"id": m["group_id"]}, {"_id": 0})
        if g:
            out.append({**g, "payout_position": m["payout_position"]})
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
    cycles = await db.cycles.find({"group_id": group_id}, {"_id": 0}).sort("cycle_no", 1).to_list(1000)
    members = await db.group_members.find({"group_id": group_id}, {"_id": 0}).to_list(1000)
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
    return {"group": g, "cycles": cycles, "members": members, "statuses": my_status}

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
    return settings.get("frontend_url") or os.environ.get("FRONTEND_URL", "")

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
    cookie_tok = request.cookies.get("access_token")
    if cookie_tok:
        try:
            payload = jwt.decode(cookie_tok, JWT_SECRET, algorithms=[JWT_ALG])
            current_user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
        except Exception:
            pass

    if not current_user:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            bearer = auth_header[7:]
            try:
                payload = jwt.decode(bearer, JWT_SECRET, algorithms=[JWT_ALG])
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
    cookie_tok = request.cookies.get("access_token")
    if cookie_tok:
        try:
            payload = jwt.decode(cookie_tok, JWT_SECRET, algorithms=[JWT_ALG])
            current_user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
        except Exception:
            pass

    if not current_user:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            bearer = auth_header[7:]
            try:
                payload = jwt.decode(bearer, JWT_SECRET, algorithms=[JWT_ALG])
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

@api.post("/admin/broadcast")
async def admin_broadcast(data: BroadcastIn, admin=Depends(require_admin)):
    """Admin broadcasts a notification to all members of one group (or all groups)."""
    if data.group_id:
        await notify_group(data.group_id, data.title, data.body, link=f"/groups/{data.group_id}")
        return {"ok": True, "scope": "group"}
    # all groups: iterate
    groups = await db.groups.find({"status": "active"}).to_list(1000)
    for g in groups:
        await notify_group(g["id"], data.title, data.body, link=f"/groups/{g['id']}")
    await log_audit(admin["id"], "admin_broadcast", meta={"scope": "all" if not data.group_id else data.group_id})
    return {"ok": True, "scope": "all", "groups": len(groups)}

# ---------------- INCLUDE ROUTER ----------------
app.include_router(api)

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
    await db.group_members.create_index([("group_id", 1), ("user_id", 1)], unique=True)
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

@app.on_event("shutdown")
async def shutdown():
    client.close()
