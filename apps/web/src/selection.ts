export function isUniversalSelectionSql(sql: string): boolean {
  return sql.trim().replace(/\s+/g, " ").toLowerCase() === "select activity_id from activities";
}
