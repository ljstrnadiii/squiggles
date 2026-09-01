import { AdminDeleteUserCommand, AdminGetUserCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { BatchClient, SubmitJobCommand, TerminateJobCommand } from "@aws-sdk/client-batch";
import { BatchWriteItemCommand, DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, DeleteObjectsCommand, HeadObjectCommand, ListObjectsV2Command, ListPartsCommand, S3Client, UploadPartCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

const dynamo = new DynamoDBClient({});
const cognito = new CognitoIdentityProviderClient({});
const s3 = new S3Client({});
const batch = new BatchClient({});
const tableName = process.env.METADATA_TABLE_NAME;
const userPoolId = process.env.USER_POOL_ID;
const uploadBucket = process.env.UPLOAD_BUCKET_NAME;
const dataBucket = process.env.DATA_BUCKET_NAME;
const jobQueue = process.env.INGEST_JOB_QUEUE;
const jobDefinition = process.env.INGEST_JOB_DEFINITION;
const bootstrapAdminEmail = (process.env.ADMIN_EMAIL ?? "ljstrnadiii@gmail.com").trim().toLowerCase();

function response(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(body) };
}

async function deletePrefix(bucket, prefix) {
  let token;
  do {
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    if (listed.Contents?.length) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: listed.Contents.map(item => ({ Key: item.Key })) } }));
    token = listed.NextContinuationToken;
  } while (token);
}

async function userPartition(subject) {
  const items = [];
  let cursor;
  do {
    const page = await dynamo.send(new QueryCommand({ TableName: tableName, KeyConditionExpression: "PK = :pk", ExpressionAttributeValues: { ":pk": { S: `USER#${subject}` } }, ExclusiveStartKey: cursor }));
    items.push(...(page.Items ?? []));
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return items;
}

async function profilesForStatus(status) {
  const items = [];
  let cursor;
  do {
    const page = await dynamo.send(new QueryCommand({ TableName: tableName, IndexName: "GSI1", KeyConditionExpression: "GSI1PK = :pk", ExpressionAttributeValues: { ":pk": { S: `USER_STATUS#${status}` } }, ExclusiveStartKey: cursor }));
    items.push(...(page.Items ?? []));
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return items.filter(item => item.SK?.S === "PROFILE");
}

function adminUser(profile, records) {
  const uploads = records.filter(item => item.entityType?.S === "upload").sort((a, b) => (b.updatedAt?.S ?? b.createdAt?.S ?? "").localeCompare(a.updatedAt?.S ?? a.createdAt?.S ?? ""));
  const datasets = records.filter(item => item.entityType?.S === "dataset").sort((a, b) => (b.updatedAt?.S ?? b.createdAt?.S ?? "").localeCompare(a.updatedAt?.S ?? a.createdAt?.S ?? ""));
  const shares = records.filter(item => item.entityType?.S === "share").sort((a, b) => (b.updatedAt?.S ?? "").localeCompare(a.updatedAt?.S ?? ""));
  const latestUpload = uploads[0];
  const dataset = datasets[0];
  const share = shares[0];
  const datasetId = dataset?.SK?.S?.startsWith("DATASET#") ? dataset.SK.S.slice(8) : null;
  const publishedUrl = share?.slug?.S ? `/p/${share.slug.S}` : null;
  const mapUrl = publishedUrl ?? (datasetId ? `/m/${datasetId}` : null);
  const access = profile.status?.S ?? "pending";
  const uploadStatus = latestUpload?.status?.S ?? null;
  const phase = access !== "approved" ? `access:${access}` : share ? "published" : dataset ? "ready" : uploadStatus ?? "approved";
  return {
    subject: profile.PK.S.slice(5),
    email: profile.email?.S ?? "",
    name: profile.name?.S ?? "",
    status: access,
    role: profile.role?.S ?? "user",
    phase,
    createdAt: profile.createdAt?.S ?? "",
    updatedAt: profile.updatedAt?.S ?? "",
    uploads: uploads.length,
    uploadedBytes: uploads.reduce((total, item) => total + Number(item.byteSize?.N ?? 0), 0),
    latestUpload: latestUpload ? {
      id: latestUpload.SK.S.slice(7),
      filename: latestUpload.filename?.S ?? "",
      status: uploadStatus,
      statusDetail: latestUpload.statusDetail?.S ?? "",
      progressCompleted: Number(latestUpload.progressCompleted?.N ?? 0),
      progressTotal: Number(latestUpload.progressTotal?.N ?? 0),
      updatedAt: latestUpload.updatedAt?.S ?? latestUpload.createdAt?.S ?? "",
    } : null,
    datasets: datasets.length,
    datasetId,
    activityCount: datasets.reduce((total, item) => total + Number(item.activityCount?.N ?? 0), 0),
    publishedUrl,
    mapUrl,
    publishedViews: shares.reduce((total, item) => total + Number(item.viewCount?.N ?? 0), 0),
  };
}

async function listAdminUsers() {
  const profiles = (await Promise.all(["pending", "approved", "rejected"].map(profilesForStatus))).flat();
  const users = await Promise.all(profiles.map(async profile => adminUser(profile, await userPartition(profile.PK.S.slice(5)))));
  users.sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
  return users;
}

export async function handler(event) {
  const route = event.routeKey;
  if (route === "GET /api/published/{slug}") {
    const slug = event.pathParameters?.slug;
    if (!tableName || !/^[a-z0-9]{8}$/.test(slug ?? "")) return response(404, { error: "published_view_not_found" });
    const found = await dynamo.send(new QueryCommand({ TableName: tableName, IndexName: "GSI1", KeyConditionExpression: "GSI1PK = :pk", ExpressionAttributeValues: { ":pk": { S: `PUBLISHED#${slug}` } }, Limit: 1 }));
    const published = found.Items?.[0];
    if (!published) return response(404, { error: "published_view_not_found" });
    await dynamo.send(new UpdateItemCommand({ TableName: tableName, Key: { PK: published.PK, SK: published.SK }, UpdateExpression: "ADD viewCount :one", ExpressionAttributeValues: { ":one": { N: "1" } } }));
    return response(200, { slug, tabs: JSON.parse(published.tabsJson.S), active: published.activeTab.S, datasetId: published.datasetId?.S ?? null, updatedAt: published.updatedAt.S });
  }

  const claims = event.requestContext?.authorizer?.jwt?.claims;
  const subject = claims?.sub;
  const username = claims?.username;
  if (!subject || !username || !tableName || !userPoolId || !uploadBucket || !dataBucket || !jobQueue || !jobDefinition) return response(401, { error: "unauthorized" });

  const cognitoUser = await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }));
  const attributes = Object.fromEntries((cognitoUser.UserAttributes ?? []).map(attribute => [attribute.Name, attribute.Value ?? ""]));
  const verifiedEmail = attributes.email_verified === "true" ? attributes.email ?? "" : "";
  const verifiedName = attributes.name ?? "";
  const verifiedPicture = attributes.picture ?? "";
  const isBootstrapAdmin = Boolean(verifiedEmail) && verifiedEmail.toLowerCase() === bootstrapAdminEmail;

  const key = { PK: { S: `USER#${subject}` }, SK: { S: "PROFILE" } };
  const existing = await dynamo.send(new GetItemCommand({ TableName: tableName, Key: key, ConsistentRead: true }));
  if (!existing.Item) {
    const now = new Date().toISOString();
    try {
      await dynamo.send(new PutItemCommand({
        TableName: tableName,
        ConditionExpression: "attribute_not_exists(PK)",
        Item: {
          ...key,
          entityType: { S: "user" },
          status: { S: isBootstrapAdmin ? "approved" : "pending" },
          role: { S: isBootstrapAdmin ? "admin" : "user" },
          email: { S: verifiedEmail }, name: { S: verifiedName }, picture: { S: verifiedPicture },
          createdAt: { S: now }, updatedAt: { S: now },
          GSI1PK: { S: `USER_STATUS#${isBootstrapAdmin ? "approved" : "pending"}` }, GSI1SK: { S: now },
        },
      }));
    } catch (error) {
      if (error?.name !== "ConditionalCheckFailedException") throw error;
    }
  } else {
    const needsIdentity = (!existing.Item.email?.S && verifiedEmail) || (!existing.Item.name?.S && verifiedName);
    const needsAdmin = isBootstrapAdmin && (existing.Item.role?.S !== "admin" || existing.Item.status?.S !== "approved");
    if (needsIdentity || needsAdmin) {
      const now = new Date().toISOString();
      await dynamo.send(new UpdateItemCommand({
        TableName: tableName, Key: key,
        UpdateExpression: needsAdmin ? "SET email = :email, #name = :name, picture = :picture, #status = :approved, #role = :admin, GSI1PK = :gsi, updatedAt = :updated" : "SET email = :email, #name = :name, picture = :picture, updatedAt = :updated",
        ExpressionAttributeNames: { "#name": "name", ...(needsAdmin ? { "#status": "status", "#role": "role" } : {}) },
        ExpressionAttributeValues: {
          ":email": { S: verifiedEmail }, ":name": { S: verifiedName }, ":picture": { S: verifiedPicture }, ":updated": { S: now },
          ...(needsAdmin ? { ":approved": { S: "approved" }, ":admin": { S: "admin" }, ":gsi": { S: "USER_STATUS#approved" } } : {}),
        },
      }));
    }
  }

  const current = (await dynamo.send(new GetItemCommand({ TableName: tableName, Key: key, ConsistentRead: true }))).Item;
  const isAdmin = current?.role?.S === "admin" && current?.status?.S === "approved";

  if (route === "GET /api/me" && event.queryStringParameters?.admin === "users") {
    if (!isAdmin) return response(403, { error: "admin_required" });
    return response(200, { users: await listAdminUsers() });
  }

  if (route === "POST /api/published" && event.queryStringParameters?.admin === "access") {
    if (!isAdmin) return response(403, { error: "admin_required" });
    const body = JSON.parse(event.body ?? "{}");
    const target = String(body.subject ?? "");
    const status = String(body.status ?? "");
    if (!/^[0-9a-f-]{16,64}$/i.test(target) || !["pending", "approved", "rejected"].includes(status)) return response(400, { error: "invalid_admin_update" });
    if (target === subject) return response(409, { error: "cannot_change_own_access" });
    const targetKey = { PK: { S: `USER#${target}` }, SK: { S: "PROFILE" } };
    const targetProfile = (await dynamo.send(new GetItemCommand({ TableName: tableName, Key: targetKey, ConsistentRead: true }))).Item;
    if (!targetProfile) return response(404, { error: "user_not_found" });
    const now = new Date().toISOString();
    await dynamo.send(new UpdateItemCommand({
      TableName: tableName, Key: targetKey,
      UpdateExpression: "SET #status = :status, #role = :user, GSI1PK = :gsi, updatedAt = :now",
      ExpressionAttributeNames: { "#status": "status", "#role": "role" },
      ExpressionAttributeValues: { ":status": { S: status }, ":user": { S: "user" }, ":gsi": { S: `USER_STATUS#${status}` }, ":now": { S: now } },
    }));
    return response(200, { subject: target, status });
  }

  if (route === "POST /api/published") {
    if (current?.status?.S !== "approved") return response(403, { error: "approval_required" });
    const body = JSON.parse(event.body ?? "{}");
    const tabsJson = JSON.stringify(body.tabs ?? []);
    if (!Array.isArray(body.tabs) || body.tabs.length < 1 || body.tabs.length > 50 || tabsJson.length > 100_000 || !body.tabs.every(tab => typeof tab?.id === "string" && typeof tab?.title === "string" && typeof tab?.sql === "string") || typeof body.active !== "string") return response(400, { error: "invalid_published_view" });
    const shareKey = { PK: key.PK, SK: { S: "SHARE#primary" } };
    const prior = (await dynamo.send(new GetItemCommand({ TableName: tableName, Key: shareKey, ConsistentRead: true }))).Item;
    const slug = prior?.slug?.S ?? randomUUID().replaceAll("-", "").slice(0, 8);
    const now = new Date().toISOString();
    await dynamo.send(new PutItemCommand({ TableName: tableName, Item: { ...shareKey, entityType: { S: "share" }, slug: { S: slug }, tabsJson: { S: tabsJson }, activeTab: { S: body.active }, ...(typeof body.datasetId === "string" && /^[0-9a-f-]{36}$/i.test(body.datasetId) ? { datasetId: { S: body.datasetId } } : {}), viewCount: prior?.viewCount ?? { N: "0" }, createdAt: prior?.createdAt ?? { S: now }, updatedAt: { S: now }, GSI1PK: { S: `PUBLISHED#${slug}` }, GSI1SK: { S: "VIEW" } } }));
    return response(200, { slug, url: `/p/${slug}` });
  }

  if (route === "DELETE /api/me") {
    const records = await userPartition(subject);
    await Promise.all(records.filter(item => item.batchJobId?.S).map(item => batch.send(new TerminateJobCommand({ jobId: item.batchJobId.S, reason: "Squiggles account deleted" })).catch(() => undefined)));
    await Promise.all(records.filter(item => item.multipartUploadId?.S && item.objectKey?.S).map(item => s3.send(new AbortMultipartUploadCommand({ Bucket: uploadBucket, Key: item.objectKey.S, UploadId: item.multipartUploadId.S })).catch(() => undefined)));
    await Promise.all([deletePrefix(uploadBucket, `users/${subject}/`), ...records.filter(item => item.SK?.S?.startsWith("DATASET#")).map(item => deletePrefix(dataBucket, `datasets/${item.SK.S.slice(8)}/`))]);
    for (let offset = 0; offset < records.length; offset += 25) {
      let requests = records.slice(offset, offset + 25).map(item => ({ DeleteRequest: { Key: { PK: item.PK, SK: item.SK } } }));
      for (let attempt = 0; requests.length && attempt < 5; attempt += 1) {
        const written = await dynamo.send(new BatchWriteItemCommand({ RequestItems: { [tableName]: requests } }));
        requests = written.UnprocessedItems?.[tableName] ?? [];
      }
      if (requests.length) throw new Error("account metadata deletion incomplete");
    }
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: username }));
    return response(204, {});
  }

  if (route === "POST /api/uploads") {
    if (current?.status?.S !== "approved") return response(403, { error: "approval_required" });
    const body = JSON.parse(event.body ?? "{}");
    if (!String(body.filename ?? "").toLowerCase().endsWith(".zip") || !Number.isInteger(body.size) || body.size <= 0 || body.size > 5_000_000_000) return response(400, { error: "invalid_upload" });
    const id = randomUUID();
    const objectKey = `users/${subject}/${id}/strava-filtered.zip`;
    const now = new Date().toISOString();
    const multipart = await s3.send(new CreateMultipartUploadCommand({ Bucket: uploadBucket, Key: objectKey, ContentType: "application/zip", ChecksumAlgorithm: "SHA256" }));
    await dynamo.send(new PutItemCommand({ TableName: tableName, Item: { PK: key.PK, SK: { S: `UPLOAD#${id}` }, entityType: { S: "upload" }, status: { S: "uploading" }, filename: { S: String(body.filename).slice(0, 200) }, byteSize: { N: String(body.size) }, objectKey: { S: objectKey }, multipartUploadId: { S: multipart.UploadId }, createdAt: { S: now }, updatedAt: { S: now } }, ConditionExpression: "attribute_not_exists(PK)" }));
    return response(201, { id, status: "uploading" });
  }

  if (route === "POST /api/uploads/{id}/parts") {
    const id = event.pathParameters?.id; const body = JSON.parse(event.body ?? "{}");
    if (!/^[0-9a-f-]{36}$/.test(id ?? "") || !Number.isInteger(body.partNumber) || body.partNumber < 1 || body.partNumber > 10000 || !/^[A-Za-z0-9+/]{43}=$/.test(body.checksumSha256 ?? "")) return response(400, { error: "invalid_part" });
    const upload = (await dynamo.send(new GetItemCommand({ TableName: tableName, Key: { PK: key.PK, SK: { S: `UPLOAD#${id}` } }, ConsistentRead: true }))).Item;
    if (!upload || upload.status?.S !== "uploading") return response(409, { error: "upload_not_ready" });
    const uploadUrl = await getSignedUrl(s3, new UploadPartCommand({ Bucket: uploadBucket, Key: upload.objectKey.S, UploadId: upload.multipartUploadId.S, PartNumber: body.partNumber, ChecksumSHA256: body.checksumSha256 }), { expiresIn: 900, unhoistableHeaders: new Set(["x-amz-checksum-sha256"]) });
    return response(200, { uploadUrl });
  }

  if (route === "GET /api/uploads/{id}/parts") {
    const id = event.pathParameters?.id;
    const upload = (await dynamo.send(new GetItemCommand({ TableName: tableName, Key: { PK: key.PK, SK: { S: `UPLOAD#${id}` } }, ConsistentRead: true }))).Item;
    if (!upload || upload.status?.S !== "uploading") return response(409, { error: "upload_not_ready" });
    const parts = await s3.send(new ListPartsCommand({ Bucket: uploadBucket, Key: upload.objectKey.S, UploadId: upload.multipartUploadId.S }));
    return response(200, { parts: (parts.Parts ?? []).map(part => ({ partNumber: part.PartNumber, checksumSha256: part.ChecksumSHA256 })) });
  }

  if (route === "POST /api/uploads/{id}/complete") {
    if (current?.status?.S !== "approved") return response(403, { error: "approval_required" });
    const id = event.pathParameters?.id;
    if (!/^[0-9a-f-]{36}$/.test(id ?? "")) return response(400, { error: "invalid_upload" });
    const uploadKey = { PK: key.PK, SK: { S: `UPLOAD#${id}` } };
    let upload = (await dynamo.send(new GetItemCommand({ TableName: tableName, Key: uploadKey, ConsistentRead: true }))).Item;
    if (!upload) return response(404, { error: "upload_not_found" });
    if (upload.status?.S === "queued") return response(200, { id, status: "queued" });
    if (upload.status?.S === "uploading") {
      const listed = await s3.send(new ListPartsCommand({ Bucket: uploadBucket, Key: upload.objectKey.S, UploadId: upload.multipartUploadId.S }));
      if (listed.IsTruncated || !(listed.Parts?.length)) return response(422, { error: "upload_verification_failed" });
      await s3.send(new CompleteMultipartUploadCommand({ Bucket: uploadBucket, Key: upload.objectKey.S, UploadId: upload.multipartUploadId.S, MultipartUpload: { Parts: listed.Parts.map(part => ({ PartNumber: part.PartNumber, ETag: part.ETag, ChecksumSHA256: part.ChecksumSHA256 })) } }));
      const object = await s3.send(new HeadObjectCommand({ Bucket: uploadBucket, Key: upload.objectKey.S }));
      if (object.ContentLength !== Number(upload.byteSize.N)) return response(422, { error: "upload_verification_failed" });
      await dynamo.send(new UpdateItemCommand({ TableName: tableName, Key: uploadKey, ConditionExpression: "#status = :uploading", UpdateExpression: "SET #status = :pending, updatedAt = :now", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":uploading": { S: "uploading" }, ":pending": { S: "pending" }, ":now": { S: new Date().toISOString() } } }));
      upload = (await dynamo.send(new GetItemCommand({ TableName: tableName, Key: uploadKey, ConsistentRead: true }))).Item;
    }
    if (upload?.status?.S !== "pending") return response(409, { error: "upload_not_ready" });
    const submitted = await batch.send(new SubmitJobCommand({ jobName: `ingest-${id}`, jobQueue, jobDefinition, containerOverrides: { environment: [
      { name: "TABLE_NAME", value: tableName }, { name: "SOURCE_BUCKET", value: uploadBucket }, { name: "SOURCE_KEY", value: upload.objectKey.S },
      { name: "DATA_BUCKET", value: dataBucket }, { name: "USER_SUB", value: subject }, { name: "UPLOAD_ID", value: id },
    ] } }));
    await dynamo.send(new UpdateItemCommand({ TableName: tableName, Key: uploadKey, ConditionExpression: "#status = :pending", UpdateExpression: "SET #status = :queued, batchJobId = :job, updatedAt = :now", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":pending": { S: "pending" }, ":queued": { S: "queued" }, ":job": { S: submitted.jobId }, ":now": { S: new Date().toISOString() } } }));
    return response(200, { id, status: "queued" });
  }

  if (route === "GET /api/uploads") {
    const result = await dynamo.send(new QueryCommand({ TableName: tableName, KeyConditionExpression: "PK = :pk AND begins_with(SK, :upload)", ExpressionAttributeValues: { ":pk": key.PK, ":upload": { S: "UPLOAD#" } }, ScanIndexForward: false }));
    return response(200, { uploads: (result.Items ?? []).map(item => ({ id: item.SK.S.slice(7), filename: item.filename.S, byteSize: Number(item.byteSize.N), status: item.status.S, statusDetail: item.statusDetail?.S ?? "", progressCompleted: Number(item.progressCompleted?.N ?? 0), progressTotal: Number(item.progressTotal?.N ?? 0), createdAt: item.createdAt.S })) });
  }

  const records = await userPartition(subject);
  return response(200, {
    subject,
    email: current?.email?.S ?? verifiedEmail,
    name: current?.name?.S ?? verifiedName,
    picture: current?.picture?.S ?? verifiedPicture,
    status: current?.status?.S ?? "pending",
    role: current?.role?.S ?? "user",
    stats: {
      uploadedBytes: records.filter(item => item.entityType?.S === "upload").reduce((total, item) => total + Number(item.byteSize?.N ?? 0), 0),
      activityCount: records.filter(item => item.entityType?.S === "dataset").reduce((total, item) => total + Number(item.activityCount?.N ?? 0), 0),
      curatedBytes: records.filter(item => item.entityType?.S === "dataset").reduce((total, item) => total + Number(item.byteSize?.N ?? 0), 0),
      datasetCount: records.filter(item => item.entityType?.S === "dataset").length,
      publishedViews: records.filter(item => item.entityType?.S === "share").reduce((total, item) => total + Number(item.viewCount?.N ?? 0), 0),
      publishedMaps: records.filter(item => item.entityType?.S === "share").length,
    },
  });
}
