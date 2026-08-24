import { DynamoDBClient, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";

const dynamo = new DynamoDBClient({});
const tableName = process.env.METADATA_TABLE_NAME;

function response(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

export async function handler(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  const subject = claims?.sub;
  if (!subject || !tableName) return response(401, { error: "unauthorized" });

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
          status: { S: "pending" },
          role: { S: "user" },
          email: { S: String(claims.email ?? "") },
          name: { S: String(claims.name ?? "") },
          picture: { S: String(claims.picture ?? "") },
          createdAt: { S: now },
          updatedAt: { S: now },
          GSI1PK: { S: "USER_STATUS#pending" },
          GSI1SK: { S: now },
        },
      }));
    } catch (error) {
      if (error?.name !== "ConditionalCheckFailedException") throw error;
    }
  }

  const current = existing.Item ?? (await dynamo.send(new GetItemCommand({ TableName: tableName, Key: key, ConsistentRead: true }))).Item;
  return response(200, {
    subject,
    email: current?.email?.S ?? String(claims.email ?? ""),
    name: current?.name?.S ?? String(claims.name ?? ""),
    picture: current?.picture?.S ?? String(claims.picture ?? ""),
    status: current?.status?.S ?? "pending",
    role: current?.role?.S ?? "user",
  });
}
