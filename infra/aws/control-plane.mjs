import { AdminGetUserCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";

const dynamo = new DynamoDBClient({});
const cognito = new CognitoIdentityProviderClient({});
const tableName = process.env.METADATA_TABLE_NAME;
const userPoolId = process.env.USER_POOL_ID;

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
  const username = claims?.username;
  if (!subject || !username || !tableName || !userPoolId) return response(401, { error: "unauthorized" });

  const cognitoUser = await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }));
  const attributes = Object.fromEntries((cognitoUser.UserAttributes ?? []).map(attribute => [attribute.Name, attribute.Value ?? ""]));
  const verifiedEmail = attributes.email_verified === "true" ? attributes.email ?? "" : "";
  const verifiedName = attributes.name ?? "";
  const verifiedPicture = attributes.picture ?? "";

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
          email: { S: verifiedEmail },
          name: { S: verifiedName },
          picture: { S: verifiedPicture },
          createdAt: { S: now },
          updatedAt: { S: now },
          GSI1PK: { S: "USER_STATUS#pending" },
          GSI1SK: { S: now },
        },
      }));
    } catch (error) {
      if (error?.name !== "ConditionalCheckFailedException") throw error;
    }
  } else if ((!existing.Item.email?.S && verifiedEmail) || (!existing.Item.name?.S && verifiedName)) {
    await dynamo.send(new UpdateItemCommand({
      TableName: tableName,
      Key: key,
      UpdateExpression: "SET email = :email, #name = :name, picture = :picture, updatedAt = :updated",
      ExpressionAttributeNames: { "#name": "name" },
      ExpressionAttributeValues: {
        ":email": { S: verifiedEmail }, ":name": { S: verifiedName }, ":picture": { S: verifiedPicture },
        ":updated": { S: new Date().toISOString() },
      },
    }));
  }

  const current = (await dynamo.send(new GetItemCommand({ TableName: tableName, Key: key, ConsistentRead: true }))).Item;
  return response(200, {
    subject,
    email: current?.email?.S ?? verifiedEmail,
    name: current?.name?.S ?? verifiedName,
    picture: current?.picture?.S ?? verifiedPicture,
    status: current?.status?.S ?? "pending",
    role: current?.role?.S ?? "user",
  });
}
