import { AdminDeleteUserCommand, AdminGetUserCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { BatchClient, SubmitJobCommand, TerminateJobCommand } from "@aws-sdk/client-batch";
import { BatchWriteItemCommand, DeleteItemCommand, DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, ListPartsCommand, S3Client, UploadPartCommand } from "@aws-sdk/client-s3";
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

async function profileForSubject(subject) {
  if (!subject) return null;
  return (await dynamo.send(new GetItemCommand({ TableName: tableName, Key: { PK: { S: `USER#${subject}` }, SK: { S: "PROFILE" } }, ConsistentRead: true }))).Item ?? null;
}

function mapIdentity(profile, mapId, viewerRole) {
  return {
    mapId,
    ownerDisplayName: profile?.name?.S || "Shared map",
    ...(profile?.picture?.S ? { ownerAvatarUrl: profile.picture.S } : {}),
    viewerRole,
  };
}

function latestReadyDataset(records) {
  return records
    .filter(item => item.entityType?.S === "dataset" && item.status?.S === "ready")
    .sort((a, b) => (b.updatedAt?.S ?? b.createdAt?.S ?? "").localeCompare(a.updatedAt?.S ?? a.createdAt?.S ?? ""))[0] ?? null;
}

async function mapRecordById(mapId) {
  if (!/^[0-9a-f-]{36}$/i.test(mapId ?? "")) return null;
  const found = await dynamo.send(new QueryCommand({ TableName: tableName, IndexName: "GSI1", KeyConditionExpression: "GSI1PK = :pk", ExpressionAttributeValues: { ":pk": { S: `MAP#${mapId}` } }, Limit: 1 }));
  return found.Items?.[0] ?? null;
}

async function ensureMapForSubject(subject, profile = null) {
  const ownerProfile = profile ?? await profileForSubject(subject);
  if (!ownerProfile) return null;
  let mapId = ownerProfile.mapId?.S;
  if (!mapId) {
    const created = randomUUID();
    const updated = await dynamo.send(new UpdateItemCommand({
      TableName: tableName,
      Key: { PK: { S: `USER#${subject}` }, SK: { S: "PROFILE" } },
      UpdateExpression: "SET mapId = if_not_exists(mapId, :mapId)",
      ExpressionAttributeValues: { ":mapId": { S: created } },
      ReturnValues: "ALL_NEW",
    }));
    mapId = updated.Attributes?.mapId?.S ?? created;
    ownerProfile.mapId = { S: mapId };
  }
  const now = new Date().toISOString();
  try {
    await dynamo.send(new PutItemCommand({
      TableName: tableName,
      ConditionExpression: "attribute_not_exists(PK)",
      Item: {
        PK: { S: `USER#${subject}` }, SK: { S: "MAP#primary" }, entityType: { S: "map" }, mapId: { S: mapId }, ownerSubject: { S: subject },
        viewCount: { N: "0" }, createdAt: { S: now }, updatedAt: { S: now }, GSI1PK: { S: `MAP#${mapId}` }, GSI1SK: { S: "MAP" },
      },
    }));
  } catch (error) {
    if (error?.name !== "ConditionalCheckFailedException") throw error;
  }
  return mapId;
}

async function publishedBySlug(slug) {
  if (!/^[a-z0-9]{8}$/.test(slug ?? "")) return null;
  const found = await dynamo.send(new QueryCommand({ TableName: tableName, IndexName: "GSI1", KeyConditionExpression: "GSI1PK = :pk", ExpressionAttributeValues: { ":pk": { S: `PUBLISHED#${slug}` } }, Limit: 1 }));
  return found.Items?.[0] ?? null;
}

async function mapContext(reference) {
  let ownerSubject = null;
  let legacyShare = null;
  let mapRecord = null;

  if (/^[0-9a-f-]{36}$/i.test(reference ?? "")) {
    mapRecord = await mapRecordById(reference);
    ownerSubject = mapRecord?.ownerSubject?.S ?? mapRecord?.PK?.S?.slice(5) ?? null;
    if (!ownerSubject) {
      const registry = (await dynamo.send(new GetItemCommand({ TableName: tableName, Key: { PK: { S: `DATASET#${reference}` }, SK: { S: "META" } }, ConsistentRead: true }))).Item;
      ownerSubject = registry?.owner?.S ?? null;
    }
  } else if (/^[a-z0-9]{8}$/.test(reference ?? "")) {
    legacyShare = await publishedBySlug(reference);
    ownerSubject = legacyShare?.PK?.S?.slice(5) ?? null;
  }

  if (!ownerSubject) return null;
  const profile = await profileForSubject(ownerSubject);
  if (!profile) return null;
  const mapId = await ensureMapForSubject(ownerSubject, profile);
  const records = await userPartition(ownerSubject);
  const share = legacyShare ?? records.find(item => item.SK?.S === "SHARE#primary") ?? null;
  const dataset = latestReadyDataset(records);
  const datasetId = dataset?.datasetId?.S ?? dataset?.SK?.S?.slice(8) ?? null;
  mapRecord ??= records.find(item => item.SK?.S === "MAP#primary") ?? null;
  return { mapId, ownerSubject, profile, records, share, datasetId, mapRecord };
}

async function recentMapView(item) {
  const profile = await profileForSubject(item.ownerSubject?.S);
  const mapId = item.mapId?.S ?? profile?.mapId?.S ?? "";
  return {
    ...mapIdentity(profile, mapId, "viewer"),
    url: mapId ? `/m/${mapId}` : item.url?.S ?? "",
    lastViewedAt: item.updatedAt?.S ?? item.createdAt?.S ?? "",
  };
}

function ownMap(_records, profile) {
  const mapId = profile?.mapId?.S;
  return mapId ? { ...mapIdentity(profile, mapId, "owner"), url: `/m/${mapId}` } : null;
}

async function activeDatasetBuild(datasetId) {
  const page = await dynamo.send(new QueryCommand({ TableName: tableName, KeyConditionExpression: "PK = :pk AND begins_with(SK, :build)", ExpressionAttributeValues: { ":pk": { S: `DATASET#${datasetId}` }, ":build": { S: "BUILD#" } } }));
  return (page.Items ?? [])
    .filter(item => !["ready", "failed"].includes(item.status?.S ?? ""))
    .sort((a, b) => (b.updatedAt?.S ?? "").localeCompare(a.updatedAt?.S ?? ""))[0] ?? null;
}

async function uploadView(item) {
  const id = item.SK.S.slice(7);
  const rebuild = await activeDatasetBuild(id);
  const progress = rebuild ?? item;
  return {
    id,
    filename: item.filename?.S ?? "",
    byteSize: Number(item.byteSize?.N ?? 0),
    status: progress.status?.S ?? item.status?.S ?? "",
    statusDetail: progress.statusDetail?.S ?? item.statusDetail?.S ?? "",
    progressCompleted: Number(progress.progressCompleted?.N ?? 0),
    progressTotal: Number(progress.progressTotal?.N ?? 0),
    createdAt: item.createdAt?.S ?? "",
  };
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
  const latestUpload = uploads[0];
  const dataset = datasets[0];
  const mapRecord = records.find(item => item.SK?.S === "MAP#primary");
  const share = records.find(item => item.SK?.S === "SHARE#primary");
  const datasetId = dataset?.SK?.S?.startsWith("DATASET#") ? dataset.SK.S.slice(8) : null;
  const mapId = profile.mapId?.S ?? mapRecord?.mapId?.S ?? null;
  const mapUrl = mapId ? `/m/${mapId}` : null;
  const access = profile.status?.S ?? "pending";
  const uploadStatus = latestUpload?.status?.S ?? null;
  const phase = access !== "approved" ? `access:${access}` : dataset ? "ready" : uploadStatus ?? "approved";
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
    publishedUrl: null,
    mapUrl,
    publishedViews: Number(mapRecord?.viewCount?.N ?? 0),
    savedViews: share ? 1 : 0,
  };
}

async function listAdminUsers() {
  const profiles = (await Promise.all(["pending", "approved", "rejected"].map(profilesForStatus))).flat();
  const users = await Promise.all(profiles.map(async profile => {
    const subject = profile.PK.S.slice(5);
    const mapId = await ensureMapForSubject(subject, profile);
    if (mapId) profile.mapId = { S: mapId };
    return adminUser(profile, await userPartition(subject));
  }));
  users.sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
  return users;
}

function datasetFiles(manifest) {
  return [
    ...(manifest.shards ?? []),
    ...(manifest.metadata ?? []),
    ...(manifest.render_levels ?? []).flatMap(level => level.files ?? []),
  ];
}

async function signedDataset(datasetId) {
  const key = `datasets/${datasetId}/dataset.json`;
  const object = await s3.send(new GetObjectCommand({ Bucket: dataBucket, Key: key }));
  const manifest = JSON.parse(await object.Body.transformToString());
  await Promise.all(datasetFiles(manifest).map(async file => {
    if (typeof file.path !== "string" || file.path.startsWith("/") || file.path.split("/").includes("..")) throw new Error("invalid dataset file path");
    file.url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: dataBucket, Key: `datasets/${datasetId}/${file.path}` }), { expiresIn: 21_600 });
  }));
  return { datasetId, manifest };
}

async function queueUpload(uploadKey, upload, targetSubject, expectedStatus) {
  const id = uploadKey.SK.S.slice(7);
  const now = new Date().toISOString();
  await dynamo.send(new UpdateItemCommand({
    TableName: tableName,
    Key: uploadKey,
    ConditionExpression: "#status = :expected",
    UpdateExpression: "SET #status = :submitting, statusDetail = :detail, updatedAt = :now",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: {
      ":expected": { S: expectedStatus },
      ":submitting": { S: "submitting" },
      ":detail": { S: "Submitting compile job." },
      ":now": { S: now },
    },
  }));
  let submitted;
  try {
    submitted = await batch.send(new SubmitJobCommand({ jobName: `ingest-${id}`, jobQueue, jobDefinition, containerOverrides: { environment: [
      { name: "TABLE_NAME", value: tableName }, { name: "SOURCE_BUCKET", value: uploadBucket }, { name: "SOURCE_KEY", value: upload.objectKey.S },
      { name: "DATA_BUCKET", value: dataBucket }, { name: "USER_SUB", value: targetSubject }, { name: "UPLOAD_ID", value: id },
    ] } }));
  } catch (error) {
    await dynamo.send(new UpdateItemCommand({
      TableName: tableName,
      Key: uploadKey,
      ConditionExpression: "#status = :submitting",
      UpdateExpression: "SET #status = :expected, statusDetail = :detail, updatedAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":submitting": { S: "submitting" },
        ":expected": { S: expectedStatus },
        ":detail": { S: "Compile job submission failed. Retry is safe." },
        ":now": { S: new Date().toISOString() },
      },
    }));
    throw error;
  }
  await dynamo.send(new UpdateItemCommand({ TableName: tableName, Key: uploadKey, ConditionExpression: "#status = :submitting", UpdateExpression: "SET #status = :queued, batchJobId = :job, statusDetail = :detail, updatedAt = :now", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":submitting": { S: "submitting" }, ":queued": { S: "queued" }, ":job": { S: submitted.jobId }, ":detail": { S: "Compile job queued." }, ":now": { S: new Date().toISOString() } } }));
  return { id, status: "queued" };
}

const recompileStatuses = new Set(["failed", "ready", "completed"]);

export async function handler(event) {
  const route = event.routeKey;
  if (route === "GET /api/published/{slug}") {
    const reference = event.pathParameters?.slug;
    if (!tableName) return response(404, { error: "map_not_found" });
    const context = await mapContext(reference);
    if (!context) return response(404, { error: "map_not_found" });
    if (context.mapRecord) await dynamo.send(new UpdateItemCommand({ TableName: tableName, Key: { PK: context.mapRecord.PK, SK: context.mapRecord.SK }, UpdateExpression: "ADD viewCount :one", ExpressionAttributeValues: { ":one": { N: "1" } } }));
    const tabs = context.share?.tabsJson?.S ? JSON.parse(context.share.tabsJson.S) : [];
    const active = context.share?.activeTab?.S ?? null;
    const updatedAt = context.share?.updatedAt?.S ?? context.mapRecord?.updatedAt?.S ?? context.profile.updatedAt?.S ?? "";
    return response(200, {
      ...(context.share?.slug?.S ? { slug: context.share.slug.S } : {}),
      mapId: context.mapId,
      url: `/m/${context.mapId}`,
      tabs,
      active,
      datasetId: context.datasetId,
      updatedAt,
      identity: mapIdentity(context.profile, context.mapId, "viewer"),
    });
  }

  if (route === "GET /api/published/{slug}/dataset-access") {
    if (!tableName || !dataBucket) return response(404, { error: "map_not_found" });
    const context = await mapContext(event.pathParameters?.slug);
    if (!context?.datasetId) return response(404, { error: "map_dataset_not_found" });
    return response(200, await signedDataset(context.datasetId));
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
          mapId: { S: randomUUID() },
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
    const needsIdentity = (!existing.Item.email?.S && verifiedEmail) || (!existing.Item.name?.S && verifiedName) || (!existing.Item.picture?.S && verifiedPicture);
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
  const currentMapId = await ensureMapForSubject(subject, current);
  if (currentMapId) current.mapId = { S: currentMapId };
  const isAdmin = current?.role?.S === "admin" && current?.status?.S === "approved";

  if (route === "GET /api/datasets/{id}/access") {
    const id = event.pathParameters?.id;
    if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return response(404, { error: "map_not_found" });
    const context = await mapContext(id);
    if (!context?.datasetId) return response(404, { error: "map_not_found" });
    const isOwner = context.ownerSubject === subject;
    if (!isOwner && !isAdmin) return response(403, { error: "map_access_denied" });
    return response(200, { ...await signedDataset(context.datasetId), identity: mapIdentity(context.profile, context.mapId, isOwner ? "owner" : "admin") });
  }

  if (route === "GET /api/recent-maps") {
    const records = await userPartition(subject);
    const recents = records.filter(item => item.entityType?.S === "recentMap").sort((a, b) => (b.updatedAt?.S ?? "").localeCompare(a.updatedAt?.S ?? ""));
    const recentMaps = await Promise.all(recents.slice(0, 8).map(recentMapView));
    return response(200, { myMap: ownMap(records, current), recentMaps });
  }

  if (route === "POST /api/recent-maps") {
    const body = JSON.parse(event.body ?? "{}");
    const reference = typeof body.mapId === "string" && /^[0-9a-f-]{36}$/i.test(body.mapId) ? body.mapId : String(body.slug ?? "");
    const context = await mapContext(reference);
    if (!context) return response(404, { error: "map_not_found" });
    if (context.ownerSubject === subject) return response(200, { saved: false });
    const now = new Date().toISOString();
    const recentKey = { PK: key.PK, SK: { S: `RECENT#${context.mapId}` } };
    await dynamo.send(new PutItemCommand({ TableName: tableName, Item: {
      ...recentKey,
      entityType: { S: "recentMap" },
      mapId: { S: context.mapId },
      ownerSubject: { S: context.ownerSubject },
      url: { S: `/m/${context.mapId}` },
      createdAt: { S: now },
      updatedAt: { S: now },
    } }));
    const records = (await userPartition(subject)).filter(item => item.entityType?.S === "recentMap").sort((a, b) => (b.updatedAt?.S ?? "").localeCompare(a.updatedAt?.S ?? ""));
    await Promise.all(records.slice(12).map(item => dynamo.send(new DeleteItemCommand({ TableName: tableName, Key: { PK: item.PK, SK: item.SK } }))));
    return response(200, { saved: true });
  }

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
    await ensureMapForSubject(target, targetProfile);
    return response(200, { subject: target, status });
  }

  if (route === "POST /api/admin/uploads/{id}/retry") {
    if (!isAdmin) return response(403, { error: "admin_required" });
    const id = event.pathParameters?.id;
    const body = JSON.parse(event.body ?? "{}");
    const target = body.subject;
    if (!/^[0-9a-f-]{36}$/i.test(id ?? "") || !/^[0-9a-f-]{16,64}$/i.test(target ?? "")) return response(400, { error: "invalid_recompile" });
    const uploadKey = { PK: { S: `USER#${target}` }, SK: { S: `UPLOAD#${id}` } };
    const upload = (await dynamo.send(new GetItemCommand({ TableName: tableName, Key: uploadKey, ConsistentRead: true }))).Item;
    if (!upload) return response(404, { error: "upload_not_found" });
    if (!recompileStatuses.has(upload.status?.S)) return response(409, { error: "upload_not_recompilable" });
    const object = await s3.send(new HeadObjectCommand({ Bucket: uploadBucket, Key: upload.objectKey.S }));
    if (object.ContentLength !== Number(upload.byteSize.N)) return response(422, { error: "upload_verification_failed" });
    return response(200, await queueUpload(uploadKey, upload, target, upload.status.S));
  }

  if (route === "POST /api/published") {
    if (current?.status?.S !== "approved") return response(403, { error: "approval_required" });
    const body = JSON.parse(event.body ?? "{}");
    const tabsJson = JSON.stringify(body.tabs ?? []);
    if (!Array.isArray(body.tabs) || body.tabs.length < 1 || body.tabs.length > 50 || tabsJson.length > 100_000 || !body.tabs.every(tab => typeof tab?.id === "string" && typeof tab?.title === "string" && typeof tab?.sql === "string") || typeof body.active !== "string") return response(400, { error: "invalid_saved_view" });
    const requestedDatasetId = typeof body.datasetId === "string" && /^[0-9a-f-]{36}$/i.test(body.datasetId) ? body.datasetId : null;
    if (requestedDatasetId) {
      const owned = (await dynamo.send(new GetItemCommand({ TableName: tableName, Key: { PK: key.PK, SK: { S: `DATASET#${requestedDatasetId}` } }, ConsistentRead: true }))).Item;
      if (!owned || owned.status?.S !== "ready") return response(403, { error: "dataset_access_denied" });
    }
    const shareKey = { PK: key.PK, SK: { S: "SHARE#primary" } };
    const prior = (await dynamo.send(new GetItemCommand({ TableName: tableName, Key: shareKey, ConsistentRead: true }))).Item;
    const slug = prior?.slug?.S ?? randomUUID().replaceAll("-", "").slice(0, 8);
    const now = new Date().toISOString();
    const records = await userPartition(subject);
    const latest = latestReadyDataset(records);
    const datasetId = latest?.datasetId?.S ?? latest?.SK?.S?.slice(8) ?? requestedDatasetId;
    await dynamo.send(new PutItemCommand({ TableName: tableName, Item: { ...shareKey, entityType: { S: "share" }, slug: { S: slug }, mapId: { S: currentMapId }, tabsJson: { S: tabsJson }, activeTab: { S: body.active }, ...(datasetId ? { datasetId: { S: datasetId } } : {}), viewCount: prior?.viewCount ?? { N: "0" }, createdAt: prior?.createdAt ?? { S: now }, updatedAt: { S: now }, GSI1PK: { S: `PUBLISHED#${slug}` }, GSI1SK: { S: "VIEW" } } }));
    return response(200, { slug, mapId: currentMapId, url: `/m/${currentMapId}` });
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
    return response(200, await queueUpload(uploadKey, upload, subject, "pending"));
  }

  if (route === "GET /api/uploads") {
    const result = await dynamo.send(new QueryCommand({ TableName: tableName, KeyConditionExpression: "PK = :pk AND begins_with(SK, :upload)", ExpressionAttributeValues: { ":pk": key.PK, ":upload": { S: "UPLOAD#" } }, ScanIndexForward: false }));
    return response(200, { uploads: await Promise.all((result.Items ?? []).map(uploadView)) });
  }

  const records = await userPartition(subject);
  const uploads = records.filter(item => item.entityType?.S === "upload").sort((a, b) => (b.updatedAt?.S ?? b.createdAt?.S ?? "").localeCompare(a.updatedAt?.S ?? a.createdAt?.S ?? ""));
  const latestUpload = uploads[0];
  const latestCompile = latestUpload ? await uploadView(latestUpload) : null;
  const mapRecord = records.find(item => item.SK?.S === "MAP#primary");
  const savedView = records.find(item => item.SK?.S === "SHARE#primary");
  return response(200, {
    subject,
    mapId: currentMapId,
    mapUrl: `/m/${currentMapId}`,
    email: current?.email?.S ?? verifiedEmail,
    name: current?.name?.S ?? verifiedName,
    picture: current?.picture?.S ?? verifiedPicture,
    status: current?.status?.S ?? "pending",
    role: current?.role?.S ?? "user",
    compile: latestCompile ? {
      filename: latestCompile.filename,
      status: latestCompile.status,
      statusDetail: latestCompile.statusDetail,
      progressCompleted: latestCompile.progressCompleted,
      progressTotal: latestCompile.progressTotal,
    } : null,
    stats: {
      uploadedBytes: records.filter(item => item.entityType?.S === "upload").reduce((total, item) => total + Number(item.byteSize?.N ?? 0), 0),
      activityCount: records.filter(item => item.entityType?.S === "dataset").reduce((total, item) => total + Number(item.activityCount?.N ?? 0), 0),
      curatedBytes: records.filter(item => item.entityType?.S === "dataset").reduce((total, item) => total + Number(item.byteSize?.N ?? 0), 0),
      datasetCount: records.filter(item => item.entityType?.S === "dataset").length,
      publishedViews: Number(mapRecord?.viewCount?.N ?? 0),
      publishedMaps: savedView ? 1 : 0,
    },
  });
}
