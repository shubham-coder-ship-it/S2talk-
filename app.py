"""
S2 Talk — Flask backend
Run with:  python app.py
Serves the flat-city frontend and provides real account
persistence (SQLite), sessions, resume/avatar uploads,
a friends directory, a proxy for AI calls, and a full
Admin Panel with user management, activity logging, and
real-time notifications.
"""
import urllib.parse

from dotenv import load_dotenv
import os
import urllib.error
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))
import sys
import re
import random
import secrets
import hashlib
import base64
import sqlite3
import subprocess
import tempfile
import urllib.request
import json as json_lib
import math
import signal
import shutil
try:
    import resource  # POSIX only — used to sandbox compiled user code
except ImportError:
    resource = None
from datetime import datetime, timedelta
from functools import wraps



from ai import generate_response, validate_api, health_check, AIProviderError

_ai_status = health_check()
print("Provider:", _ai_status["provider"])
print(f"{_ai_status['provider'].title()} Key Loaded:", _ai_status["key_loaded"])
print("Model:", _ai_status["model"])

from flask import Flask, request, jsonify, session, send_from_directory, render_template, redirect, url_for

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "s2talk.db")
UPLOAD_RESUMES = os.path.join(BASE_DIR, "static", "uploads", "resumes")
UPLOAD_AVATARS = os.path.join(BASE_DIR, "static", "uploads", "avatars")
UPLOAD_VOICE = os.path.join(BASE_DIR, "static", "uploads", "voice")
os.makedirs(UPLOAD_RESUMES, exist_ok=True)
os.makedirs(UPLOAD_AVATARS, exist_ok=True)
os.makedirs(UPLOAD_VOICE, exist_ok=True)

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("FLASK_SECRET_KEY") or os.environ.get("S2TALK_SECRET_KEY", "dev-secret-change-me")
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024  # 8MB uploads

@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

ALLOWED_RESUME_EXT = {".pdf", ".doc", ".docx"}
ALLOWED_AVATAR_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
ALLOWED_VOICE_EXT = {".webm", ".ogg", ".mp3", ".wav", ".m4a"}

try:
    from werkzeug.security import generate_password_hash, check_password_hash
except ImportError:  # pragma: no cover
    raise SystemExit("Missing dependency: run  pip install -r requirements.txt")


# ------------------------------------------------------------------
# Database
# ------------------------------------------------------------------
def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db():
    conn = get_db()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uid TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            username TEXT DEFAULT '',
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            skills TEXT DEFAULT '',
            bio TEXT DEFAULT '',
            interests TEXT DEFAULT '',
            city TEXT DEFAULT '',
            resume_filename TEXT,
            resume_path TEXT,
            avatar_path TEXT,
            avatar_emoji TEXT DEFAULT '🙂',
            car_color TEXT DEFAULT '#5B4FE8',
            score INTEGER DEFAULT 0,
            role TEXT DEFAULT 'user',
            status TEXT DEFAULT 'active',
            last_seen TEXT DEFAULT CURRENT_TIMESTAMP,
            last_login TEXT,
            blocked_at TEXT,
            blocked_by INTEGER,
            block_reason TEXT DEFAULT '',
            suspended_until TEXT,
            suspend_reason TEXT DEFAULT '',
            deleted INTEGER DEFAULT 0,
            deleted_at TEXT,
            deleted_by INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS password_resets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            otp_hash TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            used INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS friends (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            requester_id INTEGER NOT NULL,
            addressee_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(requester_id, addressee_id),
            FOREIGN KEY(requester_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY(addressee_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            category TEXT NOT NULL,
            points INTEGER NOT NULL DEFAULT 0,
            meta TEXT DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_id INTEGER NOT NULL,
            recipient_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            attachment_url TEXT,
            attachment_type TEXT,
            deleted_by_sender INTEGER DEFAULT 0,
            deleted_by_recipient INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY(recipient_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS login_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            name TEXT DEFAULT '',
            email TEXT DEFAULT '',
            login_time TEXT DEFAULT CURRENT_TIMESTAMP,
            browser TEXT DEFAULT '',
            os TEXT DEFAULT '',
            device TEXT DEFAULT '',
            ip_address TEXT DEFAULT '',
            login_status TEXT DEFAULT 'success'
        );

        CREATE TABLE IF NOT EXISTS admin_notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            target_user_id INTEGER,
            is_read INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS admin_activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER NOT NULL,
            admin_name TEXT DEFAULT '',
            admin_email TEXT DEFAULT '',
            action TEXT NOT NULL,
            target_user_id INTEGER,
            target_name TEXT DEFAULT '',
            target_email TEXT DEFAULT '',
            reason TEXT DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    conn.commit()

    # Migrate existing users table with new columns
    user_new_cols = [
        ("username", "ALTER TABLE users ADD COLUMN username TEXT DEFAULT ''"),
        ("role", "ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'"),
        ("status", "ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'"),
        ("interests", "ALTER TABLE users ADD COLUMN interests TEXT DEFAULT ''"),
        ("city", "ALTER TABLE users ADD COLUMN city TEXT DEFAULT ''"),
        ("last_seen", "ALTER TABLE users ADD COLUMN last_seen TEXT"),
        ("last_login", "ALTER TABLE users ADD COLUMN last_login TEXT"),
        ("blocked_at", "ALTER TABLE users ADD COLUMN blocked_at TEXT"),
        ("blocked_by", "ALTER TABLE users ADD COLUMN blocked_by INTEGER"),
        ("block_reason", "ALTER TABLE users ADD COLUMN block_reason TEXT DEFAULT ''"),
        ("suspended_until", "ALTER TABLE users ADD COLUMN suspended_until TEXT"),
        ("suspend_reason", "ALTER TABLE users ADD COLUMN suspend_reason TEXT DEFAULT ''"),
        ("deleted", "ALTER TABLE users ADD COLUMN deleted INTEGER DEFAULT 0"),
        ("deleted_at", "ALTER TABLE users ADD COLUMN deleted_at TEXT"),
        ("deleted_by", "ALTER TABLE users ADD COLUMN deleted_by INTEGER"),
        ("updated_at", "ALTER TABLE users ADD COLUMN updated_at TEXT"),
    ]
    for col, ddl in user_new_cols:
        try:
            conn.execute(f"SELECT {col} FROM users LIMIT 1")
        except sqlite3.OperationalError:
            conn.execute(ddl)
            conn.commit()

    # Migrate messages table
    msg_new_cols = [
        ("attachment_url", "ALTER TABLE messages ADD COLUMN attachment_url TEXT"),
        ("attachment_type", "ALTER TABLE messages ADD COLUMN attachment_type TEXT"),
        ("deleted_by_sender", "ALTER TABLE messages ADD COLUMN deleted_by_sender INTEGER DEFAULT 0"),
        ("deleted_by_recipient", "ALTER TABLE messages ADD COLUMN deleted_by_recipient INTEGER DEFAULT 0"),
    ]
    for col, ddl in msg_new_cols:
        try:
            conn.execute(f"SELECT {col} FROM messages LIMIT 1")
        except sqlite3.OperationalError:
            conn.execute(ddl)
            conn.commit()

    conn.execute("UPDATE users SET last_seen=CURRENT_TIMESTAMP WHERE last_seen IS NULL")
    conn.execute("UPDATE users SET status='active' WHERE status IS NULL")
    conn.execute("UPDATE users SET role='user' WHERE role IS NULL")
    conn.execute("UPDATE users SET deleted=0 WHERE deleted IS NULL")
    conn.commit()
    conn.close()


init_db()


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def gen_uid(name, conn):
    """S2-XX12345  ->  S2- + first two letters of name + random 5-digit number."""
    letters = re.sub(r"[^A-Za-z]", "", name)[:2].upper()
    if len(letters) < 2:
        letters = (letters + "XX")[:2]
    for _ in range(50):
        candidate = f"S2-{letters}{random.randint(10000, 99999)}"
        exists = conn.execute("SELECT 1 FROM users WHERE uid=?", (candidate,)).fetchone()
        if not exists:
            return candidate
    # extremely unlikely fallback
    return f"S2-{letters}{random.randint(100000, 999999)}"


def is_online(last_seen_str):
    if not last_seen_str:
        return False
    try:
        last = datetime.strptime(last_seen_str, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return False
    return (datetime.now() - last) < timedelta(minutes=2)


def user_row_to_public(row, include_private=False):
    data = {
        "uid": row["uid"],
        "name": row["name"],
        "email": row["email"],
        "role": row["role"] if "role" in row.keys() else "user",
        "skills": row["skills"] or "",
        "bio": row["bio"] if include_private else "",
        "interests": row["interests"] or "" if include_private else "",
        "city": row["city"] or "",
        "resumeFileName": row["resume_filename"],
        "resumeUrl": f"/static/uploads/resumes/{os.path.basename(row['resume_path'])}" if row["resume_path"] else None,
        "avatarEmoji": row["avatar_emoji"],
        "carColor": row["car_color"],
        "pic": f"/static/uploads/avatars/{os.path.basename(row['avatar_path'])}" if row["avatar_path"] else None,
        "online": is_online(row["last_seen"]) if "last_seen" in row.keys() else False,
        "lastSeen": row["last_seen"] if "last_seen" in row.keys() else None,
    }
    return data


def touch_last_seen(conn, user_id):
    conn.execute(
        "UPDATE users SET last_seen=datetime('now') WHERE id=?", (user_id,)
    )
    conn.commit()


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if "user_id" not in session:
            return jsonify({"error": "Not logged in."}), 401
        try:
            conn = get_db()
            user_row = conn.execute(
                "SELECT status, deleted FROM users WHERE id=?", (session["user_id"],)
            ).fetchone()
            if user_row:
                if user_row["deleted"]:
                    conn.close()
                    session.clear()
                    return jsonify({"error": "Account unavailable.", "code": "DELETED"}), 401
                if user_row["status"] == "blocked":
                    conn.close()
                    session.clear()
                    return jsonify({"error": "Your account has been blocked. Please contact the administrator.", "code": "BLOCKED"}), 401
            touch_last_seen(conn, session["user_id"])
            conn.close()
        except sqlite3.Error:
            pass
        return fn(*args, **kwargs)

    return wrapper


# ------------------------------------------------------------------
# Admin middleware
# ------------------------------------------------------------------
def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if "user_id" not in session:
            if request.path.startswith("/api/"):
                return jsonify({"error": "Authentication required."}), 401
            return redirect("/")
        conn = get_db()
        row = conn.execute("SELECT role, status, deleted FROM users WHERE id=?", (session["user_id"],)).fetchone()
        conn.close()
        if not row or row["role"] != "admin" or row["deleted"] or row["status"] != "active":
            if request.path.startswith("/api/"):
                return jsonify({"error": "Admin access required."}), 403
            return redirect("/")
        return fn(*args, **kwargs)
    return wrapper


# ------------------------------------------------------------------
# Admin helpers
# ------------------------------------------------------------------
def get_admin_context(conn):
    """Returns template context vars for admin pages."""
    uid = session.get("user_id")
    admin_row = conn.execute("SELECT name FROM users WHERE id=?", (uid,)).fetchone() if uid else None
    unread = conn.execute("SELECT COUNT(*) AS c FROM admin_notifications WHERE is_read=0").fetchone()["c"]
    return {
        "current_admin_name": admin_row["name"] if admin_row else "Admin",
        "unread_notifs": unread,
    }


def create_admin_notification(conn, notif_type, title, message, target_user_id=None):
    conn.execute(
        "INSERT INTO admin_notifications (type, title, message, target_user_id) VALUES (?,?,?,?)",
        (notif_type, title, message, target_user_id),
    )
    conn.commit()


def log_admin_activity(conn, admin_id, action, target_user_id=None, reason=""):
    admin = conn.execute("SELECT name, email FROM users WHERE id=?", (admin_id,)).fetchone()
    target = conn.execute("SELECT name, email FROM users WHERE id=?", (target_user_id,)).fetchone() if target_user_id else None
    conn.execute(
        """INSERT INTO admin_activity_logs
           (admin_id, admin_name, admin_email, action, target_user_id, target_name, target_email, reason)
           VALUES (?,?,?,?,?,?,?,?)""",
        (
            admin_id,
            admin["name"] if admin else "",
            admin["email"] if admin else "",
            action,
            target_user_id,
            target["name"] if target else "",
            target["email"] if target else "",
            reason or "",
        ),
    )
    conn.commit()


def parse_user_agent(ua_string):
    """Lightweight UA parser — no external dependency."""
    ua = ua_string or ""
    # Browser
    if "Edg/" in ua or "Edge/" in ua:
        browser = "Edge"
    elif "OPR/" in ua or "Opera" in ua:
        browser = "Opera"
    elif "Chrome/" in ua and "Safari" in ua:
        browser = "Chrome"
    elif "Firefox/" in ua:
        browser = "Firefox"
    elif "Safari/" in ua and "Chrome" not in ua:
        browser = "Safari"
    else:
        browser = "Unknown"
    # OS
    if "Windows" in ua:
        os_name = "Windows"
    elif "Mac OS" in ua or "Macintosh" in ua:
        os_name = "macOS"
    elif "Linux" in ua and "Android" not in ua:
        os_name = "Linux"
    elif "Android" in ua:
        os_name = "Android"
    elif "iPhone" in ua or "iPad" in ua:
        os_name = "iOS"
    else:
        os_name = "Unknown"
    # Device
    if "Mobile" in ua or "Android" in ua and "Mobile" in ua:
        device = "Mobile"
    elif "iPad" in ua or "Tablet" in ua:
        device = "Tablet"
    else:
        device = "Desktop"
    return browser, os_name, device


def log_login(conn, user_id, name, email, status="success"):
    ua_string = request.headers.get("User-Agent", "")
    browser, os_name, device = parse_user_agent(ua_string)
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "")
    if ip and "," in ip:
        ip = ip.split(",")[0].strip()
    conn.execute(
        """INSERT INTO login_logs (user_id, name, email, browser, os, device, ip_address, login_status)
           VALUES (?,?,?,?,?,?,?,?)""",
        (user_id, name, email, browser, os_name, device, ip, status),
    )
    conn.commit()


def auto_promote_admin(conn):
    """Promote user with ADMIN_EMAIL env var to admin role on startup."""
    admin_email = os.environ.get("ADMIN_EMAIL", "").strip().lower()
    if admin_email:
        conn.execute(
            "UPDATE users SET role='admin', status='active' WHERE LOWER(email)=?",
            (admin_email,)
        )
        conn.commit()


def current_user_row(conn):
    uid = session.get("user_id")
    if uid is None:
        return None
    return conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()


def save_upload(file_storage, folder, allowed_ext, prefix):
    if not file_storage or not file_storage.filename:
        return None, None
    filename = file_storage.filename
    ext = os.path.splitext(filename)[1].lower()
    if ext not in allowed_ext:
        return None, None
    safe_name = f"{prefix}_{random.randint(1000,9999)}{ext}"
    path = os.path.join(folder, safe_name)
    file_storage.save(path)
    return filename, path


# ------------------------------------------------------------------
# Frontend routes
# ------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/favicon.ico")
def favicon():
    return ("", 204)


@app.route("/static/uploads/<path:subpath>")
def uploaded_file(subpath):
    return send_from_directory(os.path.join(BASE_DIR, "static", "uploads"), subpath)


# ------------------------------------------------------------------
# Auth API
# ------------------------------------------------------------------
@app.route("/api/register", methods=["POST"])
def register():
    name = (request.form.get("name") or "").strip()
    email = (request.form.get("email") or "").strip().lower()
    password = request.form.get("password") or ""
    skills = (request.form.get("skills") or "").strip()
    bio = (request.form.get("bio") or "").strip()
    interests = (request.form.get("interests") or "").strip()
    city = (request.form.get("city") or "").strip()
    # Auto-generate username from name
    username = re.sub(r"[^a-z0-9_]", "", name.lower().replace(" ", "_"))[:20] or "user"

    if not name or not email or not EMAIL_RE.match(email):
        return jsonify({"error": "Please provide a valid name and email."}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters."}), 400

    conn = get_db()
    existing = conn.execute("SELECT 1 FROM users WHERE email=? AND deleted=0", (email,)).fetchone()
    if existing:
        conn.close()
        return jsonify({"error": "An account with that email already exists — try logging in instead."}), 409

    resume_filename, resume_path = save_upload(
        request.files.get("resume"), UPLOAD_RESUMES, ALLOWED_RESUME_EXT, "resume"
    )
    avatar_filename, avatar_path = save_upload(
        request.files.get("avatar"), UPLOAD_AVATARS, ALLOWED_AVATAR_EXT, "avatar"
    )

    uid = gen_uid(name, conn)
    pw_hash = generate_password_hash(password)
    cur = conn.execute(
        """INSERT INTO users
           (uid, name, username, email, password_hash, skills, bio, interests, city,
            resume_filename, resume_path, avatar_path, role, status, deleted)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (uid, name, username, email, pw_hash, skills, bio, interests, city,
         resume_filename, resume_path, avatar_path, "user", "active", 0),
    )
    conn.commit()
    new_id = cur.lastrowid
    row = conn.execute("SELECT * FROM users WHERE id=?", (new_id,)).fetchone()
    session["user_id"] = row["id"]

    # Create admin notification for new registration
    now_str = datetime.now().strftime("%b %d, %Y %I:%M %p")
    create_admin_notification(
        conn,
        "new_user",
        "New User Registered",
        f"Name: {name}\nEmail: {email}\nUID: {uid}\nTime: {now_str}",
        new_id,
    )
    conn.close()
    return jsonify({"user": user_row_to_public(row, include_private=True)})


@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE email=? AND deleted=0", (email,)).fetchone()
    if not row or not check_password_hash(row["password_hash"], password):
        # Log failed attempt if user exists
        if row:
            log_login(conn, row["id"], row["name"], row["email"], "failed")
        conn.close()
        return jsonify({"error": "Incorrect email or password."}), 401

    # Check account status
    if row["status"] == "blocked":
        log_login(conn, row["id"], row["name"], row["email"], "blocked")
        conn.close()
        return jsonify({"error": "Your account has been blocked. Please contact the administrator.", "code": "BLOCKED"}), 403

    if row["status"] == "suspended" and row["suspended_until"]:
        try:
            su = datetime.strptime(row["suspended_until"], "%Y-%m-%dT%H:%M")
        except ValueError:
            try:
                su = datetime.strptime(row["suspended_until"], "%Y-%m-%d %H:%M:%S")
            except ValueError:
                su = None
        if su and datetime.now() < su:
            log_login(conn, row["id"], row["name"], row["email"], "suspended")
            conn.close()
            return jsonify({"error": f"Your account is suspended until {row['suspended_until']}. Reason: {row['suspend_reason'] or 'Not specified'}.", "code": "SUSPENDED"}), 403
        else:
            # Suspension expired, reactivate
            conn.execute("UPDATE users SET status='active', suspended_until=NULL WHERE id=?", (row["id"],))
            conn.commit()

    # Successful login
    session["user_id"] = row["id"]
    conn.execute(
        "UPDATE users SET last_login=CURRENT_TIMESTAMP WHERE id=?", (row["id"],)
    )
    conn.commit()
    log_login(conn, row["id"], row["name"], row["email"], "success")

    # Admin notification for login
    create_admin_notification(
        conn,
        "login",
        "User Logged In",
        f"{row['name']} ({row['email']}) logged in",
        row["id"],
    )
    conn.close()
    return jsonify({"user": user_row_to_public(row, include_private=True)})


@app.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/me")
def me():
    conn = get_db()
    row = current_user_row(conn)
    conn.close()
    if not row:
        return jsonify({"user": None}), 200
    return jsonify({"user": user_row_to_public(row, include_private=True)})


@app.route("/api/update-profile", methods=["POST"])
@login_required
def update_profile():
    conn = get_db()
    row = current_user_row(conn)
    updates, params = [], []

    if request.form.get("name"):
        name_val = request.form.get("name").strip()[:100]
        if name_val:
            updates.append("name=?"); params.append(name_val)
    if request.form.get("skills") is not None:
        updates.append("skills=?"); params.append(request.form.get("skills").strip())
    if request.form.get("bio") is not None:
        updates.append("bio=?"); params.append(request.form.get("bio").strip())
    if request.form.get("interests") is not None:
        updates.append("interests=?"); params.append(request.form.get("interests").strip())
    if request.form.get("city") is not None:
        updates.append("city=?"); params.append(request.form.get("city").strip())
    if request.form.get("avatar_emoji"):
        updates.append("avatar_emoji=?"); params.append(request.form.get("avatar_emoji")[:8])
    if request.form.get("car_color"):
        updates.append("car_color=?"); params.append(request.form.get("car_color")[:9])

    # "Remove Photo" — clears the uploaded avatar and falls back to the emoji avatar
    if request.form.get("remove_avatar") == "1":
        if row["avatar_path"] and os.path.exists(row["avatar_path"]):
            try:
                os.remove(row["avatar_path"])
            except OSError:
                pass
        updates.append("avatar_path=?"); params.append(None)

    avatar_file = request.files.get("avatar")
    if avatar_file and avatar_file.filename:
        if row["avatar_path"] and os.path.exists(row["avatar_path"]):
            try:
                os.remove(row["avatar_path"])
            except OSError:
                pass
        _, avatar_path = save_upload(avatar_file, UPLOAD_AVATARS, ALLOWED_AVATAR_EXT, "avatar")
        if avatar_path:
            updates.append("avatar_path=?"); params.append(avatar_path)

    if updates:
        params.append(row["id"])
        conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id=?", params)
        conn.commit()

    fresh = conn.execute("SELECT * FROM users WHERE id=?", (row["id"],)).fetchone()
    conn.close()
    return jsonify({"user": user_row_to_public(fresh, include_private=True)})


@app.route("/api/change-password", methods=["POST"])
@login_required
def change_password():
    data = request.get_json(silent=True) or {}
    old_password = data.get("old_password") or ""
    new_password = data.get("new_password") or ""
    if len(new_password) < 6:
        return jsonify({"error": "New password must be at least 6 characters."}), 400

    conn = get_db()
    row = current_user_row(conn)
    if not row or not check_password_hash(row["password_hash"], old_password):
        conn.close()
        return jsonify({"error": "Current password is incorrect."}), 401
    conn.execute(
        "UPDATE users SET password_hash=? WHERE id=?",
        (generate_password_hash(new_password), row["id"]),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/delete-account", methods=["POST"])
@login_required
def delete_account():
    data = request.get_json(silent=True) or {}
    password = data.get("password") or ""

    conn = get_db()
    row = current_user_row(conn)
    if not row or not check_password_hash(row["password_hash"], password):
        conn.close()
        return jsonify({"error": "Incorrect password."}), 401

    # remove uploaded files belonging to this user
    for path in (row["resume_path"], row["avatar_path"]):
        if path and os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass

    conn.execute("DELETE FROM users WHERE id=?", (row["id"],))
    conn.commit()
    conn.close()
    session.clear()
    return jsonify({"ok": True})


# ------------------------------------------------------------------
# Directory (Building 7 — Contacts House: real registered users only)
# ------------------------------------------------------------------
@app.route("/api/directory")
@login_required
def directory():
    conn = get_db()
    me_row = current_user_row(conn)
    q = (request.args.get("q") or "").strip()
    if q:
        like = f"%{q}%"
        rows = conn.execute(
            """SELECT uid, name, skills, city, avatar_path, avatar_emoji, last_seen FROM users
               WHERE id != ? AND (name LIKE ? OR uid LIKE ? OR skills LIKE ? OR city LIKE ?)
               ORDER BY created_at DESC LIMIT 100""",
            (me_row["id"], like, like, like, like),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT uid, name, skills, city, avatar_path, avatar_emoji, last_seen FROM users WHERE id != ? ORDER BY created_at DESC LIMIT 100",
            (me_row["id"],),
        ).fetchall()
    conn.close()
    out = []
    for r in rows:
        out.append({
            "uid": r["uid"], "name": r["name"], "skills": r["skills"], "city": r["city"],
            "pic": f"/static/uploads/avatars/{os.path.basename(r['avatar_path'])}" if r["avatar_path"] else None,
            "avatarEmoji": r["avatar_emoji"],
            "online": is_online(r["last_seen"]),
            "lastSeen": r["last_seen"],
        })
    return jsonify({"users": out})


@app.route("/api/user/<uid>")
@login_required
def get_user_by_uid(uid):
    """Building 5 — S2 AI Agent 'friend resume access' lookup."""
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE uid=?", (uid,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "No S2 Talk user with that ID."}), 404
    return jsonify({"user": user_row_to_public(row, include_private=True)})


# ------------------------------------------------------------------
# Scores & Leaderboard (Result House — real users, real scores)
# ------------------------------------------------------------------
@app.route("/api/score", methods=["POST"])
@login_required
def submit_score():
    data = request.get_json(silent=True) or {}
    category = (data.get("category") or "").strip()[:20]
    points = int(data.get("points") or 0)
    meta = (data.get("meta") or "")[:200]
    if category not in {"interview", "skills", "game", "project"}:
        return jsonify({"error": "Invalid category."}), 400

    conn = get_db()
    row = current_user_row(conn)
    conn.execute(
        "INSERT INTO scores (user_id, category, points, meta) VALUES (?,?,?,?)",
        (row["id"], category, points, meta),
    )
    # keep a running best/total score on the user row for fast leaderboard sorting
    total = conn.execute(
        "SELECT COALESCE(SUM(points),0) AS t FROM scores WHERE user_id=?", (row["id"],)
    ).fetchone()["t"]
    conn.execute("UPDATE users SET score=? WHERE id=?", (total, row["id"]))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "total_score": total})


@app.route("/api/leaderboard")
@login_required
def leaderboard():
    conn = get_db()
    rows = conn.execute(
        "SELECT uid, name, avatar_path, avatar_emoji, score FROM users ORDER BY score DESC LIMIT 20"
    ).fetchall()
    conn.close()
    out = []
    for r in rows:
        out.append(
            {
                "uid": r["uid"],
                "name": r["name"],
                "score": r["score"],
                "pic": f"/static/uploads/avatars/{os.path.basename(r['avatar_path'])}" if r["avatar_path"] else None,
                "avatarEmoji": r["avatar_emoji"],
            }
        )
    return jsonify({"leaderboard": out})


# ------------------------------------------------------------------
# Friends — requests, accept/reject, friend list (Contacts House)
# ------------------------------------------------------------------
@app.route("/api/friends/request", methods=["POST"])
@login_required
def friend_request():
    data = request.get_json(silent=True) or {}
    target_uid = (data.get("uid") or "").strip()
    conn = get_db()
    me_row = current_user_row(conn)
    target = conn.execute("SELECT * FROM users WHERE uid=?", (target_uid,)).fetchone()
    if not target:
        conn.close()
        return jsonify({"error": "No S2 Talk user with that ID."}), 404
    if target["id"] == me_row["id"]:
        conn.close()
        return jsonify({"error": "You can't friend yourself."}), 400

    existing = conn.execute(
        """SELECT * FROM friends WHERE
           (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)""",
        (me_row["id"], target["id"], target["id"], me_row["id"]),
    ).fetchone()
    if existing:
        if existing["status"] == "accepted":
            conn.close()
            return jsonify({"error": "You're already friends."}), 409
        if existing["status"] == "rejected":
            conn.execute(
                "UPDATE friends SET status='pending', requester_id=?, addressee_id=? WHERE id=?",
                (me_row["id"], target["id"], existing["id"])
            )
            conn.commit(); conn.close()
            return jsonify({"ok": True})
        if existing["status"] == "pending" and existing["requester_id"] == target["id"]:
            # they already requested us — accept it instead of duplicating
            conn.execute("UPDATE friends SET status='accepted' WHERE id=?", (existing["id"],))
            conn.commit(); conn.close()
            return jsonify({"ok": True, "auto_accepted": True})
        conn.close()
        return jsonify({"error": "A friend request already exists between you two."}), 409

    conn.execute(
        "INSERT INTO friends (requester_id, addressee_id, status) VALUES (?,?, 'pending')",
        (me_row["id"], target["id"]),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/friends/respond", methods=["POST"])
@login_required
def friend_respond():
    data = request.get_json(silent=True) or {}
    request_id = data.get("request_id")
    action = data.get("action")  # accept | reject
    if action not in ("accept", "reject"):
        return jsonify({"error": "Invalid action."}), 400
    conn = get_db()
    me_row = current_user_row(conn)
    row = conn.execute(
        "SELECT * FROM friends WHERE id=? AND addressee_id=?", (request_id, me_row["id"])
    ).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Request not found."}), 404
    conn.execute(
        "UPDATE friends SET status=? WHERE id=?",
        ("accepted" if action == "accept" else "rejected", request_id),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/friends/remove", methods=["POST"])
@login_required
def friend_remove():
    """Remove a friend or pending request, moving them to rejected status."""
    data = request.get_json(silent=True) or {}
    target_uid = (data.get("uid") or "").strip()
    if not target_uid:
        return jsonify({"error": "Missing uid."}), 400
    conn = get_db()
    me_row = current_user_row(conn)
    target = conn.execute("SELECT * FROM users WHERE uid=?", (target_uid,)).fetchone()
    if not target:
        conn.close()
        return jsonify({"error": "No S2 Talk user with that ID."}), 404
    row = conn.execute(
        """SELECT * FROM friends WHERE
           ((requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?))""",
        (me_row["id"], target["id"], target["id"], me_row["id"]),
    ).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "No friend relationship or request found."}), 404
    conn.execute("UPDATE friends SET status='rejected' WHERE id=?", (row["id"],))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/friends/list")
@login_required
def friends_list():
    conn = get_db()
    me_row = current_user_row(conn)

    incoming = conn.execute(
        """SELECT f.id AS request_id, u.uid, u.name FROM friends f
           JOIN users u ON u.id = f.requester_id
           WHERE f.addressee_id=? AND f.status='pending'""",
        (me_row["id"],),
    ).fetchall()

    accepted = conn.execute(
        """SELECT u.uid, u.name, u.skills, u.avatar_path, u.avatar_emoji, u.last_seen FROM friends f
           JOIN users u ON u.id = (CASE WHEN f.requester_id=? THEN f.addressee_id ELSE f.requester_id END)
           WHERE (f.requester_id=? OR f.addressee_id=?) AND f.status='accepted'""",
        (me_row["id"], me_row["id"], me_row["id"]),
    ).fetchall()

    conn.close()
    return jsonify(
        {
            "incoming_requests": [dict(r) for r in incoming],
            "friends": [
                {
                    "uid": r["uid"], "name": r["name"], "skills": r["skills"],
                    "pic": f"/static/uploads/avatars/{os.path.basename(r['avatar_path'])}" if r["avatar_path"] else None,
                    "avatarEmoji": r["avatar_emoji"],
                    "online": is_online(r["last_seen"]),
                    "lastSeen": r["last_seen"],
                }
                for r in accepted
            ],
        }
    )


# ------------------------------------------------------------------
# Messages (Talk House — real persisted 1:1 chat between friends)
# ------------------------------------------------------------------
def are_friends(conn, a_id, b_id):
    row = conn.execute(
        """SELECT 1 FROM friends WHERE status='accepted' AND
           ((requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?))""",
        (a_id, b_id, b_id, a_id),
    ).fetchone()
    return bool(row)


@app.route("/api/messages/recent-summary")
@login_required
def messages_recent_summary():
    """Lightweight polling endpoint for the background poller: returns
    the most recent messages across ALL of the current user's
    conversations in a single query, grouped by friend uid — instead of
    the client making one /api/messages/<uid> request per friend on
    every poll tick, which doesn't scale as the friend list grows."""
    conn = get_db()
    me_row = current_user_row(conn)
    rows = conn.execute(
        """SELECT m.id, m.sender_id, m.recipient_id, m.content, m.attachment_url,
                  m.attachment_type, m.deleted_by_sender, m.deleted_by_recipient,
                  m.created_at, su.uid AS sender_uid, ru.uid AS recipient_uid
           FROM messages m
           JOIN users su ON su.id = m.sender_id
           JOIN users ru ON ru.id = m.recipient_id
           WHERE m.sender_id=? OR m.recipient_id=?
           ORDER BY m.created_at DESC LIMIT 100""",
        (me_row["id"], me_row["id"]),
    ).fetchall()
    conn.close()

    by_friend = {}
    for r in rows:
        is_sender = r["sender_id"] == me_row["id"]
        if is_sender and r["deleted_by_sender"]:
            continue
        if not is_sender and r["deleted_by_recipient"]:
            continue
        friend_uid = r["recipient_uid"] if is_sender else r["sender_uid"]
        by_friend.setdefault(friend_uid, []).append({
            "id": r["id"],
            "from": "me" if is_sender else "them",
            "text": r["content"],
            "attachmentUrl": r["attachment_url"],
            "attachmentType": r["attachment_type"],
            "at": r["created_at"],
        })
    for fuid in by_friend:
        by_friend[fuid].reverse()  # oldest-first, matching /api/messages/<uid>
    return jsonify({"messagesByFriend": by_friend})


@app.route("/api/messages/<uid>")
@login_required
def get_messages(uid):
    conn = get_db()
    me_row = current_user_row(conn)
    other = conn.execute("SELECT * FROM users WHERE uid=?", (uid,)).fetchone()
    if not other:
        conn.close()
        return jsonify({"error": "User not found."}), 404
    if not are_friends(conn, me_row["id"], other["id"]):
        conn.close()
        return jsonify({"error": "You can only message accepted friends."}), 403
    rows = conn.execute(
        """SELECT id, sender_id, recipient_id, content, attachment_url, attachment_type, deleted_by_sender, deleted_by_recipient, created_at FROM messages
           WHERE ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?))
           ORDER BY created_at ASC LIMIT 200""",
        (me_row["id"], other["id"], other["id"], me_row["id"]),
    ).fetchall()
    conn.close()
    
    out = []
    for r in rows:
        is_sender = r["sender_id"] == me_row["id"]
        if is_sender and r["deleted_by_sender"]:
            continue
        if not is_sender and r["deleted_by_recipient"]:
            continue
        out.append({
            "id": r["id"],
            "from": "me" if is_sender else "them",
            "text": r["content"],
            "attachmentUrl": r["attachment_url"],
            "attachmentType": r["attachment_type"],
            "at": r["created_at"],
        })
    return jsonify({"messages": out})


@app.route("/api/messages/<uid>", methods=["POST"])
@login_required
def send_message(uid):
    data = request.get_json(silent=True) or {}
    content = (data.get("text") or "").strip()[:4000]
    attachment_type = (data.get("attachmentType") or None)  # e.g. "share" — for project/interview/skills previews
    if not content:
        return jsonify({"error": "Message cannot be empty."}), 400
    conn = get_db()
    me_row = current_user_row(conn)
    other = conn.execute("SELECT * FROM users WHERE uid=?", (uid,)).fetchone()
    if not other:
        conn.close()
        return jsonify({"error": "User not found."}), 404
    if not are_friends(conn, me_row["id"], other["id"]):
        conn.close()
        return jsonify({"error": "You can only message accepted friends."}), 403
    conn.execute(
        "INSERT INTO messages (sender_id, recipient_id, content, attachment_type) VALUES (?,?,?,?)",
        (me_row["id"], other["id"], content, attachment_type),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/messages/<uid>/voice", methods=["POST"])
@login_required
def send_voice_message(uid):
    """Voice message: uploads a short audio clip and stores it as a chat
    attachment (Talk House 'Voice Messages' feature)."""
    conn = get_db()
    me_row = current_user_row(conn)
    other = conn.execute("SELECT * FROM users WHERE uid=?", (uid,)).fetchone()
    if not other:
        conn.close()
        return jsonify({"error": "User not found."}), 404
    if not are_friends(conn, me_row["id"], other["id"]):
        conn.close()
        return jsonify({"error": "You can only message accepted friends."}), 403
    audio_file = request.files.get("audio")
    _, saved_path = save_upload(audio_file, UPLOAD_VOICE, ALLOWED_VOICE_EXT, "voice")
    if not saved_path:
        conn.close()
        return jsonify({"error": "Could not save the voice message (unsupported format)."}), 400
    attachment_url = f"/static/uploads/voice/{os.path.basename(saved_path)}"
    conn.execute(
        "INSERT INTO messages (sender_id, recipient_id, content, attachment_url, attachment_type) VALUES (?,?,?,?,?)",
        (me_row["id"], other["id"], "🎤 Voice message", attachment_url, "voice"),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "attachmentUrl": attachment_url})


UPLOAD_RECORDINGS = os.path.join(BASE_DIR, "static", "uploads", "recordings")
os.makedirs(UPLOAD_RECORDINGS, exist_ok=True)

@app.route("/api/recordings/upload", methods=["POST"])
@login_required
def upload_recording():
    if "video" not in request.files:
        return jsonify({"error": "No video file provided."}), 400
    video_file = request.files["video"]
    if not video_file.filename:
        return jsonify({"error": "Empty filename."}), 400
    ext = os.path.splitext(video_file.filename)[1].lower() or ".webm"
    import secrets
    safe_name = f"rec_{secrets.token_hex(8)}{ext}"
    path = os.path.join(UPLOAD_RECORDINGS, safe_name)
    video_file.save(path)
    url = f"/static/uploads/recordings/{safe_name}"
    return jsonify({"ok": True, "url": url})


UPLOAD_PHOTOS = os.path.join(BASE_DIR, "static", "uploads", "photos")
os.makedirs(UPLOAD_PHOTOS, exist_ok=True)

@app.route("/api/photos/upload", methods=["POST"])
@login_required
def upload_photo():
    """Persist a captured/base64 photo (data URL) to disk and return a URL.
    Sharing a photo used to embed the full base64 data URL as chat message
    text, which was silently truncated at 4000 chars — corrupting the JSON
    payload so friends could never receive it. Uploading first and sharing
    a short URL instead fixes that."""
    data = request.get_json(silent=True) or {}
    data_url = data.get("dataUrl") or ""
    m = re.match(r"^data:image/(png|jpeg|jpg|webp);base64,(.+)$", data_url, re.DOTALL)
    if not m:
        return jsonify({"error": "Invalid image data."}), 400
    ext = "jpg" if m.group(1) in ("jpeg", "jpg") else m.group(1)
    try:
        raw = base64.b64decode(m.group(2))
    except Exception:
        return jsonify({"error": "Could not decode image data."}), 400
    if len(raw) > 8 * 1024 * 1024:
        return jsonify({"error": "Photo too large."}), 400
    safe_name = f"photo_{secrets.token_hex(8)}.{ext}"
    path = os.path.join(UPLOAD_PHOTOS, safe_name)
    with open(path, "wb") as f:
        f.write(raw)
    url = f"/static/uploads/photos/{safe_name}"
    return jsonify({"ok": True, "url": url})


@app.route("/api/messages/delete", methods=["POST"])
@login_required
def delete_messages():
    data = request.get_json(silent=True) or {}
    msg_ids = data.get("msg_ids") or []
    mode = data.get("mode") # "me" or "everyone"
    if not msg_ids:
        return jsonify({"error": "No message IDs specified."}), 400
    conn = get_db()
    me_row = current_user_row(conn)
    for msg_id in msg_ids:
        msg = conn.execute("SELECT * FROM messages WHERE id=?", (msg_id,)).fetchone()
        if not msg:
            continue
        if msg["sender_id"] != me_row["id"] and msg["recipient_id"] != me_row["id"]:
            continue # unauthorized
        if mode == "everyone" and msg["sender_id"] == me_row["id"]:
            conn.execute("DELETE FROM messages WHERE id=?", (msg_id,))
        else:
            if msg["sender_id"] == me_row["id"]:
                conn.execute("UPDATE messages SET deleted_by_sender=1 WHERE id=?", (msg_id,))
            else:
                conn.execute("UPDATE messages SET deleted_by_recipient=1 WHERE id=?", (msg_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ------------------------------------------------------------------
# Password recovery (Forgot Password -> Email OTP -> Reset)
# NOTE: no SMTP is configured out of the box, so the OTP is returned
# in the API response in dev mode (S2TALK_DEV_OTP=1, default on) so the
# flow is fully testable without an email provider. Set
# S2TALK_DEV_OTP=0 and wire send_otp_email() to a real provider (see
# ADMIN_SETUP.md) before deploying this for real users.
# ------------------------------------------------------------------
OTP_TTL_MINUTES = 10
DEV_OTP_MODE = os.environ.get("S2TALK_DEV_OTP", "1") != "0"


def send_otp_email(to_email, otp):
    """Replace this with a real email send (SMTP / SendGrid / SES...).
    For now it just logs to the server console."""
    print(f"[S2 Talk] Password reset OTP for {to_email}: {otp} (valid {OTP_TTL_MINUTES} min)")


@app.route("/api/forgot-password", methods=["POST"])
def forgot_password():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if not row:
        conn.close()
        # don't reveal whether the email exists
        return jsonify({"ok": True})

    otp = f"{random.randint(0, 999999):06d}"
    otp_hash = hashlib.sha256(otp.encode()).hexdigest()
    expires_at = (datetime.now() + timedelta(minutes=OTP_TTL_MINUTES)).strftime("%Y-%m-%d %H:%M:%S")
    conn.execute("UPDATE password_resets SET used=1 WHERE user_id=? AND used=0", (row["id"],))
    conn.execute(
        "INSERT INTO password_resets (user_id, otp_hash, expires_at) VALUES (?,?,?)",
        (row["id"], otp_hash, expires_at),
    )
    conn.commit()
    conn.close()
    send_otp_email(email, otp)
    resp = {"ok": True, "expires_in_seconds": OTP_TTL_MINUTES * 60}
    if DEV_OTP_MODE:
        resp["dev_otp"] = otp  # remove this in production once real email is wired up
    return jsonify(resp)


@app.route("/api/verify-otp", methods=["POST"])
def verify_otp():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    otp = (data.get("otp") or "").strip()
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Invalid email or OTP."}), 400
    otp_hash = hashlib.sha256(otp.encode()).hexdigest()
    reset_row = conn.execute(
        """SELECT * FROM password_resets WHERE user_id=? AND used=0
           ORDER BY created_at DESC LIMIT 1""",
        (row["id"],),
    ).fetchone()
    if not reset_row or reset_row["otp_hash"] != otp_hash:
        conn.close()
        return jsonify({"error": "Invalid or expired OTP."}), 400
    if datetime.now() > datetime.strptime(reset_row["expires_at"], "%Y-%m-%d %H:%M:%S"):
        conn.close()
        return jsonify({"error": "This OTP has expired. Please request a new one."}), 400
    reset_token = secrets.token_urlsafe(24)
    conn.execute(
        "UPDATE password_resets SET otp_hash=? WHERE id=?",
        (hashlib.sha256(reset_token.encode()).hexdigest(), reset_row["id"]),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "reset_token": reset_token})


@app.route("/api/reset-password", methods=["POST"])
def reset_password():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    reset_token = (data.get("reset_token") or "").strip()
    new_password = data.get("new_password") or ""
    if len(new_password) < 6:
        return jsonify({"error": "New password must be at least 6 characters."}), 400
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Invalid request."}), 400
    token_hash = hashlib.sha256(reset_token.encode()).hexdigest()
    reset_row = conn.execute(
        """SELECT * FROM password_resets WHERE user_id=? AND used=0 AND otp_hash=?
           ORDER BY created_at DESC LIMIT 1""",
        (row["id"], token_hash),
    ).fetchone()
    if not reset_row or datetime.now() > datetime.strptime(reset_row["expires_at"], "%Y-%m-%d %H:%M:%S"):
        conn.close()
        return jsonify({"error": "This reset link has expired. Please start over."}), 400
    conn.execute("UPDATE users SET password_hash=? WHERE id=?", (generate_password_hash(new_password), row["id"]))
    conn.execute("UPDATE password_resets SET used=1 WHERE id=?", (reset_row["id"],))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})



# ------------------------------------------------------------------
@app.route("/api/ai", methods=["POST"])
@login_required
def ai_proxy():
    data = request.get_json(silent=True) or {}
    system = data.get("system") or ""
    messages = data.get("messages") or []
    max_tokens = int(data.get("max_tokens") or 500)

    ok, message = validate_api()
    if not ok:
        # Friendly, non-crashing response when no key is configured —
        # e.g. "Gemini API key not found. Please add GEMINI_API_KEY to
        # your .env file." See ADMIN_SETUP.md for full setup steps.
        return jsonify({"text": f"({message} See ADMIN_SETUP.md for setup instructions.)"})

    try:
        text = generate_response(system, messages, max_tokens)
        return jsonify({"text": text or "Sorry, I couldn't generate a response just now."})
    except AIProviderError as exc:
        # The real upstream error is never hidden behind a generic 502 —
        # this applies to every provider (Gemini, OpenAI, Anthropic, Groq).
        print(f"[{exc.provider}] request failed: {exc}")
        return jsonify({
            "text": f"AI service error ({exc.provider}): {exc.message}",
            "error": exc.message,
            "provider": exc.provider,
            "model": exc.model,
            "upstream_status": exc.status_code,
        }), 502


@app.route("/api/ai/health", methods=["GET"])
@login_required
def ai_health():
    """Diagnostics endpoint — confirms which AI provider/model is active
    and whether its API key actually loaded, without digging through
    server logs. Matches issue 6's 'automatic detection' requirement."""
    return jsonify(health_check())


# ------------------------------------------------------------------
# Resume parsing assist — the browser extracts raw text (pdf.js /
# mammoth.js) and posts it here; we run lightweight heuristics to
# pull out a summary + skills/experience/education/interests so the
# Create Account form can auto-fill (still user-editable afterwards).
# ------------------------------------------------------------------
SKILL_KEYWORDS = [
    "python", "java", "javascript", "typescript", "c++", "c#", "react", "node.js", "node",
    "flask", "django", "sql", "mysql", "postgresql", "mongodb", "aws", "azure", "gcp",
    "docker", "kubernetes", "git", "html", "css", "machine learning", "deep learning",
    "data science", "pandas", "numpy", "tensorflow", "pytorch", "excel", "figma",
    "project management", "communication", "leadership", "problem solving",
]


@app.route("/api/parse-resume", methods=["POST"])
def parse_resume():
    text = ""
    # 1. Check if a PDF file was uploaded directly via multipart form
    uploaded_file = request.files.get("file") or request.files.get("resume")
    if uploaded_file and uploaded_file.filename:
        try:
            import io
            import pypdf
            pdf_bytes = io.BytesIO(uploaded_file.read())
            reader = pypdf.PdfReader(pdf_bytes)
            extracted = []
            for page in reader.pages:
                txt = page.extract_text()
                if txt:
                    extracted.append(txt)
            text = "\n".join(extracted)
        except Exception:
            pass

    # 2. Fallback to JSON payload or form field if no file text extracted
    if not text.strip():
        data = request.get_json(silent=True) or {}
        text = (data.get("text") or request.form.get("text") or "")[:20000]

    if not text.strip():
        return jsonify({"error": "No resume text or file received."}), 400


    lower = text.lower()
    found_skills = sorted({kw for kw in SKILL_KEYWORDS if kw in lower})

    def grab_section(*headers):
        for h in headers:
            m = re.search(rf"{h}\s*[:\n]?\s*(.{{0,400}})", text, re.IGNORECASE | re.DOTALL)
            if m:
                chunk = m.group(1).strip()
                cut = re.search(
                    r"(EDUCATION|EXPERIENCE|SKILLS|PROJECTS|INTERESTS|CERTIFICATIONS)\b",
                    chunk,
                    re.IGNORECASE,
                )
                return (chunk[: cut.start()] if cut else chunk).strip()[:400]
        return ""

    experience = grab_section("EXPERIENCE", "WORK EXPERIENCE", "EMPLOYMENT")
    education = grab_section("EDUCATION", "ACADEMIC BACKGROUND")
    interests = grab_section("INTERESTS", "HOBBIES")
    projects = grab_section("PROJECTS", "PERSONAL PROJECTS")

    # Extract primary skills and project mentions
    skills_title = [s.title() for s in found_skills]
    
    # Try to extract project names from projects section or general text
    proj_match = re.findall(r"(?:project|built|created|developed)\s*[:\-]?\s*([A-Za-z0-9_\-\s]{2,30})", text, re.IGNORECASE)
    proj_names = []
    if proj_match:
        for pm in proj_match:
            cleaned_p = pm.strip().strip(":,.-")
            if cleaned_p and len(cleaned_p) > 2 and cleaned_p.lower() not in ("the", "a", "an", "this", "my", "using", "with"):
                proj_names.append(cleaned_p)
                if len(proj_names) >= 2:
                    break

    # Build fluent summary string
    if len(skills_title) >= 2:
        skills_headline = ", ".join(skills_title[:-1]) + " and " + skills_title[-1]
    elif len(skills_title) == 1:
        skills_headline = skills_title[0]
    else:
        skills_headline = "Software"

    summary_sentence = f"Experienced {skills_headline} developer"
    
    if len(skills_title) >= 3:
        summary_sentence += f" proficient in {skills_title[0]} and {skills_title[1]}"

    if proj_names:
        summary_sentence += f" with projects including {', '.join(proj_names)}"
    elif projects:
        short_p = projects.split('\n')[0][:50].strip()
        if short_p:
            summary_sentence += f" with project work in {short_p}"

    if education:
        short_edu = education.split('\n')[0][:60].strip()
        if short_edu:
            summary_sentence += f". Education: {short_edu}"

    summary_sentence += "."

    return jsonify(
        {
            "summary": summary_sentence,
            "skills": ", ".join(skills_title),
            "experience": experience,
            "education": education,
            "interests": interests,
            "projects": projects,
        }
    )



def format_terminal_output(stdout, user_input):
    if not user_input:
        return stdout
    inputs = [x for x in user_input.split('\n') if x != '']
    if not inputs:
        return stdout
    import re
    parts = re.split(r'(:[ \t]*|\?[ \t]*)', stdout)
    res = []
    inp_idx = 0
    i = 0
    while i < len(parts):
        res.append(parts[i])
        if i + 1 < len(parts) and (parts[i+1].startswith(':') or parts[i+1].startswith('?')):
            res.append(parts[i+1])
            if inp_idx < len(inputs):
                res.append(inputs[inp_idx] + '\n')
                inp_idx += 1
            i += 2
        else:
            i += 1
    while inp_idx < len(inputs):
        res.append(inputs[inp_idx] + '\n')
        inp_idx += 1
    return ''.join(res).strip()




def _posix_limit_child():
    """preexec_fn applied inside the forked child (POSIX only), before exec.
    Caps CPU time, memory, open files, and process/thread count so a
    single compiled C/C++ program can never fork-bomb, runaway-allocate,
    or otherwise exhaust the container's process table. This is what
    causes 'OCI runtime error: crun: clone: Resource temporarily
    unavailable' once the ceiling is hit — after that point EVERY new
    process in the container (including the next request's compiler
    invocation) fails to spawn, not just the offending one."""
    try:
        os.setsid()  # own process group, so a timeout can kill the whole tree
    except Exception:
        pass
    if resource is not None:
        try:
            resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
            resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
            resource.setrlimit(resource.RLIMIT_NPROC, (32, 32))
            resource.setrlimit(resource.RLIMIT_FSIZE, (10 * 1024 * 1024, 10 * 1024 * 1024))
        except Exception:
            pass


def _run_sandboxed(cmd, input_text, timeout):
    """Like subprocess.run(), but on POSIX: applies _posix_limit_child and,
    on timeout, kills the *entire* process group rather than just the
    immediate child. Compilers spawn helper processes (cc1/cc1plus/as/ld)
    and a hung/looping user program can spawn its own children — killing
    only the top-level process on timeout leaves those orphaned, and they
    slowly eat the same process-table budget over many requests."""
    if os.name == "nt":
        return subprocess.run(cmd, input=input_text, capture_output=True, text=True, timeout=timeout)
    proc = subprocess.Popen(
        cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, preexec_fn=_posix_limit_child, start_new_session=True
    )
    try:
        out, err = proc.communicate(input=input_text, timeout=timeout)
        return subprocess.CompletedProcess(cmd, proc.returncode, out, err)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        try:
            proc.communicate(timeout=2)
        except Exception:
            pass
        raise


@app.route("/api/run-code", methods=["POST"])
def run_code():
    try:
        return _run_code_impl()
    except Exception:
        return jsonify({"output": "⚠️ Execution environment is currently offline. Please try again shortly."})


def _run_code_impl():
    data = request.get_json(silent=True) or {}
    lang = (data.get("language") or "python").lower()
    code = data.get("code") or ""
    user_input = data.get("input") or ""

    if not code.strip():
        return jsonify({"output": "No code provided."})

    if lang in ("python", "python3", "py"):
        try:
            res = subprocess.run(
                [sys.executable, "-c", code],
                input=user_input,
                capture_output=True,
                text=True,
                timeout=10
            )
            out = res.stdout or ""
            err = res.stderr or ""
            need_input = ("EOFError" in err) or (out.strip().endswith(":") or out.strip().endswith("?"))
            clean_out = format_terminal_output(out, user_input)
            if not clean_out and err and "EOFError" not in err:
                clean_out = err.strip()
            return jsonify({
                "output": clean_out if clean_out else "(No Output)",
                "raw_stdout": out,
                "need_input": need_input
            })
        except subprocess.TimeoutExpired:
            return jsonify({"output": "Execution timed out (10s limit)."}), 400
        except Exception as exc:
            return jsonify({"output": f"Execution error: {exc}"}), 500

    elif lang in ("c", "cpp"):
        compiler = "gcc" if lang == "c" else "g++"
        src_ext = ".c" if lang == "c" else ".cpp"

        # 1. Try local compilation if compiler is installed on system.
        #    Both the compiler and the resulting binary run sandboxed
        #    (CPU/memory/process-count limits, own process group) so a
        #    single submission — buggy or a deliberate fork bomb — can
        #    never exhaust the container's process table for everyone.
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                src_path = os.path.join(tmpdir, f"main{src_ext}")
                bin_path = os.path.join(tmpdir, "main.exe" if os.name == "nt" else "main")
                with open(src_path, "w", encoding="utf-8") as f:
                    f.write(code)
                comp = _run_sandboxed([compiler, src_path, "-o", bin_path], None, timeout=10)
                if comp.returncode != 0:
                    return jsonify({"output": f"Compilation Error:\n{comp.stderr}"})

                # stdout/stderr are fully buffered (not line-buffered) once
                # piped, so output printed right before a crash can be lost
                # entirely unless we force line buffering here.
                run_cmd = [bin_path]
                if os.name != "nt" and shutil.which("stdbuf"):
                    run_cmd = ["stdbuf", "-oL", "-eL", bin_path]

                exec_res = _run_sandboxed(run_cmd, user_input, timeout=10)
                out = exec_res.stdout or ""
                err = exec_res.stderr or ""
                need_input = out.strip().endswith(":") or out.strip().endswith("?")
                clean_out = format_terminal_output(out, user_input)

                runtime_note = None
                if exec_res.returncode is not None and exec_res.returncode < 0:
                    # Killed by a signal — a crash (segfault, division by
                    # zero, abort, etc.) — previously this produced an
                    # empty "(No Output)" with no indication anything
                    # went wrong at all.
                    sig_num = -exec_res.returncode
                    try:
                        sig_desc = signal.strsignal(sig_num) or signal.Signals(sig_num).name
                    except Exception:
                        sig_desc = f"signal {sig_num}"
                    runtime_note = f"⚠️ Runtime Error: the program crashed ({sig_desc})."

                if runtime_note:
                    clean_out = f"{clean_out}\n{runtime_note}" if clean_out else runtime_note
                elif not clean_out and err:
                    clean_out = err.strip()

                return jsonify({
                    "output": clean_out if clean_out else "(No Output)",
                    "raw_stdout": out,
                    "need_input": need_input
                })
        except subprocess.TimeoutExpired:
            return jsonify({"output": "Execution timed out (10s limit)."}), 400
        except (OSError, BlockingIOError):
            # The OS refused to spawn the process (e.g. the container is
            # temporarily out of process-table headroom). Don't surface
            # the raw OS error — fall through to the cloud fallbacks below.
            pass
        except Exception:
            pass

        # 2. Fallback to Cloud Compiler Engine (Wandbox)
        try:
            wandbox_compiler = "gcc-head" if lang == "cpp" else "gcc-head-c"
            payload = json_lib.dumps({
                "compiler": wandbox_compiler,
                "code": code,
                "stdin": user_input
            }).encode("utf-8")
            req = urllib.request.Request(
                "https://wandbox.org/api/compile.json",
                data=payload,
                headers={"Content-Type": "application/json", "User-Agent": "S2Talk/1.0"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=12) as resp:
                wdata = json_lib.loads(resp.read().decode("utf-8"))
                out = wdata.get("program_output") or wdata.get("compiler_error") or wdata.get("compiler_output") or "(No Output)"
                clean_out = format_terminal_output(out, user_input)
                need_input = out.strip().endswith(":") or out.strip().endswith("?")
                return jsonify({"output": clean_out, "need_input": need_input})
        except Exception:
            pass

        # 3. Fallback to Paiza IO
        try:
            p_lang = "c" if lang == "c" else "cpp"
            form_data = urllib.parse.urlencode({
                "source_code": code,
                "language": p_lang,
                "input": user_input,
                "api_key": "guest"
            }).encode("utf-8")
            req = urllib.request.Request("https://api.paiza.io/runners/create", data=form_data, method="POST")
            with urllib.request.urlopen(req, timeout=10) as resp:
                rdata = json_lib.loads(resp.read().decode("utf-8"))
                run_id = rdata.get("id")
                if run_id:
                    import time
                    time.sleep(1)
                    req_det = urllib.request.Request(f"https://api.paiza.io/runners/get_details?id={run_id}&api_key=guest", method="GET")
                    with urllib.request.urlopen(req_det, timeout=10) as resp_det:
                        det = json_lib.loads(resp_det.read().decode("utf-8"))
                        out = det.get("stdout") or det.get("build_stderr") or det.get("stderr") or "(No Output)"
                        clean_out = format_terminal_output(out, user_input)
                        need_input = out.strip().endswith(":") or out.strip().endswith("?")
                        return jsonify({"output": clean_out, "need_input": need_input})
        except Exception:
            pass

        # All three backends failed or are unreachable — never crash the
        # app or leak raw exception/network details, just say so clearly.
        return jsonify({"output": "⚠️ Compiler service is temporarily unavailable. Please try again in a moment."})

    elif lang in ("javascript", "js"):
        try:
            res = subprocess.run(
                ["node", "-e", code],
                input=user_input,
                capture_output=True,
                text=True,
                timeout=10
            )
            out = res.stdout or ""
            err = res.stderr or ""
            clean_out = format_terminal_output(out, user_input)
            need_input = out.strip().endswith(":") or out.strip().endswith("?")
            return jsonify({"output": clean_out if clean_out else "(No Output)", "need_input": need_input})
        except Exception:
            return jsonify({"output": "Node execution unavailable on backend; client evaluation fallback."})

    return jsonify({"output": f"Unsupported language: {lang}"}), 400


def discover_ip_addresses():
    import socket
    ips = []
    try:
        hostname = socket.gethostname()
        _, _, ip_list = socket.gethostbyname_ex(hostname)
        for ip in ip_list:
            if ip not in ips and not ip.startswith("127."):
                ips.append(ip)
    except Exception:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        gw_ip = s.getsockname()[0]
        s.close()
        if gw_ip not in ips and not gw_ip.startswith("127."):
            ips.append(gw_ip)
    except Exception:
        pass
    return ips

# ------------------------------------------------------------------
# Auto-promote admin on startup
# ------------------------------------------------------------------
_startup_conn = get_db()
auto_promote_admin(_startup_conn)
_startup_conn.close()


# ==================================================================
# ADMIN PAGE ROUTES
# ==================================================================

@app.route("/admin")
@app.route("/admin/")
@admin_required
def admin_index():
    return redirect("/admin/dashboard")


@app.route("/admin/dashboard")
@admin_required
def admin_dashboard():
    conn = get_db()
    ctx = get_admin_context(conn)
    conn.close()
    return render_template("admin/dashboard.html", active_page="dashboard", **ctx)


@app.route("/admin/users")
@admin_required
def admin_users_page():
    conn = get_db()
    ctx = get_admin_context(conn)
    conn.close()
    return render_template("admin/users.html", active_page="users", **ctx)


@app.route("/admin/users/<uid>")
@admin_required
def admin_user_detail_page(uid):
    conn = get_db()
    ctx = get_admin_context(conn)
    conn.close()
    return render_template("admin/user_detail.html", active_page="users", uid=uid, **ctx)


@app.route("/admin/login-logs")
@admin_required
def admin_login_logs_page():
    conn = get_db()
    ctx = get_admin_context(conn)
    conn.close()
    return render_template("admin/login_logs.html", active_page="login_logs", **ctx)


@app.route("/admin/notifications")
@admin_required
def admin_notifications_page():
    conn = get_db()
    ctx = get_admin_context(conn)
    conn.close()
    return render_template("admin/notifications.html", active_page="notifications", **ctx)


@app.route("/admin/activity")
@admin_required
def admin_activity_page():
    conn = get_db()
    ctx = get_admin_context(conn)
    conn.close()
    return render_template("admin/activity.html", active_page="activity", **ctx)


@app.route("/admin/settings")
@admin_required
def admin_settings_page():
    conn = get_db()
    ctx = get_admin_context(conn)
    conn.close()
    return render_template("admin/settings.html", active_page="settings", **ctx)


# ==================================================================
# ADMIN API ROUTES
# ==================================================================

def _user_to_admin_dict(row):
    """Convert a users row to full admin JSON dict."""
    keys = row.keys()
    d = dict(row)
    pic = None
    if d.get("avatar_path"):
        pic = f"/static/uploads/avatars/{os.path.basename(d['avatar_path'])}"
    d["pic"] = pic
    d["online"] = is_online(d.get("last_seen"))
    # booleans
    d["deleted"] = bool(d.get("deleted"))
    return d


@app.route("/api/admin/stats")
@admin_required
def admin_stats():
    conn = get_db()
    today = datetime.now().strftime("%Y-%m-%d")
    total = conn.execute("SELECT COUNT(*) AS c FROM users WHERE deleted=0").fetchone()["c"]
    active = conn.execute("SELECT COUNT(*) AS c FROM users WHERE status='active' AND deleted=0").fetchone()["c"]
    blocked = conn.execute("SELECT COUNT(*) AS c FROM users WHERE status='blocked' AND deleted=0").fetchone()["c"]
    suspended = conn.execute("SELECT COUNT(*) AS c FROM users WHERE status='suspended' AND deleted=0").fetchone()["c"]
    deleted = conn.execute("SELECT COUNT(*) AS c FROM users WHERE deleted=1").fetchone()["c"]
    new_today = conn.execute(
        "SELECT COUNT(*) AS c FROM users WHERE DATE(created_at)=?", (today,)
    ).fetchone()["c"]
    logins_today = conn.execute(
        "SELECT COUNT(*) AS c FROM login_logs WHERE DATE(login_time)=? AND login_status='success'", (today,)
    ).fetchone()["c"]

    # Online: active in last 2 min
    cutoff = (datetime.now() - timedelta(minutes=2)).strftime("%Y-%m-%d %H:%M:%S")
    online = conn.execute(
        "SELECT COUNT(*) AS c FROM users WHERE last_seen >= ? AND deleted=0", (cutoff,)
    ).fetchone()["c"]
    offline = total - online

    # Login activity last 7 days
    login_7d = []
    for i in range(6, -1, -1):
        day = (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM login_logs WHERE DATE(login_time)=? AND login_status='success'", (day,)
        ).fetchone()["c"]
        login_7d.append({"date": day, "count": count})

    conn.close()
    return jsonify({
        "total_users": total,
        "active_users": active,
        "blocked_users": blocked,
        "suspended_users": suspended,
        "deleted_users": deleted,
        "online_users": online,
        "offline_users": offline,
        "new_today": new_today,
        "logins_today": logins_today,
        "login_activity_7d": login_7d,
    })


@app.route("/api/admin/users")
@admin_required
def admin_users_api():
    page = max(1, int(request.args.get("page", 1)))
    limit = min(100, max(1, int(request.args.get("limit", 10))))
    q = (request.args.get("q") or "").strip()
    filt = (request.args.get("filter") or "all").strip()
    sort = (request.args.get("sort") or "newest").strip()
    fmt = request.args.get("format", "json")
    offset = (page - 1) * limit

    where_clauses = []
    params = []

    if filt == "active":
        where_clauses.append("status='active' AND deleted=0")
    elif filt == "blocked":
        where_clauses.append("status='blocked'")
    elif filt == "suspended":
        where_clauses.append("status='suspended'")
    elif filt == "deleted":
        where_clauses.append("deleted=1")
    elif filt == "admin":
        where_clauses.append("role='admin' AND deleted=0")
    # else "all" — no filter

    if q:
        like = f"%{q}%"
        where_clauses.append("(name LIKE ? OR email LIKE ? OR uid LIKE ? OR username LIKE ?)")
        params.extend([like, like, like, like])

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
    order_sql = "ORDER BY created_at DESC" if sort == "newest" else "ORDER BY created_at ASC"

    conn = get_db()
    total = conn.execute(f"SELECT COUNT(*) AS c FROM users {where_sql}", params).fetchone()["c"]
    rows = conn.execute(
        f"SELECT * FROM users {where_sql} {order_sql} LIMIT ? OFFSET ?",
        params + [limit, offset]
    ).fetchall()
    conn.close()

    users = [_user_to_admin_dict(r) for r in rows]
    pages = math.ceil(total / limit) if total else 1

    # CSV export
    if fmt == "csv":
        import io, csv
        si = io.StringIO()
        w = csv.writer(si)
        w.writerow(["uid","name","username","email","role","status","deleted","created_at","last_login"])
        for u in users:
            w.writerow([u.get("uid"),u.get("name"),u.get("username"),u.get("email"),u.get("role"),u.get("status"),u.get("deleted"),u.get("created_at"),u.get("last_login")])
        from flask import Response
        return Response(si.getvalue(), mimetype="text/csv", headers={"Content-Disposition":"attachment;filename=users.csv"})

    return jsonify({"users": users, "total": total, "page": page, "pages": pages})


@app.route("/api/admin/users/<uid>")
@admin_required
def admin_get_user(uid):
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE uid=?", (uid,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "User not found."}), 404
    return jsonify({"user": _user_to_admin_dict(row)})


@app.route("/api/admin/users/<uid>", methods=["PUT"])
@admin_required
def admin_edit_user(uid):
    data = request.get_json(silent=True) or {}
    conn = get_db()
    target = conn.execute("SELECT * FROM users WHERE uid=?", (uid,)).fetchone()
    if not target:
        conn.close()
        return jsonify({"error": "User not found."}), 404

    updates, params = [], []
    if data.get("name"):
        updates.append("name=?"); params.append(data["name"].strip()[:100])
    if data.get("email"):
        em = data["email"].strip().lower()
        if EMAIL_RE.match(em):
            updates.append("email=?"); params.append(em)
    if data.get("username"):
        updates.append("username=?"); params.append(data["username"].strip()[:30])
    if data.get("role") in ("user", "admin"):
        updates.append("role=?"); params.append(data["role"])
        if data["role"] != target["role"]:
            log_admin_activity(conn, session["user_id"], "role_change", target["id"],
                               f"Changed role to {data['role']}")
    if data.get("status") in ("active", "blocked", "suspended"):
        updates.append("status=?"); params.append(data["status"])

    if updates:
        updates.append("updated_at=CURRENT_TIMESTAMP")
        params.append(target["id"])
        conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id=?", params)
        conn.commit()
        log_admin_activity(conn, session["user_id"], "edit", target["id"])

    conn.close()
    return jsonify({"ok": True})


@app.route("/api/admin/users/<uid>", methods=["DELETE"])
@admin_required
def admin_permanent_delete(uid):
    conn = get_db()
    target = conn.execute("SELECT * FROM users WHERE uid=?", (uid,)).fetchone()
    if not target:
        conn.close()
        return jsonify({"error": "User not found."}), 404

    # Remove uploaded files
    for path in (target["resume_path"], target["avatar_path"]):
        if path and os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass

    log_admin_activity(conn, session["user_id"], "permanent_delete", target["id"])
    conn.execute("DELETE FROM users WHERE id=?", (target["id"],))
    conn.commit()
    create_admin_notification(conn, "deleted", "User Permanently Deleted",
                              f"{target['name']} ({target['email']}) was permanently deleted")
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/admin/users/<uid>/block", methods=["POST"])
@admin_required
def admin_block_user(uid):
    data = request.get_json(silent=True) or {}
    reason = (data.get("reason") or "").strip()[:255]
    conn = get_db()
    target = conn.execute("SELECT * FROM users WHERE uid=?", (uid,)).fetchone()
    if not target:
        conn.close()
        return jsonify({"error": "User not found."}), 404
    if target["role"] == "admin":
        conn.close()
        return jsonify({"error": "Cannot block an admin."}), 403

    conn.execute(
        """UPDATE users SET status='blocked', blocked_at=CURRENT_TIMESTAMP,
           blocked_by=?, block_reason=?, updated_at=CURRENT_TIMESTAMP WHERE id=?""",
        (session["user_id"], reason, target["id"])
    )
    conn.commit()
    log_admin_activity(conn, session["user_id"], "block", target["id"], reason)
    create_admin_notification(conn, "blocked", "User Blocked",
                              f"{target['name']} ({target['email']}) was blocked. Reason: {reason or 'None'}",
                              target["id"])
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/admin/users/<uid>/unblock", methods=["POST"])
@admin_required
def admin_unblock_user(uid):
    conn = get_db()
    target = conn.execute("SELECT * FROM users WHERE uid=?", (uid,)).fetchone()
    if not target:
        conn.close()
        return jsonify({"error": "User not found."}), 404
    conn.execute(
        """UPDATE users SET status='active', blocked_at=NULL, blocked_by=NULL,
           block_reason='', updated_at=CURRENT_TIMESTAMP WHERE id=?""",
        (target["id"],)
    )
    conn.commit()
    log_admin_activity(conn, session["user_id"], "unblock", target["id"])
    create_admin_notification(conn, "restored", "User Unblocked",
                              f"{target['name']} ({target['email']}) was unblocked", target["id"])
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/admin/users/<uid>/suspend", methods=["POST"])
@admin_required
def admin_suspend_user(uid):
    data = request.get_json(silent=True) or {}
    until = (data.get("until") or "").strip()
    reason = (data.get("reason") or "").strip()[:255]
    if not until:
        return jsonify({"error": "Suspension end date/time required."}), 400
    conn = get_db()
    target = conn.execute("SELECT * FROM users WHERE uid=?", (uid,)).fetchone()
    if not target:
        conn.close()
        return jsonify({"error": "User not found."}), 404
    conn.execute(
        """UPDATE users SET status='suspended', suspended_until=?, suspend_reason=?,
           updated_at=CURRENT_TIMESTAMP WHERE id=?""",
        (until, reason, target["id"])
    )
    conn.commit()
    log_admin_activity(conn, session["user_id"], "suspend", target["id"],
                       f"Suspended until {until}. Reason: {reason}")
    create_admin_notification(conn, "suspended", "User Suspended",
                              f"{target['name']} suspended until {until}. Reason: {reason or 'None'}",
                              target["id"])
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/admin/users/<uid>/delete", methods=["POST"])
@admin_required
def admin_soft_delete(uid):
    conn = get_db()
    target = conn.execute("SELECT * FROM users WHERE uid=?", (uid,)).fetchone()
    if not target:
        conn.close()
        return jsonify({"error": "User not found."}), 404
    if target["role"] == "admin":
        conn.close()
        return jsonify({"error": "Cannot delete an admin account."}), 403
    conn.execute(
        """UPDATE users SET deleted=1, deleted_at=CURRENT_TIMESTAMP, deleted_by=?,
           status='deleted', updated_at=CURRENT_TIMESTAMP WHERE id=?""",
        (session["user_id"], target["id"])
    )
    conn.commit()
    log_admin_activity(conn, session["user_id"], "delete", target["id"])
    create_admin_notification(conn, "deleted", "User Deleted",
                              f"{target['name']} ({target['email']}) was soft-deleted", target["id"])
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/admin/users/<uid>/restore", methods=["POST"])
@admin_required
def admin_restore_user(uid):
    conn = get_db()
    target = conn.execute("SELECT * FROM users WHERE uid=?", (uid,)).fetchone()
    if not target:
        conn.close()
        return jsonify({"error": "User not found."}), 404
    conn.execute(
        """UPDATE users SET deleted=0, deleted_at=NULL, deleted_by=NULL,
           status='active', updated_at=CURRENT_TIMESTAMP WHERE id=?""",
        (target["id"],)
    )
    conn.commit()
    log_admin_activity(conn, session["user_id"], "restore", target["id"])
    create_admin_notification(conn, "restored", "User Restored",
                              f"{target['name']} ({target['email']}) was restored", target["id"])
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/admin/users/<uid>/reset-password", methods=["POST"])
@admin_required
def admin_reset_password(uid):
    data = request.get_json(silent=True) or {}
    new_pw = (data.get("new_password") or "").strip()
    if len(new_pw) < 6:
        return jsonify({"error": "Password must be at least 6 characters."}), 400
    conn = get_db()
    target = conn.execute("SELECT * FROM users WHERE uid=?", (uid,)).fetchone()
    if not target:
        conn.close()
        return jsonify({"error": "User not found."}), 404
    conn.execute(
        "UPDATE users SET password_hash=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
        (generate_password_hash(new_pw), target["id"])
    )
    conn.commit()
    log_admin_activity(conn, session["user_id"], "reset_password", target["id"])
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/admin/login-logs")
@admin_required
def admin_login_logs_api():
    page = max(1, int(request.args.get("page", 1)))
    limit = min(200, max(1, int(request.args.get("limit", 25))))
    q = (request.args.get("q") or "").strip()
    uid_filter = (request.args.get("uid") or "").strip()
    offset = (page - 1) * limit

    where_clauses = []
    params = []
    if uid_filter:
        user = get_db().execute("SELECT id FROM users WHERE uid=?", (uid_filter,)).fetchone()
        if user:
            where_clauses.append("l.user_id=?"); params.append(user["id"])
    if q:
        like = f"%{q}%"
        where_clauses.append("(l.name LIKE ? OR l.email LIKE ? OR l.ip_address LIKE ?)")
        params.extend([like, like, like])

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
    conn = get_db()
    total = conn.execute(f"SELECT COUNT(*) AS c FROM login_logs l {where_sql}", params).fetchone()["c"]
    rows = conn.execute(
        f"SELECT * FROM login_logs l {where_sql} ORDER BY login_time DESC LIMIT ? OFFSET ?",
        params + [limit, offset]
    ).fetchall()
    conn.close()
    return jsonify({
        "logs": [dict(r) for r in rows],
        "total": total,
        "page": page,
        "pages": math.ceil(total / limit) if total else 1,
    })


@app.route("/api/admin/notifications")
@admin_required
def admin_notifications_api():
    page = max(1, int(request.args.get("page", 1)))
    limit = min(100, max(1, int(request.args.get("limit", 20))))
    filt = (request.args.get("filter") or "all").strip()
    offset = (page - 1) * limit

    where_clauses = []
    params = []
    if filt == "unread":
        where_clauses.append("is_read=0")
    elif filt in ("new_user", "login", "blocked", "deleted", "restored", "suspended"):
        where_clauses.append("type=?"); params.append(filt)

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
    conn = get_db()
    total = conn.execute(f"SELECT COUNT(*) AS c FROM admin_notifications {where_sql}", params).fetchone()["c"]
    unread_count = conn.execute("SELECT COUNT(*) AS c FROM admin_notifications WHERE is_read=0").fetchone()["c"]
    rows = conn.execute(
        f"SELECT * FROM admin_notifications {where_sql} ORDER BY created_at DESC LIMIT ? OFFSET ?",
        params + [limit, offset]
    ).fetchall()
    conn.close()
    return jsonify({
        "notifications": [dict(r) for r in rows],
        "total": total,
        "page": page,
        "pages": math.ceil(total / limit) if total else 1,
        "unread_count": unread_count,
    })


@app.route("/api/admin/notifications/<int:nid>/read", methods=["POST"])
@admin_required
def admin_mark_notif_read(nid):
    conn = get_db()
    conn.execute("UPDATE admin_notifications SET is_read=1 WHERE id=?", (nid,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/admin/notifications/<int:nid>", methods=["DELETE"])
@admin_required
def admin_delete_notif(nid):
    conn = get_db()
    conn.execute("DELETE FROM admin_notifications WHERE id=?", (nid,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/admin/notifications/mark-all-read", methods=["POST"])
@admin_required
def admin_mark_all_read():
    conn = get_db()
    conn.execute("UPDATE admin_notifications SET is_read=1")
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/admin/notifications/delete-read", methods=["DELETE"])
@admin_required
def admin_delete_read_notifs():
    conn = get_db()
    conn.execute("DELETE FROM admin_notifications WHERE is_read=1")
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/admin/activity")
@admin_required
def admin_activity_api():
    page = max(1, int(request.args.get("page", 1)))
    limit = min(200, max(1, int(request.args.get("limit", 25))))
    q = (request.args.get("q") or "").strip()
    offset = (page - 1) * limit

    where_clauses = []
    params = []
    if q:
        like = f"%{q}%"
        where_clauses.append("(admin_name LIKE ? OR target_name LIKE ? OR action LIKE ? OR reason LIKE ?)")
        params.extend([like, like, like, like])

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
    conn = get_db()
    total = conn.execute(f"SELECT COUNT(*) AS c FROM admin_activity_logs {where_sql}", params).fetchone()["c"]
    rows = conn.execute(
        f"SELECT * FROM admin_activity_logs {where_sql} ORDER BY created_at DESC LIMIT ? OFFSET ?",
        params + [limit, offset]
    ).fetchall()
    conn.close()
    return jsonify({
        "logs": [dict(r) for r in rows],
        "total": total,
        "page": page,
        "pages": math.ceil(total / limit) if total else 1,
    })


@app.route("/api/admin/online-users")
@admin_required
def admin_online_users():
    cutoff = (datetime.now() - timedelta(minutes=2)).strftime("%Y-%m-%d %H:%M:%S")
    conn = get_db()
    rows = conn.execute(
        "SELECT uid, name, email, avatar_path, last_seen FROM users WHERE last_seen >= ? AND deleted=0",
        (cutoff,)
    ).fetchall()
    conn.close()
    return jsonify({
        "online_users": [
            {
                "uid": r["uid"], "name": r["name"], "email": r["email"],
                "pic": f"/static/uploads/avatars/{os.path.basename(r['avatar_path'])}" if r["avatar_path"] else None,
                "last_seen": r["last_seen"],
            }
            for r in rows
        ]
    })



# ------------------------------------------------------------------
# Developer Reset — wipes ALL users, messages, scores, etc.
# Gated behind admin_required (must be an authenticated admin account),
# with the shared secret kept as a second confirmation layer. The key
# alone is NOT sufficient — it also ships in the client bundle, so it
# must never be trusted as the only check.
# Usage: POST /api/admin/reset-all-data  { "key": "<reset_key>" }
# ------------------------------------------------------------------
DEV_RESET_KEY = os.environ.get("S2TALK_RESET_KEY", "s2talk-dev-reset-9977")

@app.route("/api/admin/reset-all-data", methods=["POST"])
@admin_required
def dev_reset_all():
    data = request.get_json(silent=True) or {}
    provided_key = (data.get("key") or "").strip()
    if provided_key != DEV_RESET_KEY:
        return jsonify({"error": "Invalid reset key."}), 403

    conn = get_db()
    tables = [
        "users", "messages", "friends", "scores", "password_resets",
        "admin_activity_logs", "login_logs", "admin_notifications",
    ]
    for tbl in tables:
        try:
            conn.execute(f"DELETE FROM {tbl}")
        except Exception:
            pass  # table may not exist in all schema versions
    conn.commit()
    conn.close()
    session.clear()

    # Remove uploaded files
    for upload_dir in [UPLOAD_AVATARS, UPLOAD_RESUMES, UPLOAD_VOICE,
                       os.path.join(BASE_DIR, "static", "uploads", "recordings"),
                       os.path.join(BASE_DIR, "static", "uploads", "photos")]:
        if upload_dir and os.path.isdir(upload_dir):
            for fname in os.listdir(upload_dir):
                fpath = os.path.join(upload_dir, fname)
                if os.path.isfile(fpath):
                    try:
                        os.remove(fpath)
                    except OSError:
                        pass

    return jsonify({"ok": True, "message": "All data wiped. Server-side cleared."})



if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    local_ips = discover_ip_addresses()

    print("\n" + "=" * 65)
    print(" [i] S2 TALK SERVER IS RUNNING & ACCESSIBLE ON:")
    print(" " + "-" * 63)
    print(f"  -  Local (Loopback):   http://127.0.0.1:{port}")
    print(f"  -  Localhost:          http://localhost:{port}")
    for ip in local_ips:
        print(f"  -  Network (LAN):      http://{ip}:{port}")
    print(f"  -  Public / Global:    http://0.0.0.0:{port} (Public Network Ready)")
    print("=" * 65 + "\n")

    app.run(host="0.0.0.0", port=port, debug=True)
