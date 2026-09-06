from activity_map_ingest.render_lod import (
    MAX_RENDER_LOD,
    RENDER_LEVEL_COUNT,
    RENDER_PYRAMID_VERSION,
    RENDER_TOLERANCES_M,
    simplify_coordinates_meters,
)


def test_render_tolerances_are_dense_and_end_in_full_geometry() -> None:
    assert RENDER_PYRAMID_VERSION == "5"
    assert RENDER_LEVEL_COUNT == 8
    assert MAX_RENDER_LOD == 7
    assert RENDER_TOLERANCES_M == (2048.0, 512.0, 128.0, 32.0, 8.0, 2.0, 0.5, None)


def test_metric_simplification_preserves_endpoints_and_rewards_long_routes() -> None:
    short = [[-105.30 + index * 0.001, 40.0 + (index % 2) * 0.00001] for index in range(10)]
    long = [[-105.30 + index * 0.001, 40.0 + (index % 2) * 0.00001] for index in range(100)]
    short_simplified = simplify_coordinates_meters(short, 32.0)
    long_simplified = simplify_coordinates_meters(long, 32.0)
    assert short_simplified[0] == short[0]
    assert short_simplified[-1] == short[-1]
    assert long_simplified[0] == long[0]
    assert long_simplified[-1] == long[-1]
    assert len(long_simplified) >= len(short_simplified)


def test_full_render_level_is_lossless() -> None:
    route = [[-105.3, 40.0], [-105.2, 40.1], [-105.1, 40.0]]
    assert simplify_coordinates_meters(route, None) == route
