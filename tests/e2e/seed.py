"""Seed a temporary readcast database with realistic test data for e2e tests."""
from __future__ import annotations

import struct
from io import BytesIO
from pathlib import Path
from typing import Optional
import wave

from readcast.core.config import Config
from readcast.services import ReadcastService


def _wav_bytes(duration: float = 0.5) -> bytes:
    """Generate minimal valid WAV audio data."""
    buffer = BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(24000)
        handle.writeframes(b"\x00\x00" * int(24000 * duration))
    return buffer.getvalue()


# Articles: (title, body, source_url, tags, has_audio, duration)
ARTICLES = [
    ("The Future of Artificial Intelligence", "AI is transforming industries from healthcare to finance. Large language models have enabled new forms of human-computer interaction.", "https://techcrunch.com/ai-future", ["ai-tools", "ai-research"], True, 45.0),
    ("Understanding Geopolitical Tensions in East Asia", "The balance of power in East Asia is shifting as regional players invest in defense capabilities and form new alliances.", "https://foreignpolicy.com/east-asia", ["geopolitics", "defense"], True, 62.0),
    ("Python Best Practices for 2026", "Modern Python development emphasizes type hints, async patterns, and reproducible environments with tools like pixi.", "https://realpython.com/best-practices", ["ai-tools"], True, 30.0),
    ("The Psychology of Decision Making", "Behavioral economics reveals how cognitive biases shape our everyday choices, from financial decisions to personal relationships.", "https://aeon.co/psychology-decisions", ["reading"], True, 55.0),
    ("Military Technology and Modern Warfare", "Autonomous systems and AI-guided munitions are reshaping the battlefield, raising ethical questions about the future of warfare.", "https://defensenews.com/mil-tech", ["mil-tech", "defense"], True, 48.0),
    ("Climate Change and Renewable Energy", "The transition to renewable energy is accelerating, with solar and wind now cheaper than fossil fuels in most markets.", "https://nature.com/climate-energy", ["reading"], False, None),
    ("Quantum Computing Breakthroughs", "Recent advances in error correction bring practical quantum computing closer to reality, with implications for cryptography and drug discovery.", None, ["ai-research"], False, None),
    ("Building Local-First Software", "Local-first software keeps data on the user's device while still enabling collaboration, offering privacy and performance benefits.", "https://inkandswitch.com/local-first", ["ai-tools"], "generating", None),
]

LISTS = [
    ("Morning Commute", "playlist", "\U0001f3a7", "#6c8cff", "rgba(108,140,255,0.1)"),
    ("Study Queue", "collection", "\U0001f4da", "#a855f7", "rgba(168,85,247,0.12)"),
    ("Respond To", "todo", "\u2709", "#ef9f27", "rgba(239,159,39,0.12)"),
    ("AI Research", "playlist", "\U0001f9ea", "#2dd4bf", "rgba(45,212,191,0.12)"),
]

# (list_index, article_indices) — which articles go in which list
LIST_ITEMS = [
    (0, [0, 1, 3, 4]),       # Morning Commute: AI, Geopolitics, Psychology, MilTech
    (1, [0, 2, 7]),           # Study Queue: AI, Python, Local-First
    (2, [5, 6]),              # Respond To: Climate, Quantum
    (3, [0, 2]),              # AI Research: AI, Python
]


def seed_database(base_dir: Path) -> dict:
    """Seed the database and return IDs for reference.

    Returns dict with 'articles' (list of article objects) and 'lists' (list of list dicts).
    """
    config = Config.load(base_dir)
    service = ReadcastService(config)
    audio_data = _wav_bytes(0.5)

    # Create articles
    created_articles = []
    for title, body, source_url, tags, has_audio, duration in ARTICLES:
        result = service.add_text(
            f"{title}\n\n{body}",
            source_url=source_url,
            tags=tags,
        )
        article = result.article
        created_articles.append(article)

        if has_audio is True and duration:
            # Write audio file
            audio_path = service.store.get_article_dir(article.id) / "audio.mp3"
            audio_path.write_bytes(audio_data)
            service.store.update_audio_metadata(article.id, duration, "af_sky", "kokoro-82m", 1.0)
            service.store.set_rendition(article.id, "audio", {
                "state": "ready",
                "duration": duration,
                "voice": "af_sky",
                "generated_at": "2026-03-25T00:00:00Z",
            })
        elif has_audio == "generating":
            service.store.set_rendition(article.id, "audio", {
                "state": "generating",
                "duration": None,
                "voice": "af_sky",
                "generated_at": None,
            })

    # Create lists
    created_lists = []
    for name, list_type, icon, color, bg in LISTS:
        lst = service.store.create_list(name, list_type, icon=icon, color=color, bg=bg)
        created_lists.append(lst)

    # Add items to lists
    for list_idx, article_indices in LIST_ITEMS:
        list_id = created_lists[list_idx]["id"]
        for art_idx in article_indices:
            article = created_articles[art_idx]
            kwargs: dict = {}
            # Add due dates for todo items
            if created_lists[list_idx]["type"] == "todo":
                if art_idx == 5:  # Climate Change
                    kwargs["due"] = "2026-03-28"
                elif art_idx == 6:  # Quantum
                    kwargs["due"] = "2026-04-01"
            service.store.add_list_item(list_id, article.id, **kwargs)

    return {"articles": created_articles, "lists": created_lists}
