import { PostgreSQL, sql } from "@codemirror/lang-sql";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";

const ACTIVITY_COLUMNS = [
  "activity_id", "source_activity_id", "source_filename", "source_type", "name", "sport_type",
  "start_time", "end_time", "start_year", "start_month", "activity_family", "distance_m",
  "elapsed_seconds", "moving_seconds", "elevation_gain_m", "elevation_loss_m", "min_elevation_m",
  "max_elevation_m", "point_count", "clean_point_count", "dropped_jump_points",
  "dropped_elevation_points", "clean_distance_m", "clean_elevation_gain_m", "clean_max_elevation_m",
  "xmin", "ymin", "xmax", "ymax", "geometry", "geometry_clean", "track_points",
];

const templates: Record<string, string> = {
  all: "SELECT activity_id\nFROM activities",
  runs: "SELECT activity_id\nFROM activities\nWHERE lower(sport_type) LIKE '%run%'",
  rides: "SELECT activity_id\nFROM activities\nWHERE activity_family = 'ride'",
  skiing: "SELECT activity_id\nFROM activities\nWHERE activity_family = 'ski'",
  recent: "SELECT activity_id\nFROM activities\nWHERE start_time >= current_date - INTERVAL '1 year'",
  long: "SELECT activity_id\nFROM activities\nWHERE distance_m >= 50000",
  high: `SELECT activity_id
FROM activities
WHERE EXISTS (
  SELECT 1
  FROM unnest(track_points) AS points(point)
  WHERE point.elevation_m >= 3657.6
)`,
};

export function SqlEditor({ value, dark, onChange }: { value: string; dark: boolean; onChange: (value: string) => void }) {
  return <section className="sql-editor">
    <div className="sql-assist">
      <label>Start with
        <select aria-label="SQL starter query" defaultValue="" onChange={event => {
          if (event.target.value) onChange(templates[event.target.value]);
          event.target.value = "";
        }}>
          <option value="" disabled>Choose an example…</option>
          <option value="all">All activities</option>
          <option value="runs">Runs</option>
          <option value="rides">Rides</option>
          <option value="skiing">Skiing</option>
          <option value="recent">Past year</option>
          <option value="long">50 km or longer</option>
          <option value="high">Any point above 12k ft</option>
        </select>
      </label>
      <span><kbd>Ctrl</kbd><kbd>Space</kbd> columns · <kbd>⌘</kbd><kbd>↵</kbd> run</span>
    </div>
    <CodeMirror
      aria-label="SQL query"
      value={value}
      minHeight="92px"
      maxHeight="240px"
      theme={dark ? "dark" : "light"}
      extensions={[
        sql({ dialect: PostgreSQL, schema: { activities: ACTIVITY_COLUMNS } }),
        EditorView.contentAttributes.of({ "aria-label": "SQL query" }),
      ]}
      basicSetup={{ foldGutter: false, highlightActiveLine: true, highlightActiveLineGutter: false }}
      onChange={onChange}
    />
  </section>;
}
