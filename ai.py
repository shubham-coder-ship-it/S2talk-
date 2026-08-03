"""
ai.py — Unified AI provider wrapper for S2 Talk.

Every AI feature in the app calls generate_response() from this module
instead of talking to a provider's API directly. This keeps all
provider-specific logic (auth, endpoints, error parsing, model fallback)
in one place — switching providers, or fixing a provider's quirks, never
requires touching feature code anywhere else in the app.

Supported providers: anthropic (default), openai, gemini, groq.
Configured entirely through environment variables — see .env.example.
Nothing here ever hardcodes an API key.
"""
import os
import json as json_lib
import urllib.request
import urllib.error

try:
    from dotenv import load_dotenv
    _AI_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    load_dotenv(os.path.join(_AI_BASE_DIR, ".env"))  # safe even if app.py already loaded it; idempotent
except ImportError:
    pass


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
_CONFIG = {}


def load_api():
    """Read provider configuration from the environment. Runs automatically
    on import (see bottom of file) so nothing needs to call this manually —
    but it's safe to call again any time to pick up changed env vars."""
    _CONFIG["provider"] = os.environ.get("AI_PROVIDER", "anthropic").lower()

    _CONFIG["anthropic_key"] = os.environ.get("ANTHROPIC_API_KEY", "")
    _CONFIG["anthropic_model"] = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")

    _CONFIG["openai_key"] = os.environ.get("OPENAI_API_KEY", "")
    _CONFIG["openai_model"] = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

    _CONFIG["gemini_key"] = os.environ.get("GEMINI_API_KEY", "")
    _CONFIG["gemini_model"] = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
    # Ordered fallback chain used when the configured Gemini model itself is
    # unavailable (404 retired/restricted) or quota-exhausted (429) — Gemini
    # tracks quota per-model, so a different model has a genuinely separate
    # daily allowance. Kept up to date with currently-supported models.
    _CONFIG["gemini_fallback_models"] = ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.5-flash"]

    _CONFIG["groq_key"] = os.environ.get("GROQ_API_KEY", "")
    _CONFIG["groq_model"] = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
    return dict(_CONFIG)


_PROVIDER_KEY_ENV = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "groq": "GROQ_API_KEY",
}
_PROVIDER_KEY_CONFIG = {
    "anthropic": "anthropic_key",
    "openai": "openai_key",
    "gemini": "gemini_key",
    "groq": "groq_key",
}
_PROVIDER_MODEL_CONFIG = {
    "anthropic": "anthropic_model",
    "openai": "openai_model",
    "gemini": "gemini_model",
    "groq": "groq_model",
}


def validate_api(provider=None):
    """Check whether the active (or given) provider has a usable API key.
    Returns (ok: bool, message: str). Never raises — callers use this to
    show a friendly message instead of crashing when a key is missing."""
    provider = (provider or _CONFIG.get("provider") or "anthropic").lower()
    if provider not in _PROVIDER_KEY_CONFIG:
        return False, (
            f"Unknown AI_PROVIDER '{provider}'. Supported providers: "
            "anthropic, openai, gemini, groq."
        )
    key = _CONFIG.get(_PROVIDER_KEY_CONFIG[provider])
    if key:
        return True, f"{provider.title()} API key loaded."
    if provider == "gemini":
        # Exact wording requested for this specific, most-common case.
        return False, "Gemini API key not found. Please add GEMINI_API_KEY to your .env file."
    env_name = _PROVIDER_KEY_ENV[provider]
    return False, f"{provider.title()} API key not found. Please add {env_name} to your .env file."


def health_check():
    """Lightweight status snapshot — used by /api/ai/health and printed at
    startup so it's always obvious which provider/model is active and
    whether its key actually loaded, without digging through logs."""
    provider = _CONFIG.get("provider", "anthropic")
    ok, message = validate_api(provider)
    model = _CONFIG.get(_PROVIDER_MODEL_CONFIG.get(provider, ""), None)
    return {"provider": provider, "model": model, "key_loaded": ok, "message": message}


class AIProviderError(Exception):
    """Raised for any provider failure. Carries a friendly, specific
    message plus the raw upstream status code so callers (e.g. Flask
    routes) can decide how to respond — the real reason is never hidden
    behind a generic 502."""
    def __init__(self, status_code, message, provider=None, model=None):
        self.status_code = status_code
        self.message = message
        self.provider = provider
        self.model = model
        super().__init__(
            f"AI provider error ({provider}{f'/{model}' if model else ''}) "
            f"[HTTP {status_code}]: {message}"
        )


class GeminiAPIError(AIProviderError):
    """Gemini-specific alias, kept for any code that wants to catch Gemini
    failures specifically. Functionally identical to AIProviderError."""
    def __init__(self, status_code, message, model=None):
        super().__init__(status_code, message, provider="gemini", model=model)


# ---------------------------------------------------------------------------
# Per-provider request implementations. These are intentionally not called
# directly from outside this module — everything goes through
# generate_response() so error handling and fallback stay centralized.
# ---------------------------------------------------------------------------

def _call_anthropic(system, messages, max_tokens):
    payload = json_lib.dumps(
        {"model": _CONFIG["anthropic_model"], "max_tokens": max_tokens, "system": system, "messages": messages}
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "x-api-key": _CONFIG["anthropic_key"],
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = json_lib.loads(resp.read().decode("utf-8"))
    return "\n".join(b.get("text", "") for b in body.get("content", [])).strip()


def _call_openai(system, messages, max_tokens):
    oa_messages = [{"role": "system", "content": system}] + [
        {"role": m.get("role", "user"), "content": m.get("content", "")} for m in messages
    ]
    payload = json_lib.dumps(
        {"model": _CONFIG["openai_model"], "max_tokens": max_tokens, "messages": oa_messages}
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {_CONFIG['openai_key']}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = json_lib.loads(resp.read().decode("utf-8"))
    return body["choices"][0]["message"]["content"].strip()


def _call_groq(system, messages, max_tokens):
    groq_messages = [{"role": "system", "content": system}] + [
        {"role": m.get("role", "user"), "content": m.get("content", "")} for m in messages
    ]
    payload = json_lib.dumps(
        {"model": _CONFIG["groq_model"], "messages": groq_messages, "max_tokens": max_tokens}
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {_CONFIG['groq_key']}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = json_lib.loads(resp.read().decode("utf-8"))
    return body["choices"][0]["message"]["content"].strip()


def _gemini_request_once(model, contents, generation_config):
    """Single attempt against one Gemini model. Raises GeminiAPIError with
    Google's *actual* error message on failure — never a generic string."""
    payload = json_lib.dumps(
        {"contents": contents, "generationConfig": generation_config}
    ).encode("utf-8")
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        f"?key={_CONFIG['gemini_key']}"
    )
    req = urllib.request.Request(
        url, data=payload, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json_lib.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            err_json = json_lib.loads(raw)
            google_message = err_json.get("error", {}).get("message", raw)
        except (ValueError, AttributeError):
            google_message = raw or e.reason
        raise GeminiAPIError(e.code, google_message, model=model) from None
    except urllib.error.URLError as e:
        raise GeminiAPIError(0, f"Network error reaching Gemini API: {e.reason}", model=model) from None

    candidates = body.get("candidates") or []
    if not candidates:
        feedback = body.get("promptFeedback", {})
        block_reason = feedback.get("blockReason")
        if block_reason:
            raise GeminiAPIError(200, f"Prompt blocked by Gemini safety filters (reason: {block_reason}).", model=model)
        raise GeminiAPIError(200, f"Gemini returned no candidates: {json_lib.dumps(body)[:300]}", model=model)

    parts = candidates[0].get("content", {}).get("parts", [])
    text = "".join(p.get("text", "") for p in parts).strip()
    if not text:
        finish_reason = candidates[0].get("finishReason", "UNKNOWN")
        raise GeminiAPIError(200, f"Gemini returned an empty response (finishReason: {finish_reason}).", model=model)
    return text


def _format_attempts(attempts):
    """Render a human-readable summary of every model that was tried and
    exactly why each one failed, so nothing is hidden behind 'the last
    error' when a multi-model fallback chain is exhausted."""
    lines = [f"All {len(attempts)} candidate model(s) failed:"]
    for model, e in attempts:
        lines.append(f"  • {model} [HTTP {e.status_code}]: {e.message}")
    return "\n".join(lines)


def _call_gemini(system, messages, max_tokens):
    contents = [{"role": "user", "parts": [{"text": system}]}] if system else []
    for m in messages:
        role = "model" if m.get("role") == "assistant" else "user"
        contents.append({"role": role, "parts": [{"text": m.get("content", "")}]})
    generation_config = {"maxOutputTokens": max_tokens}

    primary = _CONFIG["gemini_model"]
    candidates = [primary] + [m for m in _CONFIG["gemini_fallback_models"] if m != primary]
    attempts = []
    for model in candidates:
        try:
            return _gemini_request_once(model, contents, generation_config)
        except GeminiAPIError as e:
            attempts.append((model, e))
            if e.status_code in (404, 429):
                reason = "unavailable" if e.status_code == 404 else "quota exceeded"
                print(f"[Gemini] model '{model}' {reason} ({e.message[:200]}); trying next fallback...")
                continue
            # Auth/bad-request/5xx/network errors won't be fixed by
            # switching models — surface immediately, with any earlier
            # fallback attempts included for full transparency.
            raise GeminiAPIError(e.status_code, _format_attempts(attempts), model=model) from None
    last_model, last_exc = attempts[-1]
    raise GeminiAPIError(last_exc.status_code, _format_attempts(attempts), model=last_model)


# ---------------------------------------------------------------------------
# Public entry point — every AI feature should call this, and only this.
# ---------------------------------------------------------------------------

def generate_response(system, messages, max_tokens=500, provider=None):
    """Dispatch to the configured provider and return its text response.

    Raises AIProviderError on any failure, with a specific, friendly
    message and the real upstream status code — callers should catch this
    and return it to the user rather than a generic crash or blind 502.
    """
    provider = (provider or _CONFIG.get("provider") or "anthropic").lower()
    ok, message = validate_api(provider)
    if not ok:
        raise AIProviderError(0, message, provider=provider)

    try:
        if provider == "openai":
            return _call_openai(system, messages, max_tokens)
        elif provider == "gemini":
            return _call_gemini(system, messages, max_tokens)
        elif provider == "groq":
            return _call_groq(system, messages, max_tokens)
        elif provider == "anthropic":
            return _call_anthropic(system, messages, max_tokens)
        else:
            raise AIProviderError(0, f"Unknown AI_PROVIDER '{provider}'.", provider=provider)
    except AIProviderError:
        raise
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            err_json = json_lib.loads(raw)
            friendly = (
                err_json.get("error", {}).get("message")
                if isinstance(err_json.get("error"), dict)
                else str(err_json.get("error"))
            ) or raw[:500]
        except (ValueError, AttributeError):
            friendly = raw[:500] or str(e.reason)
        # Recognize common cases with an extra-friendly hint on top of the
        # real upstream message.
        if e.code == 401 or e.code == 403:
            friendly = f"Invalid API key for {provider}. {friendly}"
        elif e.code == 429:
            friendly = f"Quota exceeded for {provider}. {friendly}"
        raise AIProviderError(e.code, friendly, provider=provider) from None
    except urllib.error.URLError as e:
        raise AIProviderError(
            0, f"Network error reaching {provider}: {e.reason}. Check your internet connection and try again.",
            provider=provider,
        ) from None
    except TimeoutError:
        raise AIProviderError(0, f"Request to {provider} timed out. Please try again.", provider=provider) from None
    except Exception as e:  # noqa: BLE001 — last resort; never let a raw crash escape this module
        raise AIProviderError(0, str(e), provider=provider) from None


# Auto-load configuration on import — issue 6: "no code editing required",
# the moment this module is imported the active provider/key is ready.
load_api()
