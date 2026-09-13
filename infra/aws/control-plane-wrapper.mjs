import { DeleteItemCommand, DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { randomBytes } from "node:crypto";

import { handler as controlPlaneHandler } from "./control-plane.mjs";
import { sendLifecycleEmail } from "./lifecycle-email.mjs";

const dynamo = new DynamoDBClient({});
const tableName = process.env.METADATA_TABLE_NAME;
const publicMapPattern = /^[a-z0-9]{8}$/;
const internalMapPattern = /^[0-9a-f-]{36}$/i;

function profileKey(subject) {
  return { PK: { S: `USER#${subject}` }, SK: { S: "PROFILE" } };
}

function publicMapKey(publicMapId) {
  return { PK: { S: `PUBLIC_MAP#${publicMapId}` }, SK: { S: "META" } };
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

async function ensurePublicMapId(subject, suppliedProfile = null) {
  if (!tableName || !subject) return null;
  const profile = suppliedProfile ?? await getProfile(subject);
  const internalMapId = profile?.mapId?.S;
  if (!internalMapPattern.test(internalMapId ?? "")) return null;

  const existing = profile?.publicMapId?.S;
  if (publicMapPattern.test(existing ?? "")) {
    const registry = (await dynamo.send(new GetItemCommand({ TableName: tableName, Key: publicMapKey(existing), ConsistentRead: true }))).Item;
    if (!registry || registry.ownerSubject?.S === subject) {
      if (!registry) {
        await dynamo.send(new PutItemCommand({
          TableName: tableName,
          Item: {
            ...publicMapKey(existing),
            entityType: { S: "publicMap" },
            publicMapId: { S: existing },
            internalMapId: { S: internalMapId },
            ownerSubject: { S: subject },
            createdAt: { S: new Date().toISOString() },
          },
        }));
      }
      return existing;
    }
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const publicMapId = randomBytes(4).toString("hex");
    const now = new Date().toISOString();
    try {
      await dynamo.send(new PutItemCommand({
        TableName: tableName,
        ConditionExpression: "attribute_not_exists(PK)",
        Item: {
          ...publicMapKey(publicMapId),
          entityType: { S: "publicMap" },
          publicMapId: { S: publicMapId },
          internalMapId: { S: internalMapId },
          ownerSubject: { S: subject },
          createdAt: { S: now },
        },
      }));
      await dynamo.send(new UpdateItemCommand({
        TableName: tableName,
        Key: profileKey(subject),
        UpdateExpression: "SET publicMapId = :publicMapId, updatedAt = :now",
        ExpressionAttributeValues: { ":publicMapId": { S: publicMapId }, ":now": { S: now } },
      }));
      profile.publicMapId = { S: publicMapId };
      return publicMapId;
    } catch (error) {
      if (error?.name !== "ConditionalCheckFailedException") throw error;
    }
  }
  throw new Error("could not allocate public map id");
}

async function mapReference(reference) {
  if (!tableName) return null;
  if (publicMapPattern.test(reference ?? "")) {
    const record = (await dynamo.send(new GetItemCommand({ TableName: tableName, Key: publicMapKey(reference), ConsistentRead: true }))).Item;
    if (!record?.internalMapId?.S || !record?.ownerSubject?.S) return null;
    return { mapId: record.internalMapId.S, publicMapId: reference, ownerSubject: record.ownerSubject.S };
  }
  if (internalMapPattern.test(reference ?? "")) {
    const found = await dynamo.send(new QueryCommand({
      TableName: tableName,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": { S: `MAP#${reference}` } },
      Limit: 1,
    }));
    const record = found.Items?.[0];
    if (!record) return null;
    const ownerSubject = record.ownerSubject?.S ?? record.PK?.S?.slice(5) ?? "";
    if (!ownerSubject) return null;
    const profile = await getProfile(ownerSubject);
    const publicMapId = await ensurePublicMapId(ownerSubject, profile);
    return publicMapId ? { mapId: reference, publicMapId, ownerSubject } : null;
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
  const reference = typeof body.mapId === "string" ? body.mapId : "";
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
    publicMapId: { S: context.publicMapId },
    ownerSubject: { S: context.ownerSubject },
    url: { S: `/p/${context.publicMapId}` },
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
    const ownerSubject = item.ownerSubject?.S;
    const ownerProfile = await getProfile(ownerSubject);
    const publicMapId = ownerSubject ? await ensurePublicMapId(ownerSubject, ownerProfile) : null;
    if (!publicMapId) return null;
    return {
      ...mapIdentity(ownerProfile, publicMapId),
      url: `/p/${publicMapId}`,
      lastViewedAt: item.updatedAt?.S ?? item.createdAt?.S ?? "",
    };
  }))).filter(Boolean);
  const publicMapId = await ensurePublicMapId(subject, profile);
  return {
    ...baseResult,
    body: JSON.stringify({
      myMap: publicMapId ? { ...mapIdentity(profile, publicMapId, "owner"), url: `/p/${publicMapId}` } : null,
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

function rewriteMapBody(result, publicMapId) {
  if (!publicMapId || result?.statusCode < 200 || result?.statusCode >= 300 || !result?.body) return result;
  try {
    const body = JSON.parse(result.body);
    if (body.mapId !== undefined) body.mapId = publicMapId;
    if (body.mapUrl !== undefined) body.mapUrl = `/p/${publicMapId}`;
    if (body.url !== undefined) body.url = `/p/${publicMapId}`;
    if (body.identity?.mapId !== undefined) body.identity.mapId = publicMapId;
    return { ...result, body: JSON.stringify(body) };
  } catch {
    return result;
  }
}

async function rewriteAdminUsers(result) {
  if (result?.statusCode !== 200 || !result?.body) return result;
  try {
    const body = JSON.parse(result.body);
    if (!Array.isArray(body.users)) return result;
    body.users = await Promise.all(body.users.map(async user => {
      if (!user?.subject) return user;
      const profile = await getProfile(user.subject);
      const publicMapId = await ensurePublicMapId(user.subject, profile);
      return publicMapId ? { ...user, mapUrl: `/p/${publicMapId}` } : user;
    }));
    return { ...result, body: JSON.stringify(body) };
  } catch {
    return result;
  }
}

export async function handler(event) {
  const subject = event.requestContext?.authorizer?.jwt?.claims?.sub;
  const isAccessUpdate = event.routeKey === "POST /api/published" && event.queryStringParameters?.admin === "access";
  const body = isAccessUpdate ? JSON.parse(event.body ?? "{}") : null;
  const target = typeof body?.subject === "string" ? body.subject : null;
  const originalPathReference = ["GET /api/published/{slug}", "GET /api/published/{slug}/dataset-access"].includes(event.routeKey)
    ? event.pathParameters?.slug
    : event.routeKey === "GET /api/datasets/{id}/access"
      ? event.pathParameters?.id
      : null;

  if (event.routeKey === "POST /api/recent-maps" && subject && tableName) {
    return updateFavorite(event, subject);
  }

  let publicPathMapId = null;
  if (publicMapPattern.test(originalPathReference ?? "")) {
    const reference = await mapReference(originalPathReference);
    if (!reference) return { statusCode: 404, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify({ error: "map_not_found" }) };
    publicPathMapId = reference.publicMapId;
    event.pathParameters = { ...event.pathParameters };
    if (event.routeKey === "GET /api/datasets/{id}/access") event.pathParameters.id = reference.mapId;
    else event.pathParameters.slug = reference.mapId;
  }

  const repairReference = event.routeKey === "GET /api/datasets/{id}/access" ? event.pathParameters?.id : event.pathParameters?.slug;
  if (["GET /api/published/{slug}", "GET /api/published/{slug}/dataset-access", "GET /api/datasets/{id}/access"].includes(event.routeKey)) {
    await repairLegacyDataset(repairReference);
  }

  const beforeOwnProfile = subject ? await getProfile(subject) : null;
  const beforeTargetProfile = target ? await getProfile(target) : null;
  let result = await controlPlaneHandler(event);

  if (event.routeKey === "GET /api/recent-maps" && subject) {
    result = await expandedFavorites(subject, result);
  } else if (event.routeKey === "GET /api/me" && event.queryStringParameters?.admin === "users" && subject) {
    result = await rewriteAdminUsers(result);
  } else if (event.routeKey === "GET /api/me" && subject) {
    const profile = await getProfile(subject);
    result = rewriteMapBody(result, await ensurePublicMapId(subject, profile));
  } else if (event.routeKey === "POST /api/published" && !isAccessUpdate && subject) {
    const profile = await getProfile(subject);
    result = rewriteMapBody(result, await ensurePublicMapId(subject, profile));
  } else if (publicPathMapId) {
    result = rewriteMapBody(result, publicPathMapId);
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

    if (event.routeKey === "DELETE /api/me" && beforeOwnProfile?.publicMapId?.S) {
      await dynamo.send(new DeleteItemCommand({ TableName: tableName, Key: publicMapKey(beforeOwnProfile.publicMapId.S) })).catch(() => undefined);
    }
  }

  return result;
}