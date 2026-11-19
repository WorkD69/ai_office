from __future__ import annotations

import pytest

from ai_office_collector.sanitize import clean_text, slug


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (None, None),
        ("   ", None),
        ("  hello\n\tworld  ", "hello world"),
        ("bell\x07char", "bell char"),
        ("rtl\u202etrick", "rtl trick"),
        ("url bot123456:AAH" + "x" * 30, "url [redacted]"),
        ("key sk-" + "a" * 24, "key [redacted]"),
        ("ghp_" + "A" * 30, "[redacted]"),
        ("mail me at someone@example.com", "mail me at [redacted]"),
        ("chat -1001234567890 here", "chat [redacted] here"),
        ("sha " + "ab" * 20, "sha [redacted]"),
        ("api_key=hunter2 rest", "[redacted] rest"),
        ("cron 5 8,14,20 * * *", "cron 5 8,14,20 * * *"),
        ("version 0.21.6 at 12:00", "version 0.21.6 at 12:00"),
        (42, "42"),
    ],
)
def test_clean_text(raw, expected):
    assert clean_text(raw, 160) == expected


def test_clean_text_truncates_with_ellipsis():
    out = clean_text("x" * 10 + " " + "y" * 10, 12)
    assert out is not None and len(out) <= 12 and out.endswith("…")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("oh-scan-A", "oh-scan-a"), ("Daily digest!", "daily-digest"), ("***", "item")],
)
def test_slug(raw, expected):
    assert slug(raw) == expected
