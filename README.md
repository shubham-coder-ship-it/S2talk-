# S2 Talk

A browser-based "city" simulation for career development — explore buildings to
practice interviews, build skills, run code in a sandboxed multi-language lab,
chat with friends, and get AI-powered career guidance. Flask backend, vanilla
JS/Canvas frontend, SQLite storage.

---

## Features

- **Interactive city world** — walk or drive around a pixel-art town; enter
  buildings via keyboard, mouse double-click, or touch controls
- **Interview House** — AI-driven mock interviews with feedback
- **Skills Development House** — quizzes and structured learning content
- **Projects Lab** — an in-browser code editor and sandboxed runner for
  Python, JavaScript, C, and C++, with real compile/runtime error reporting
- **Talk House** — friend requests, direct messaging, pinned conversations
- **Profile system** — resume upload/parsing, avatar & car customization,
  skills, bio
- **AI Agent** — pluggable AI chat (Gemini / Anthropic / OpenAI / Groq) for
  career advice, resume feedback, and general Q&A
- **Admin panel** — user management, activity logs, notifications, live stats
- **Fully responsive** — desktop, tablet, and mobile (portrait & landscape),
  with dedicated touch controls

## Tech Stack

| Layer      | Technology                                   |
|------------|-----------------------------------------------|
| Backend    | Python 3, Flask                               |
| Database   | SQLite (file-based, zero setup)               |
| Frontend   | Vanilla JavaScript, HTML5 Canvas, CSS         |
| AI         | Pluggable — Gemini, Anthropic, OpenAI, or Groq |
| Config     | `python-dotenv` (`.env` file, auto-loaded)    |

No build step, no frontend framework, no Node.js required to run the app.

---

## Installation

### Prerequisites
- Python 3.10+
- `pip`
- (Optional, for the Projects Lab code runner) `gcc`/`g++` on your system PATH
  if you want C/C++ execution to work locally

### Steps

```bash
git clone <your-repo-url>
cd s2talk

python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

pip install -r requirements.txt
```

### Configure

```bash
cp .env.example .env             # Windows: copy .env.example .env
```

Open `.env` and fill in at minimum:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=YOUR_KEY
```

Get a free Gemini key at **https://aistudio.google.com/apikey** — no credit
card required. See [`.env.example`](./.env.example) for every available
option, and the **Environment Variables** section below for what each one
does.

### Run

```bash
python app.py
```

### Open

```
http://127.0.0.1:5000
```

That's it — no database migrations, no seed scripts. The SQLite database is
created automatically on first run.

---

## Project Structure

```
s2talk/
├── app.py                 # Flask app: routes, auth, DB, admin panel
├── ai.py                  # AI provider wrapper (see "AI Provider" below)
├── requirements.txt
├── .env.example            # Copy to .env and fill in your keys
├── .env                    # Your local config (never commit this)
├── s2talk.db                # SQLite database (auto-created)
├── templates/
│   └── index.html          # Single-page app shell
└── static/
    ├── js/
    │   ├── app.js           # Core game/world logic, UI rendering
    │   └── enhancements.js  # Touch controls, double-click/tap navigation
    ├── css/
    │   ├── style.css
    │   └── auth-redesign.css
    ├── config/
    │   └── audio.js
    ├── assets/               # Static images/sounds
    └── uploads/               # User-uploaded resumes/avatars (runtime)
```

---

## Environment Variables

All configuration lives in `.env` (see `.env.example` for the full template).
Nothing is ever hardcoded — the app reads everything from the environment at
startup via `python-dotenv`.

| Variable             | Required | Default                    | Description |
|-----------------------|----------|------------------------------|-------------|
| `FLASK_SECRET_KEY`    | Recommended | `dev-secret-change-me`    | Signs session cookies. Set a real random value in production. |
| `PORT`                | No       | `5000`                       | Port the dev server listens on. |
| `ADMIN_EMAIL`         | No       | *(none)*                     | Email of the account to auto-promote to admin on every startup. See `ADMIN_SETUP.md`. |
| `AI_PROVIDER`         | No       | `anthropic`                  | `gemini`, `anthropic`, `openai`, or `groq`. |
| `GEMINI_API_KEY`      | If using Gemini | *(none)*             | From https://aistudio.google.com/apikey |
| `GEMINI_MODEL`        | No       | `gemini-3.5-flash-lite`      | Auto-falls back to other current Gemini models if unavailable. |
| `ANTHROPIC_API_KEY`   | If using Anthropic | *(none)*           | From https://console.anthropic.com/ |
| `ANTHROPIC_MODEL`     | No       | `claude-sonnet-4-6`           | |
| `OPENAI_API_KEY`      | If using OpenAI | *(none)*              | From https://platform.openai.com/api-keys |
| `OPENAI_MODEL`        | No       | `gpt-4o-mini`                 | |
| `GROQ_API_KEY`        | If using Groq | *(none)*                | From https://console.groq.com/keys |
| `GROQ_MODEL`          | No       | `llama-3.3-70b-versatile`     | |

You only need to fill in the key for whichever `AI_PROVIDER` you choose — the
others can stay blank.

---

## How to Change AI Provider

Every AI feature in the app calls a single wrapper module, `ai.py` — nothing
in the rest of the codebase talks to a provider's API directly. To switch
providers:

1. Set `AI_PROVIDER` in `.env` to `gemini`, `anthropic`, `openai`, or `groq`
2. Fill in the matching `*_API_KEY`
3. Restart the server

No code changes required. If you want to add a **new** provider entirely,
add one function to `ai.py` (following the pattern of `_call_gemini`,
`_call_groq`, etc.) and one branch in `generate_response()` — everything
else (error handling, the `/api/ai` route, the health-check endpoint) picks
it up automatically.

---

## Troubleshooting

**"Gemini API key not found" in the S2 Agent chat**
`GEMINI_API_KEY` is missing or empty in `.env`. Add it and restart the
server — `.env` is only read on startup, not hot-reloaded.

**AI chat returns an error mentioning "quota exceeded"**
You've hit your provider's free-tier daily/rate limit. For Gemini, check
your real-time usage at https://aistudio.google.com/rate-limit. The app
automatically retries with fallback models when this happens — if you still
see an error, every fallback model was also exhausted; wait for the daily
reset (midnight Pacific time for Gemini) or link a billing account for
higher limits.

**AI chat returns "no longer available to new users"**
The configured model has been deprecated/restricted by the provider. Check
`GEMINI_MODEL` (or the equivalent for your provider) against their current
model list and update `.env` — no code changes needed.

**C/C++ code fails to compile in the Projects Lab**
Make sure `gcc`/`g++` are installed and on your system `PATH`. On Debian/
Ubuntu: `sudo apt install build-essential`. Python and JavaScript execution
have no external dependency.

**`ModuleNotFoundError` on startup**
Run `pip install -r requirements.txt` again inside your active virtual
environment — a dependency is missing.

**Server starts but the page is blank / assets 404**
Make sure you're running `python app.py` from inside the `s2talk/` folder
(the one containing `app.py`, `templates/`, and `static/`), not its parent.

---

## Deployment

The app runs anywhere Python 3.10+ is available. In production, run it
behind a real WSGI server (not Flask's built-in dev server) and set a real
`FLASK_SECRET_KEY`.

### General production checklist
- Set `FLASK_SECRET_KEY` to a long random value
- Set your `AI_PROVIDER` + matching API key
- Use a production WSGI server, e.g.:
  ```bash
  pip install gunicorn
  gunicorn -w 2 -b 0.0.0.0:$PORT app:app
  ```
- Ensure `static/uploads/` is writable (resume/avatar uploads) and, ideally,
  persisted across deploys/restarts (see platform notes below)

### Render / Railway
1. Connect your repo
2. Build command: `pip install -r requirements.txt`
3. Start command: `gunicorn -w 2 -b 0.0.0.0:$PORT app:app`
4. Add your environment variables (`AI_PROVIDER`, `GEMINI_API_KEY`,
   `FLASK_SECRET_KEY`, etc.) in the platform's dashboard — no code changes
5. Both platforms inject `$PORT` automatically; the app already reads it

### PythonAnywhere
1. Upload the project or clone via a Bash console
2. Create a virtualenv and `pip install -r requirements.txt`
3. Set environment variables in the **Web** tab's WSGI config file (or via a
   `.env` file uploaded alongside `app.py` — it's read automatically)
4. Point the WSGI file's Flask app import at `app.app`

### Docker
```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn
COPY . .
EXPOSE 5000
CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:5000", "app:app"]
```
```bash
docker build -t s2talk .
docker run -p 5000:5000 --env-file .env s2talk
```

### VPS (Linux)
Same as the general checklist above — run behind `gunicorn` + a reverse
proxy (nginx/Caddy) for TLS, and use a process manager (systemd, supervisor)
to keep it running.

### Local Windows / Linux
Exactly the "Installation" steps above — `python app.py` is fine for local
use and testing; switch to `gunicorn` (Linux) or `waitress` (Windows) only
when exposing the app beyond your own machine.

In every case: **the only thing you add is your API key** (and optionally
`FLASK_SECRET_KEY`/`ADMIN_EMAIL`). No source files need editing after
deployment.

---

## Security

- Passwords are hashed (`werkzeug.security`), never stored in plaintext
- Sessions are signed with `FLASK_SECRET_KEY` — **set a real random value**
  before deploying publicly; the default is for local development only
- API keys are read from environment variables only — never hardcoded,
  never sent to the browser (all AI calls are proxied server-side)
- User-submitted code in the Projects Lab runs under OS-level resource
  limits (CPU/memory/process-count) to contain runaway or malicious programs
- `.env` is gitignored by default — never commit real API keys

---

## Future Improvements

- WebSocket-based real-time chat (currently polling-based)
- Additional AI providers (add one function to `ai.py`)
- Java support in the Projects Lab
- Report House: edit/rename/filter/sort for saved interview & skills reports

---

## Common Errors

| Symptom | Cause | Fix |
|---|---|---|
| `ModuleNotFoundError: No module named 'dotenv'` | Dependency not installed | `pip install -r requirements.txt` |
| `(Offline demo mode...)` in AI chat | No API key configured | Fill in `.env` for your chosen `AI_PROVIDER` |
| `AI service error (gemini): ... no longer available to new users` | Model deprecated for your API key/project | Update `GEMINI_MODEL` in `.env` to a current model |
| Touch controls don't respond | Old cached JS/CSS | Hard-refresh the mobile browser (clear cache) |
| C/C++ compile fails with an OCI/runtime error | Compiler unavailable in your hosting environment | Install `build-essential` (or platform equivalent), or deploy on a host that allows subprocess execution |

For admin account setup, see **[`ADMIN_SETUP.md`](./ADMIN_SETUP.md)**.


## 👨‍💻 Author
Shubham Sharma
•GitHub: https://github.com/shubham-coder-ship-it 
•LinkedIn: https://www.linkedin.com/in/shubham-sharma-55ab97367

⭐ If you found this project useful, don't forget to star the repository!
