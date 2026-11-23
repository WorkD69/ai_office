"""Text sanitising for anything that leaves the server.

The snapshot is shown in a browser and stored by the worker, so free-form strings
coming from Hermes (activity descriptions, job names, model names) are cleaned
defensively: control/bidi characters removed, whitespace collapsed, secrets and
personal identifiers redacted, length clamped to the protocol limits.

This is **best-effort** redaction by pattern. The primary protection is that the
exporter never reads message bodies, prompts or session titles in the first place;
these patterns are the second line of defence for the few descriptive strings it does
export.
"""

from __future__ import annotations

import re

REDACTED = "[redacted]"

_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]")
_WHITESPACE = re.compile(r"\s+")

# Names of fields whose value is a secret, as in `api_key=...`, `access_token: ...`.
_SECRET_KEY = (
    r"(?:[\w-]*?(?:token|secret|api[_-]?key|apikey|passw(?:or)?d|pwd|credentials?)"
    r"|auth(?:orization)?|bearer|cookie|session[_-]?id)"
)

# Order matters: specific patterns first, generic "long blob" patterns last.
_SECRET_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bbot\d{5,}:[A-Za-z0-9_-]{20,}"),  # Telegram token in a URL
    re.compile(r"\b\d{5,}:[A-Za-z0-9_-]{30,}"),  # bare Telegram bot token
    re.compile(r"\bsk-[A-Za-z0-9_-]{16,}"),  # OpenAI / Anthropic style keys
    re.compile(r"\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}"),  # GitHub tokens
    re.compile(r"\bAIza[0-9A-Za-z_-]{30,}"),  # Google API keys
    re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),  # AWS access key ids
    re.compile(r"\bxox[abposr]-[A-Za-z0-9-]{10,}"),  # Slack tokens
    re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"),  # JWT
    re.compile(r"(?i)\b(?:basic|bearer)\s+[A-Za-z0-9._~+/-]{8,}=*"),  # HTTP auth schemes
    re.compile(rf"(?i)\b{_SECRET_KEY}\s*[:=]\s*\S+"),  # key=value / key: value
    re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"),  # e-mail addresses
    re.compile(r"(?<![\w@])@[A-Za-z][A-Za-z0-9_]{4,31}\b"),  # @handles
    re.compile(r"\b[A-Fa-f0-9]{32,}\b"),  # long hex (hashes, keys)
    re.compile(r"[A-Za-z0-9+/_-]{40,}={0,2}"),  # long base64-ish blobs
    re.compile(r"(?<![\w.])-?\d{7,}(?![\w.])"),  # chat / user ids, bare phone numbers
)

# Formatted phone numbers (`+7 912 345-67-89`, `(495) 123-45-67`). Matched loosely and
# kept only if they contain at least 10 digits, so dates and cron expressions survive.
_PHONE = re.compile(r"(?<![\w.+])\+?\(?\d[\d\s().-]{7,}\d(?![\w.])")
_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


def _phone(match: re.Match[str]) -> str:
    text = match.group(0)
    if _DATE.search(text):  # ISO dates ("2026-11-19 12") are not phone numbers
        return text
    return REDACTED if sum(ch.isdigit() for ch in text) >= 10 else text


def redact(text: str) -> str:
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub(REDACTED, text)
    return _PHONE.sub(_phone, text)


def utf16_len(text: str) -> int:
    """Length as zod's ``.max()`` counts it: UTF-16 code units (an emoji can be two)."""
    return len(text.encode("utf-16-le")) // 2


def clamp_utf16(text: str, limit: int) -> str:
    """Cut ``text`` to at most ``limit`` UTF-16 units, ending with an ellipsis when cut."""
    if utf16_len(text) <= limit:
        return text
    budget = max(limit - 1, 0)  # room for the ellipsis (one unit)
    out: list[str] = []
    for ch in text:
        budget -= utf16_len(ch)
        if budget < 0:
            break
        out.append(ch)
    return "".join(out).rstrip() + "…"


def clean_text(value: object, limit: int) -> str | None:
    """Return a display-safe single-line string, at most ``limit`` UTF-16 units, or None."""
    if value is None:
        return None
    text = value if isinstance(value, str) else str(value)
    text = _CONTROL.sub(" ", text)
    text = _WHITESPACE.sub(" ", text).strip()
    if not text:
        return None
    text = redact(text)
    return clamp_utf16(text, limit)


_SLUG_BAD = re.compile(r"[^a-z0-9-]+")


def slug(value: str, limit: int = 64) -> str:
    """Lower-case ``[a-z0-9-]`` identifier derived from arbitrary text."""
    s = _SLUG_BAD.sub("-", value.lower()).strip("-")
    return s[:limit].strip("-") or "item"


def unique_slug(value: str, used: set[str], limit: int = 64) -> str:
    """``slug`` that is not in ``used`` (numeric suffix, still within ``limit``); adds it."""
    base = slug(value, limit)
    candidate, n = base, 2
    while candidate in used:
        suffix = f"-{n}"
        candidate = base[: limit - len(suffix)].rstrip("-") + suffix
        n += 1
    used.add(candidate)
    return candidate
