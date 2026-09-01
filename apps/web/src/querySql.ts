export function normalizeSelectionSql(sql: string): string {
  return sql.trim().replace(/;+\s*$/, "");
}
