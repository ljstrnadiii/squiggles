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

export function canonicalFileForPath(files: CanonicalFile[], canonicalPath: string): CanonicalFile {
  const normalized = canonicalPath.replace(/^\/+/, "");
  const matches = files.filter(
    (file) => file.name === normalized || file.name.endsWith(`/${normalized}`),
  );
  if (matches.length === 0) {
    throw new Error(`Canonical locator path is not registered: ${canonicalPath}`);
  }
  if (matches.length > 1) {
    throw new Error(`Canonical locator path is ambiguous: ${canonicalPath}`);
  }
  return matches[0];
}

export function targetedCanonicalSourceSql(
  files: CanonicalFile[],
  canonicalPath: string,
): string {
  const file = canonicalFileForPath(files, canonicalPath);
  activityFamilyFromCanonicalPath(file.name);
  return `read_parquet([${sqlString(file.name)}],hive_partitioning=true)`;
}
