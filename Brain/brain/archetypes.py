"""Study archetypes. Course names never live here — only the routing rules."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Tuple


@dataclass(frozen=True)
class SpacedBlock:
    offset_days: int
    minutes: int
    task: str


@dataclass(frozen=True)
class Archetype:
    id: str
    same_day_minutes: int
    same_day_tasks: Tuple[str, ...]
    spaced: Tuple[SpacedBlock, ...]
    deep: bool = True


def _bio() -> Archetype:
    return Archetype(
        id="bio_physiology",
        same_day_minutes=60,
        same_day_tasks=(
            "Write high-level mechanism/signaling cascade synthesis notes: {topic}",
            "Create high-yield Anki cards for {topic}. Restrict image occlusion to anatomical diagrams; do not fragment physiological pathways into tiny cloze deletions.",
        ),
        spaced=(
            SpacedBlock(1, 30, "Active recall check before the next lecture: {topic}"),
            SpacedBlock(4, 30, "Active recall check: {topic}"),
        ),
    )


def _quant() -> Archetype:
    return Archetype(
        id="quant_engineering",
        same_day_minutes=75,
        same_day_tasks=(
            "Extract governing equations, circuit/system derivations, or code pipelines from slides: {topic}",
            "Targeted problem-set drill: {topic}",
        ),
        spaced=(SpacedBlock(3, 45, "Practice problem execution: {topic}"),),
    )


def _mcat() -> Archetype:
    return Archetype(
        id="mcat_block",
        same_day_minutes=90,
        same_day_tasks=(
            "UWorld/AAMC timed passage block, CARS passages, and missed-concept error-log review plus Anki consolidation: {topic}",
        ),
        spaced=(),
    )


def _research() -> Archetype:
    return Archetype(
        id="research_engineering",
        same_day_minutes=90,
        same_day_tasks=("Milestone execution: {topic}",),
        spaced=(),
    )


ARCHETYPES = {
    item.id: item
    for item in (_bio(), _quant(), _mcat(), _research())
}


def get_archetype(archetype_id: str) -> Archetype:
    try:
        return ARCHETYPES[archetype_id]
    except KeyError as exc:
        known = ", ".join(sorted(ARCHETYPES))
        raise KeyError(f"Unknown archetype {archetype_id!r}. Known: {known}") from exc
