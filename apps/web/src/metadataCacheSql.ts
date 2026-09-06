export const METADATA_CACHE_TABLE = "activity_cache";

export function materializeMetadataSql(source = "activity_source") {
  return `CREATE OR REPLACE TEMP TABLE ${METADATA_CACHE_TABLE} AS SELECT * FROM ${source}`;
}

export function residentMetadataRelation(clean: boolean) {
  if (!clean) return METADATA_CACHE_TABLE;
  return `(SELECT * REPLACE (
    coalesce(clean_distance_m,distance_m) AS distance_m,
    coalesce(clean_elevation_gain_m,elevation_gain_m) AS elevation_gain_m,
    coalesce(clean_elevation_loss_m,elevation_loss_m) AS elevation_loss_m,
    coalesce(clean_min_elevation_m,min_elevation_m) AS min_elevation_m,
    coalesce(clean_max_elevation_m,max_elevation_m) AS max_elevation_m,
    clean_point_count AS point_count,
    clean_xmin AS xmin, clean_ymin AS ymin, clean_xmax AS xmax, clean_ymax AS ymax
  ) FROM ${METADATA_CACHE_TABLE})`;
}
