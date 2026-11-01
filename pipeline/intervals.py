"""Rally intervals: merge model windows, snap them to scoreboard changes, then pad."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Rally:
    start: float
    end: float

    @property
    def duration(self) -> float:
        return self.end - self.start


def merge_rallies(rallies: list[Rally], *, join_gap: float = 1.0) -> list[Rally]:
    ordered = sorted(
        (rally for rally in rallies if rally.end - rally.start >= 0.8),
        key=lambda rally: (rally.start, rally.end),
    )
    if not ordered:
        return []
    merged: list[Rally] = [ordered[0]]
    for rally in ordered[1:]:
        previous = merged[-1]
        if rally.start <= previous.end + join_gap:
            merged[-1] = Rally(previous.start, max(previous.end, rally.end))
        else:
            merged.append(rally)
    return merged


def windows(duration: float, *, length: float = 120.0, overlap: float = 30.0) -> list[tuple[float, float]]:
    if duration <= 0:
        return []
    if duration <= length:
        return [(0.0, duration)]
    stride = max(1.0, length - overlap)
    spans: list[tuple[float, float]] = []
    start = 0.0
    while start < duration:
        end = min(duration, start + length)
        spans.append((start, end))
        if end >= duration:
            break
        start += stride
    return spans


def _nearest(changes: list[float], moment: float, confirm: float) -> float | None:
    close = [change for change in changes if abs(change - moment) <= confirm]
    if not close:
        return None
    return min(close, key=lambda change: abs(change - moment))


def _insert_change(rallies: list[Rally], moment: float, duration: float) -> list[Rally]:
    for index, rally in enumerate(rallies):
        if rally.start + 1.5 < moment < rally.end - 1.5:
            return [
                *rallies[:index],
                Rally(rally.start, moment),
                Rally(moment, rally.end),
                *rallies[index + 1 :],
            ]
    previous_end = 0.0
    next_start = duration
    for rally in rallies:
        if rally.end <= moment:
            previous_end = rally.end
        elif rally.start >= moment:
            next_start = min(next_start, rally.start)
            break
    start = max(previous_end, moment - 20.0)
    end = min(moment, next_start)
    if end - start < 1.5:
        return rallies
    return sorted([*rallies, Rally(start, end)], key=lambda rally: rally.start)


def _prefer_snapped_ends(rallies: list[Rally]) -> list[Rally]:
    """Keep a snapped end when the next rally continues after it. Do not delete the next rally."""
    ordered = sorted((rally for rally in rallies if rally.duration >= 0.8), key=lambda rally: (rally.start, rally.end))
    if not ordered:
        return []
    resolved: list[Rally] = [ordered[0]]
    for rally in ordered[1:]:
        previous = resolved[-1]
        if rally.start >= previous.end:
            resolved.append(rally)
            continue
        if previous.end >= rally.end:
            resolved[-1] = Rally(previous.start, rally.start)
            resolved.append(rally)
            continue
        if rally.end - previous.end >= 0.8:
            resolved.append(Rally(previous.end, rally.end))
    return [rally for rally in resolved if rally.duration >= 0.8]


def rallies_from_changes(changes: list[float], duration: float) -> list[Rally]:
    rallies: list[Rally] = []
    previous: float | None = None
    for moment in sorted(change for change in changes if 0 <= change <= duration):
        start = max(0.0, moment - 20.0) if previous is None else previous
        end = min(duration, moment)
        if end - start >= 1.5:
            rallies.append(Rally(start, end))
        previous = moment
    return rallies


def fuse_score_changes(
    rallies: list[Rally],
    changes: list[float],
    duration: float,
    *,
    confirm: float = 4.0,
) -> list[Rally]:
    """A score change near a rally end snaps that end. A change inside a rally splits it."""
    merged = merge_rallies(rallies)
    usable = sorted({round(change, 2) for change in changes if 0 <= change <= duration})
    if not usable:
        return merged
    snapped: list[Rally] = []
    used: list[float] = []
    for rally in merged:
        change = _nearest([item for item in usable if all(abs(item - kept) >= 0.05 for kept in used)], rally.end, confirm)
        if change is None:
            snapped.append(rally)
            continue
        used.append(change)
        end = change if change > rally.start + 0.5 else rally.end
        snapped.append(Rally(rally.start, end))
    result = _prefer_snapped_ends(snapped)
    for change in usable:
        if any(abs(change - kept) < 0.05 for kept in used):
            continue
        result = _insert_change(result, change, duration)
        used.append(change)
    # Join real overlaps from snapping. A split that only touches at the cut stays two rallies.
    return merge_rallies(result, join_gap=-0.05)


def pad_rallies(rallies: list[Rally], duration: float, *, pad: float = 1.0) -> list[Rally]:
    """Pad about a second each side, then meet in the middle where pads overlap."""
    padded = [
        Rally(max(0.0, rally.start - pad), min(duration, rally.end + pad))
        for rally in rallies
        if rally.end > rally.start
    ]
    if not padded:
        return []
    resolved: list[Rally] = [padded[0]]
    for rally in padded[1:]:
        previous = resolved[-1]
        if rally.start < previous.end:
            overlap_start = max(previous.start, rally.start)
            overlap_end = min(previous.end, rally.end)
            mid = (overlap_start + overlap_end) / 2
            resolved[-1] = Rally(previous.start, mid)
            if rally.end - mid >= 0.5:
                resolved.append(Rally(mid, rally.end))
        else:
            resolved.append(rally)
    return [rally for rally in resolved if rally.duration >= 0.5]
