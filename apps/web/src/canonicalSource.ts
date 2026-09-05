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
  for (const file of files) activityFamilyFromCanonicalPath(file.name);
  const paths = files.map((file) => sqlString(file.name)).join(",");
  return `SELECT * FROM read_parquet([${paths}],hive_partitioning=true)`;
}
