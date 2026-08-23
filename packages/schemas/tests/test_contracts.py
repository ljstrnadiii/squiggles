from activity_map_schemas import ArrowRenderPlan, QueryExecution, SummaryStats


def test_query_execution_has_replaceable_render_plan() -> None:
    execution = QueryExecution(
        query_id="query-1",
        summary=SummaryStats(0, 0, 0, 0, None, None, None),
        render_plan=ArrowRenderPlan(type="arrow", activity_ids=()),
    )
    assert execution.render_plan.type == "arrow"
