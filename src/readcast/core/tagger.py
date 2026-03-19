"""Auto-tagging and entity extraction using a local LLM (Qwen2.5-0.5B via mlx-lm)."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Optional

MODEL_NAME = "Qwen/Qwen2.5-0.5B-Instruct"
MAX_INPUT_CHARS = 6000
MAX_RETRIES = 2

_model_cache: dict[str, object] = {}


@dataclass(slots=True)
class EntityResult:
    name: str
    entity_type: str  # person | company | technology | concept | event


@dataclass(slots=True)
class RelationshipResult:
    source: str
    target: str
    relationship_type: str


@dataclass(slots=True)
class TagResult:
    topics: list[str] = field(default_factory=list)
    entities: list[EntityResult] = field(default_factory=list)
    relationships: list[RelationshipResult] = field(default_factory=list)
    summary: Optional[str] = None
    author: Optional[str] = None


def _load_model():
    """Lazy-load the LLM (cached after first call)."""
    if "model" not in _model_cache:
        from mlx_lm import load

        model, tokenizer = load(MODEL_NAME)
        _model_cache["model"] = model
        _model_cache["tokenizer"] = tokenizer
    return _model_cache["model"], _model_cache["tokenizer"]


_SYSTEM_PROMPT = """\
You are a knowledge extraction system. Given an article, extract structured metadata as JSON.

Output ONLY valid JSON with this exact schema:
{
  "topics": ["topic1", "topic2", ...],
  "entities": [{"name": "...", "type": "person|company|technology|concept|event"}, ...],
  "relationships": [{"source": "entity name", "target": "entity name", "type": "relationship description"}, ...],
  "summary": "1-2 sentence summary",
  "author": "author name or null"
}

Rules:
- topics: 3-7 descriptive topic tags (lowercase, no hashtags)
- entities: key people, companies, technologies, concepts, and events mentioned
- relationships: connections between entities (e.g. "founded", "competes with", "uses", "developed by")
- summary: concise 1-2 sentence summary of the article's main point
- author: extract the author name if present in the text, otherwise null
- Output ONLY the JSON object, nothing else"""

_EXAMPLE_1_INPUT = (
    "NVIDIA announced its new Blackwell GPU architecture at GTC 2024. "
    "Jensen Huang demonstrated how the B200 chip delivers 20 petaflops of "
    "FP4 inference performance, ideal for running large language models."
)
_EXAMPLE_1_OUTPUT = {
    "topics": ["gpu architecture", "artificial intelligence", "hardware", "inference"],
    "entities": [
        {"name": "NVIDIA", "type": "company"},
        {"name": "Jensen Huang", "type": "person"},
        {"name": "Blackwell", "type": "technology"},
        {"name": "B200", "type": "technology"},
        {"name": "GTC 2024", "type": "event"},
    ],
    "relationships": [
        {"source": "NVIDIA", "target": "Blackwell", "type": "developed"},
        {"source": "Jensen Huang", "target": "NVIDIA", "type": "CEO of"},
        {"source": "B200", "target": "Blackwell", "type": "part of architecture"},
    ],
    "summary": (
        "NVIDIA unveiled its Blackwell GPU architecture at GTC 2024, "
        "with the B200 chip delivering 20 petaflops for LLMs."
    ),
    "author": None,
}

_EXAMPLE_2_INPUT = (
    "By Sarah Chen. OpenAI and Microsoft are expanding their partnership "
    "to build AI infrastructure. The deal includes deploying GPT-4 across "
    "Azure data centers worldwide, competing with Google's Gemini."
)
_EXAMPLE_2_OUTPUT = {
    "topics": ["artificial intelligence", "cloud computing", "partnerships"],
    "entities": [
        {"name": "OpenAI", "type": "company"},
        {"name": "Microsoft", "type": "company"},
        {"name": "Google", "type": "company"},
        {"name": "GPT-4", "type": "technology"},
        {"name": "Azure", "type": "technology"},
        {"name": "Gemini", "type": "technology"},
        {"name": "Sarah Chen", "type": "person"},
    ],
    "relationships": [
        {"source": "OpenAI", "target": "Microsoft", "type": "partners with"},
        {"source": "GPT-4", "target": "Azure", "type": "deployed on"},
        {"source": "Gemini", "target": "GPT-4", "type": "competes with"},
        {"source": "Google", "target": "Gemini", "type": "developed"},
    ],
    "summary": (
        "OpenAI and Microsoft are expanding their AI partnership "
        "to deploy GPT-4 across Azure, competing with Google's Gemini."
    ),
    "author": "Sarah Chen",
}

_FEW_SHOT_EXAMPLES = [
    {"input": _EXAMPLE_1_INPUT, "output": json.dumps(_EXAMPLE_1_OUTPUT)},
    {"input": _EXAMPLE_2_INPUT, "output": json.dumps(_EXAMPLE_2_OUTPUT)},
]


def _build_messages(text: str) -> list[dict[str, str]]:
    """Build the chat messages for the LLM."""
    messages = [{"role": "system", "content": _SYSTEM_PROMPT}]
    for example in _FEW_SHOT_EXAMPLES:
        messages.append({"role": "user", "content": f"Extract metadata from this article:\n\n{example['input']}"})
        messages.append({"role": "assistant", "content": example["output"]})
    truncated = text[:MAX_INPUT_CHARS]
    messages.append({"role": "user", "content": f"Extract metadata from this article:\n\n{truncated}"})
    return messages


def _parse_json_response(text: str) -> dict:
    """Extract and parse JSON from LLM response, handling common issues."""
    # Try direct parse first
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try to find JSON object in the response
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Could not parse JSON from LLM response: {text[:200]}")


def tag_article(text: str) -> TagResult:
    """Run the local LLM to extract tags, entities, relationships, summary, and author."""
    from mlx_lm import generate

    model, tokenizer = _load_model()
    messages = _build_messages(text)
    prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)

    for _ in range(MAX_RETRIES + 1):
        try:
            response = generate(model, tokenizer, prompt=prompt, max_tokens=1024, verbose=False)
            data = _parse_json_response(response)
            return _dict_to_tag_result(data)
        except (ValueError, KeyError, TypeError):
            continue

    # Return empty result rather than blocking the pipeline
    return TagResult()


def _dict_to_tag_result(data: dict) -> TagResult:
    """Convert parsed JSON dict to TagResult."""
    topics = [str(t).lower().strip() for t in data.get("topics", []) if isinstance(t, str)]

    entities = []
    for e in data.get("entities", []):
        if isinstance(e, dict) and "name" in e:
            entities.append(EntityResult(
                name=str(e["name"]).strip(),
                entity_type=str(e.get("type", "concept")).strip(),
            ))

    relationships = []
    for r in data.get("relationships", []):
        if isinstance(r, dict) and "source" in r and "target" in r:
            relationships.append(RelationshipResult(
                source=str(r["source"]).strip(),
                target=str(r["target"]).strip(),
                relationship_type=str(r.get("type", "related to")).strip(),
            ))

    summary = data.get("summary")
    if isinstance(summary, str):
        summary = summary.strip() or None
    else:
        summary = None

    author = data.get("author")
    if isinstance(author, str):
        author = author.strip() or None
    else:
        author = None

    return TagResult(
        topics=topics,
        entities=entities,
        relationships=relationships,
        summary=summary,
        author=author,
    )


def normalize_entity_name(name: str) -> str:
    """Normalize entity names for dedup: lowercase, strip common suffixes."""
    normalized = name.strip().lower()
    for suffix in (" inc", " inc.", " corp", " corp.", " ltd", " ltd.", " co", " co.", " llc"):
        if normalized.endswith(suffix):
            normalized = normalized[: -len(suffix)].strip()
    return normalized


def apply_tag_result(article_id: str, result: TagResult, store) -> None:
    """Store tag results: topics → article tags, entities → entities table, etc."""
    from datetime import UTC, datetime

    now = datetime.now(UTC).isoformat()

    # Update article tags and description
    article = store.get_article(article_id)
    if article is None:
        return

    if result.topics and not article.tags:
        article.tags = result.topics
    if result.summary and not article.description:
        article.description = result.summary
    if result.author and not article.author:
        article.author = result.author
    store.update_article(article)

    # Store entities and link to article
    entity_name_to_id: dict[str, int] = {}
    for entity in result.entities:
        normalized = normalize_entity_name(entity.name)
        eid = store.upsert_entity(normalized, entity.entity_type, now)
        entity_name_to_id[normalized] = eid
        store.link_article_entity(article_id, eid)

    # Store relationships
    for rel in result.relationships:
        src_norm = normalize_entity_name(rel.source)
        tgt_norm = normalize_entity_name(rel.target)
        src_id = entity_name_to_id.get(src_norm)
        tgt_id = entity_name_to_id.get(tgt_norm)
        if src_id and tgt_id:
            store.add_relationship(src_id, tgt_id, rel.relationship_type, article_id, now)

    store.log_agent_action("tagger", "tag_article", article_id, json.dumps({
        "topics": result.topics,
        "entity_count": len(result.entities),
        "relationship_count": len(result.relationships),
    }))
