import { DeleteItemCommand, DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";

import { handler as controlPlaneHandler } from "./control-plane.mjs";
import { sendLifecycleEmail } from "./lifecycle-email.mjs";

const dynamo = new DynamoDBClient({});
const tableName = process.env.METADATA_TABLE_NAME;

function profileKey(subject) {
  return { PK: { S: `USER#${subject}` }, SK: { S: "PROFILE" } };
}

async function getProfile(subject) {
  if (!tableName || !subject) return null;
  return (await dynamo.send(new GetItemCommand({ TableName: tableName, Key: profileKey(subject), ConsistentRead: true }))).Item ?? null;
}

async function userPartition(subject) {
  const items = [];
  let cursor;
  do {
    const page = await dynamo.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": { S: `USER#${subject}` } },
      ExclusiveStartKey: cursor,
    }));
    items.push(...(page.Items ?? []));
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return items;
}

async function mapReference(reference) {
  if (!tableName) return null;
  if (/^[0-9a-f-]{36}$/i.test(reference ?? "")) {
    const found = await dynamo.send(new QueryCommand({
      TableName: tableName,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": { S: `MAP#${reference}` } },
      Limit: 1,
    }));
    const record = found.Items?.[0];
    if (!record) return null;
    return { mapId: reference, ownerSubject: record.ownerSubject?.S ?? record.PK?.S?.slice(5) ?? "" };
  }
  if (/^[a-z0-9]{8}$/.test(reference ?? "")) {
    const found = await dynamo.send(new QueryCommand({
      TableName: tableName,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": { S: `PUBLISHED#${reference}` } },
      Limit: 1,
    }));
    const record = found.Items?.[0];
    const ownerSubject = record?.PK?.S?.slice(5) ?? "";
    if (!record || !ownerSubject) return null;
    const profile = await getProfile(ownerSubject);
    const mapId = record.mapId?.S ?? profile?.mapId?.S ?? "";
    return mapId ? { mapId, ownerSubject } : null;
  }
  return null;
}

function mapIdentity(profile, mapId, viewerRole = "viewer") {
  return {
    mapId,
    ownerDisplayName: profile?.name?.S || profile?.email?.S || "Shared map",
    ...(profile?.picture?.S ? { ownerAvatarUrl: profile.picture.S } : {}),
    viewerRole,
  };
}

async function updateFavorite(event, subject) {
  const body = JSON.parse(event.body ?? "{}");
  const reference = typeof body.mapId === "string" && /^[0-9a-f-]{36}$/i.test(body.mapId)
    ? body.mapId
    : String(body.slug ?? "");
  const context = await mapReference(reference);
  if (!context) return { statusCode: 404, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify({ error: "map_not_found" }) };
  if (context.ownerSubject === subject) return { statusCode: 200, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify({ saved: false }) };
  const key = { PK: { S: `USER#${subject}` }, SK: { S: `RECENT#${context.mapId}` } };
  if (body.remove === true) {
    await dynamo.send(new DeleteItemCommand({ TableName: tableName, Key: key }));
    return { statusCode: 200, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify({ saved: false }) };
  }
  const now = new Date().toISOString();
  await dynamo.send(new PutItemCommand({ TableName: tableName, Item: {
    ...key,
    entityType: { S: "recentMap" },
    favorite: { BOOL: true },
    mapId: { S: context.mapId },
    ownerSubject: { S: context.ownerSubject },
    url: { S: `/m/${context.mapId}` },
    createdAt: { S: now },
    updatedAt: { S: now },
  } }));
  return { statusCode: 200, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify({ saved: true }) };
}

async function expandedFavorites(subject, baseResult) {
  if (!tableName || baseResult?.statusCode !== 200) return baseResult;
  const profile = await getProfile(subject);
  const records = await userPartition(subject);
  const favorites = records
    .filter(item => item.entityType?.S === "recentMap" && item.favorite?.BOOL === true)
    .sort((a, b) => (b.updatedAt?.S ?? "").localeCompare(a.updatedAt?.S ?? ""))
    .slice(0, 200);
  const favoriteMaps = (await Promise.all(favorites.map(async item => {
    const ownerProfile = await getProfile(item.ownerSubject?.S);
    const mapId = item.mapId?.S ?? ownerProfile?.mapId?.S ?? "";
    if (!mapId) return null;
    return {
      ...mapIdentity(ownerProfile, mapId),
      url: `/m/${mapId}`,
      lastViewedAt: item.updatedAt?.S ?? item.createdAt?.S ?? "",
    };
  }))).filter(Boolean);
  const mapId = profile?.mapId?.S ?? "";
  return {
    ...baseResult,
    body: JSON.stringify({
      myMap: mapId ? { ...mapIdentity(profile, mapId, "owner"), url: `/m/${mapId}` } : null,
      // Historical JSON key is retained as a wire-compatibility detail; the client presents these as Favorites.
      recentMaps: favoriteMaps,
    }),
  };
}

function datasetTimestamp(dataset, records) {
  const direct = dataset.updatedAt?.S ?? dataset.createdAt?.S;
  if (direct) return direct;
  const datasetId = dataset.datasetId?.S ?? (dataset.SK?.S?.startsWith("DATASET#") ? dataset.SK.S.slice(8) : "");
  const upload = datasetId ? records.find(item => item.SK?.S === `UPLOAD#${datasetId}`) : null;
  return upload?.updatedAt?.S ?? upload?.createdAt?.S ?? "";
}

async function repairLegacyDataset(reference) {
  const context = await mapReference(reference);
  if (!context?.ownerSubject) return;
  const records = await userPartition(context.ownerSubject);
  let ready = records.filter(item => item.entityType?.S === "dataset" && item.status?.S === "ready");
  if (!ready.length) {
    const legacy = records
      .filter(item => item.entityType?.S === "dataset" && (!item.status?.S || item.status?.S === "completed"))
      .sort((a, b) => datasetTimestamp(b, records).localeCompare(datasetTimestamp(a, records)))[0];
    if (legacy?.PK && legacy?.SK) {
      const timestamp = datasetTimestamp(legacy, records) || new Date().toISOString();
      await dynamo.send(new UpdateItemCommand({
        TableName: tableName,
        Key: { PK: legacy.PK, SK: legacy.SK },
        UpdateExpression: "SET #status = :ready, createdAt = if_not_exists(createdAt, :timestamp), updatedAt = if_not_exists(updatedAt, :timestamp)",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":ready": { S: "ready" }, ":timestamp": { S: timestamp } },
      }));
      legacy.status = { S: "ready" };
      legacy.createdAt ??= { S: timestamp };
      legacy.updatedAt ??= { S: timestamp };
      ready = [legacy];
    }
  }

  await Promise.all(ready
    .filter(item => !item.updatedAt?.S || !item.createdAt?.S)
    .map(async item => {
      const timestamp = datasetTimestamp(item, records);
      if (!timestamp || !item.PK || !item.SK) return;
      await dynamo.send(new UpdateItemCommand({
        TableName: tableName,
        Key: { PK: item.PK, SK: item.SK },
        UpdateExpression: "SET createdAt = if_not_exists(createdAt, :timestamp), updatedAt = if_not_exists(updatedAt, :timestamp)",
        ExpressionAttributeValues: { ":timestamp": { S: timestamp } },
      }));
    }));
}

async function safeSend(key, email, stage) {
  try {
    await sendLifecycleEmail({ dynamo, tableName, key, email, stage });
  } catch (error) {
    console.error("lifecycle email failed", { stage, email, error });
  }
}

export async function handler(event) {
  const subject = event.requestContext?.authorizer?.jwt?.claims?.sub;
  const isAccessUpdate = event.routeKey === "POST /api/published" && event.queryStringParameters?.admin === "access";
  const body = isAccessUpdate ? JSON.parse(event.body ?? "{}") : null;
  const target = typeof body?.subject === "string" ? body.subject : null;

  if (event.routeKey === "POST /api/recent-maps" && subject && tableName) {
    return updateFavorite(event, subject);
  }

  if (["GET /api/published/{slug}", "GET /api/published/{slug}/dataset-access"].includes(event.routeKey)) {
    await repairLegacyDataset(event.pathParameters?.slug);
  } else if (event.routeKey === "GET /api/datasets/{id}/access") {
    await repairLegacyDataset(event.pathParameters?.id);
  }

  const beforeOwnProfile = subject ? await getProfile(subject) : null;
  const beforeTargetProfile = target ? await getProfile(target) : null;
  let result = await controlPlaneHandler(event);

  if (event.routeKey === "GET /api/recent-maps" && subject) {
    result = await expandedFavorites(subject, result);
  }

  if (result?.statusCode >= 200 && result.statusCode < 300) {
    if (subject && !beforeOwnProfile) {
      const created = await getProfile(subject);
      if (created?.status?.S === "pending" && created?.role?.S !== "admin" && created?.email?.S) {
        await safeSend(profileKey(subject), created.email.S, "requested");
      }
    }

    if (target && body?.status === "approved" && beforeTargetProfile?.status?.S !== "approved") {
      const approved = await getProfile(target);
      if (approved?.status?.S === "approved" && approved?.email?.S) {
        await safeSend(profileKey(target), approved.email.S, "approved");
      }
    }
  }

  return result;
}
