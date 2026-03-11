from __future__ import annotations

from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
import json
import tomllib


DEFAULT_PUBLICATIONS = {
    "policytensor.substack.com": "Policy Tensor",
    "foreignaffairs.com": "Foreign Affairs",
    "noahpinion.substack.com": "Noahpinion",
    "stratechery.com": "Stratechery",
}
DEFAULT_TTS_MODEL = "kokoro-82m"
DEFAULT_TTS_VOICE = "af_sky"
DEFAULT_TTS_LANGUAGE = "en-us"
DEFAULT_TTS_MAX_CHARS = 12000
DEFAULT_TTS_AUDIO_FORMAT = "mp3"


@dataclass(slots=True)
class ReadcastConfig:
    output_dir: str = "~/.readcast/output"


@dataclass(slots=True)
class TTSConfig:
    model: str = DEFAULT_TTS_MODEL
    voice: str = DEFAULT_TTS_VOICE
    speed: float = 1.0
    language: str = DEFAULT_TTS_LANGUAGE
    max_chunk_chars: int = DEFAULT_TTS_MAX_CHARS
    audio_format: str = DEFAULT_TTS_AUDIO_FORMAT


@dataclass(slots=True)
class KokoroEdgeConfig:
    server_url: str = "http://127.0.0.1:7777"
    binary: str = "kokoro-edge"
    auto_start: bool = True
    startup_timeout_sec: int = 30


@dataclass(slots=True)
class WebConfig:
    host: str = "127.0.0.1"
    port: int = 8765
    open_browser: bool = True


@dataclass(slots=True)
class ExtractionConfig:
    publications: dict[str, str] = field(default_factory=lambda: dict(DEFAULT_PUBLICATIONS))


@dataclass(slots=True)
class Config:
    readcast: ReadcastConfig = field(default_factory=ReadcastConfig)
    tts: TTSConfig = field(default_factory=TTSConfig)
    kokoro_edge: KokoroEdgeConfig = field(default_factory=KokoroEdgeConfig)
    web: WebConfig = field(default_factory=WebConfig)
    extraction: ExtractionConfig = field(default_factory=ExtractionConfig)
    base_dir: Path = field(default_factory=lambda: Path("~/.readcast").expanduser())

    @property
    def config_path(self) -> Path:
        return self.base_dir / "config.toml"

    @property
    def output_dir(self) -> Path:
        return Path(self.readcast.output_dir).expanduser()

    @classmethod
    def load(cls, base_dir: Path | None = None) -> "Config":
        base = (base_dir or Path("~/.readcast")).expanduser()
        base.mkdir(parents=True, exist_ok=True)
        config = cls(base_dir=base)
        if not config.config_path.exists():
            config.save()
            return config

        with config.config_path.open("rb") as handle:
            data = tomllib.load(handle)

        readcast_data = _known_fields(ReadcastConfig, data.get("readcast", {}))
        tts_data = _migrate_tts_data(data.get("tts", {}))
        kokoro_edge_data = _known_fields(KokoroEdgeConfig, data.get("kokoro_edge", {}))
        web_data = _known_fields(WebConfig, data.get("web", {}))
        extraction_data = data.get("extraction", {})
        config.readcast = ReadcastConfig(**{**asdict(config.readcast), **readcast_data})
        config.tts = TTSConfig(**{**asdict(config.tts), **tts_data})
        config.kokoro_edge = KokoroEdgeConfig(**{**asdict(config.kokoro_edge), **kokoro_edge_data})
        config.web = WebConfig(**{**asdict(config.web), **web_data})
        config.extraction = ExtractionConfig(
            publications={**DEFAULT_PUBLICATIONS, **extraction_data.get("publications", {})}
        )
        config.output_dir.mkdir(parents=True, exist_ok=True)
        return config

    def save(self) -> None:
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        content = self._to_toml()
        self.config_path.write_text(content, encoding="utf-8")

    def set_value(self, dotted_key: str, value: str) -> None:
        section_name, _, field_name = dotted_key.partition(".")
        if not section_name or not field_name:
            raise KeyError("Config keys must use section.key format")

        section = getattr(self, section_name, None)
        if section is None or not hasattr(section, field_name):
            raise KeyError(dotted_key)

        current = getattr(section, field_name)
        setattr(section, field_name, self._coerce_value(current, value))
        self.save()

    def to_dict(self) -> dict[str, object]:
        return {
            "readcast": asdict(self.readcast),
            "tts": asdict(self.tts),
            "kokoro_edge": asdict(self.kokoro_edge),
            "web": asdict(self.web),
            "extraction": {"publications": dict(self.extraction.publications)},
        }

    def _to_toml(self) -> str:
        lines: list[str] = []

        lines.append("[readcast]")
        lines.append(f'output_dir = {json.dumps(self.readcast.output_dir)}')
        lines.append("")

        lines.append("[tts]")
        lines.append(f'model = {json.dumps(self.tts.model)}')
        lines.append("# Common Kokoro voices include: af_sky, af_heart, bm_daniel")
        lines.append(f'voice = {json.dumps(self.tts.voice)}')
        lines.append(f"speed = {self.tts.speed}")
        lines.append(f'language = {json.dumps(self.tts.language)}')
        lines.append(f"max_chunk_chars = {self.tts.max_chunk_chars}")
        lines.append(f'audio_format = {json.dumps(self.tts.audio_format)}')
        lines.append("")

        lines.append("[kokoro_edge]")
        lines.append(f'server_url = {json.dumps(self.kokoro_edge.server_url)}')
        lines.append(f'binary = {json.dumps(self.kokoro_edge.binary)}')
        lines.append(f"auto_start = {str(self.kokoro_edge.auto_start).lower()}")
        lines.append(f"startup_timeout_sec = {self.kokoro_edge.startup_timeout_sec}")
        lines.append("")

        lines.append("[web]")
        lines.append(f'host = {json.dumps(self.web.host)}')
        lines.append(f"port = {self.web.port}")
        lines.append(f"open_browser = {str(self.web.open_browser).lower()}")
        lines.append("")

        lines.append("[extraction]")
        lines.append('[extraction.publications]')
        for domain, publication in sorted(self.extraction.publications.items()):
            lines.append(f"{json.dumps(domain)} = {json.dumps(publication)}")
        lines.append("")

        return "\n".join(lines)

    @staticmethod
    def _coerce_value(current: object, raw: str) -> object:
        if isinstance(current, bool):
            return raw.strip().lower() in {"1", "true", "yes", "on"}
        if isinstance(current, int) and not isinstance(current, bool):
            return int(raw)
        if isinstance(current, float):
            return float(raw)
        return raw


def _known_fields(dataclass_type: type, values: dict[str, object]) -> dict[str, object]:
    allowed = {field_info.name for field_info in fields(dataclass_type)}
    return {key: value for key, value in values.items() if key in allowed}


def _migrate_tts_data(values: dict[str, object]) -> dict[str, object]:
    tts_data = dict(values)
    if "language" not in tts_data and "lang_code" in tts_data:
        raw_language = str(tts_data.pop("lang_code"))
        tts_data["language"] = "en-us" if raw_language == "en" else raw_language

    legacy_models = {
        "Marvis-AI/marvis-tts-250m-v0.1",
        "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16",
        "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16",
        "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16",
    }
    if str(tts_data.get("model", "")) in legacy_models:
        tts_data["model"] = DEFAULT_TTS_MODEL

    legacy_voices = {"conversational_a", "conversational_b", "serena", "chelsie", "vivian"}
    raw_voice = tts_data.get("voice")
    if isinstance(raw_voice, str) and raw_voice.lower() in legacy_voices:
        tts_data["voice"] = DEFAULT_TTS_VOICE

    return _known_fields(TTSConfig, tts_data)
