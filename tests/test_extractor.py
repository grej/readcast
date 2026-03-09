from __future__ import annotations

from pathlib import Path

from readcast.core.config import Config
from readcast.core.extractor import extract


class FakeResponse:
    def __init__(self, text: str):
        self.text = text

    def raise_for_status(self) -> None:
        return None


def test_extracts_brave_reader_fixture(base_dir: Path, fixture_dir: Path) -> None:
    config = Config.load(base_dir)

    article, chunks = extract(str(fixture_dir / "brave_reader_article.html"), config)

    assert article.title == "Why the US is facing strategic defeat"
    assert article.author == "Policy Tensor"
    assert article.publication == "Policy Tensor"
    assert any(chunk.chunk_type == "paragraph" for chunk in chunks)
    assert any(chunk.chunk_type == "blockquote" for chunk in chunks)
    assert any(chunk.chunk_type == "heading" for chunk in chunks)
    assert all(chunk.text.strip() for chunk in chunks)


def test_extracts_from_url(monkeypatch, base_dir: Path, fixture_dir: Path) -> None:
    config = Config.load(base_dir)
    html = (fixture_dir / "brave_reader_article.html").read_text(encoding="utf-8")

    def fake_get(url: str, headers, follow_redirects: bool, timeout: float) -> FakeResponse:
        assert url == "https://policytensor.substack.com/p/example"
        return FakeResponse(html)

    monkeypatch.setattr("readcast.core.extractor.httpx.get", fake_get)

    article, chunks = extract("https://policytensor.substack.com/p/example", config)

    assert article.source_url == "https://policytensor.substack.com/p/example"
    assert article.publication == "Policy Tensor"
    assert chunks[0].chunk_type == "title"


def test_extracts_plain_text_file_without_html_pipeline(monkeypatch, base_dir: Path, tmp_path: Path) -> None:
    config = Config.load(base_dir)
    text_path = tmp_path / "strategic-defeat-notes.txt"
    text_path.write_text(
        "First paragraph about air power.\n\nSecond paragraph about THAAD batteries.",
        encoding="utf-8",
    )

    def fail(html: str) -> tuple[str, str]:
        raise AssertionError("HTML extraction should not run for .txt files")

    monkeypatch.setattr("readcast.core.extractor._extract_readable_html", fail)

    article, chunks = extract(str(text_path), config)

    assert article.source_url is None
    assert article.source_file == str(text_path.resolve())
    assert article.title == "Strategic Defeat Notes"
    assert article.publication is None
    assert [chunk.chunk_type for chunk in chunks] == ["title", "paragraph", "paragraph"]
    assert chunks[0].text == "Strategic Defeat Notes"
    assert chunks[1].text == "First paragraph about air power."
    assert chunks[2].text == "Second paragraph about THAAD batteries."
