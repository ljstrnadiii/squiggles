type CanonicalFile = { name: string };

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function activityFamilyFromCanonicalPath(path: string): string {
  const match = /(?:^|\/)activity_family=([^/]+)\//.exec(path);
  if (!match) throw new Error(`Canonical file is missing activity_family partition: ${path}`);
  return match[1];
}

export function canonicalSourceSql(files: CanonicalFile[]): string {
  if (!files.length) throw new Error("Dataset has no canonical files");
  return files
    .map((file) => {
      const family = activityFamilyFromCanonicalPath(file.name);
      return `SELECT *,${sqlString(family)} AS activity_family FROM read_parquet(${sqlString(file.name)},hive_partitioning=false)`;
    })
    .join(" UNION ALL ");
}
