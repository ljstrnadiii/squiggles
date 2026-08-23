from dataclasses import dataclass
from datetime import datetime
from typing import Literal


@dataclass(frozen=True, slots=True)
class SummaryStats:
    activity_count: int
    distance_m: float
    moving_seconds: float
    elevation_gain_m: float
    max_elevation_m: float | None
    first_activity: datetime | None
    last_activity: datetime | None


@dataclass(frozen=True, slots=True)
class ArrowRenderPlan:
    type: Literal["arrow"]
    activity_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class MvtRenderPlan:
    type: Literal["mvt"]
    url_template: str


type RenderPlan = ArrowRenderPlan | MvtRenderPlan


@dataclass(frozen=True, slots=True)
class QueryExecution:
    query_id: str
    summary: SummaryStats
    render_plan: RenderPlan
