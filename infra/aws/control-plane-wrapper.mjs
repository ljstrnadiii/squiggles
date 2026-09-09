import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";

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

  const beforeOwnProfile = subject ? await getProfile(subject) : null;
  const beforeTargetProfile = target ? await getProfile(target) : null;
  const result = await controlPlaneHandler(event);

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
