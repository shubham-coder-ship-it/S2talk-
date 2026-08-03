# S2 Talk — Admin Setup Guide

This document explains how admin accounts work in S2 Talk, how to create
and manage them, and production recommendations for running an admin
panel safely.

---

## How the admin account works

S2 Talk has two user roles: `user` (default) and `admin`. Admins get
access to `/admin` — a panel for managing users, viewing activity logs,
monitoring live/online users, and moderating notifications.

There are **no default/hardcoded admin credentials**. Every admin account
starts as a normal registered user and is promoted afterward, either
automatically (via `.env`) or manually (by an existing admin).

---

## How to create the first admin account

1. **Register a normal account** through the app's sign-up screen, using
   the email address you want to be the admin.

2. **Set `ADMIN_EMAIL` in your `.env` file** to that same email:
   ```env
   ADMIN_EMAIL=you@example.com
   ```

3. **Restart the server.** On every startup, S2 Talk automatically
   promotes whichever registered user matches `ADMIN_EMAIL` to the
   `admin` role (see `auto_promote_admin()` in `app.py`).

4. Log in with that account and visit `http://127.0.0.1:5000/admin`.

This runs on *every* startup, so it's safe to leave `ADMIN_EMAIL` set
permanently — it just re-confirms that user's role each time.

---

## How to promote additional users to admin

Once you have at least one admin account:

1. Log into the admin panel (`/admin`).
2. Go to **User Management**.
3. Select the user you want to promote.
4. Change their **Role** field from `user` to `admin` and save.

This calls `PUT /api/admin/users/<uid>` with `{"role": "admin"}` under
the hood, and is logged in the admin activity log (`role_change`).

You can demote an admin back to a regular user the same way.

---

## How to reset an admin's password

Admins can reset **any** user's password (including other admins) from
the admin panel: **User Management → select user → Reset Password**.
This calls `POST /api/admin/users/<uid>/reset-password`.

If you've locked yourself out of the *only* admin account and have no
other admin to reset it, use the database directly (see below) or the
standard **Forgot Password** flow on the login screen, which works the
same for admin and non-admin accounts.

---

## Database location

S2 Talk uses SQLite. The database file lives at:

```
<project root>/s2talk.db
```

It's created automatically on first run if it doesn't exist. To fully
reset the app (wipe all users, messages, reports, everything), stop the
server and delete this file — it will be recreated empty on next start.
Alternatively, use **Admin Panel → Danger Zone → Reset All Data**, which
does the same thing without leaving the app.

You can inspect it directly with any SQLite tool:
```bash
sqlite3 s2talk.db "SELECT uid, name, email, role FROM users;"
```

---

## Production recommendations

- **Never commit `.env`** to version control. Only `.env.example` (with
  blank values) should be committed.
- **Set a strong `FLASK_SECRET_KEY`** in production — a random 32+
  character string. Generate one with:
  ```bash
  python -c "import secrets; print(secrets.token_hex(32))"
  ```
  The app falls back to an insecure default (`dev-secret-change-me`) if
  this isn't set — fine for local development, **not safe for
  production** (session cookies could be forged).
- **Restrict `ADMIN_EMAIL`** to an email address only you control, and
  remove/rotate it if that account is ever compromised.
- **Back up `s2talk.db` regularly** if running in production — it's a
  single file, so a scheduled copy (cron, systemd timer, or your
  platform's snapshot feature) is sufficient.
- **Run behind a real WSGI server** (gunicorn/waitress) and a reverse
  proxy (nginx/Caddy) with HTTPS — the built-in `app.run()` dev server
  prints its own warning about this and should not be used as-is in
  production. See `README.md` → Deployment for details.
- **Limit admin accounts** to people who actually need them — every
  admin can delete/suspend/reset-password any user.
