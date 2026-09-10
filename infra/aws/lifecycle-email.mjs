import { UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createHash, createHmac } from "node:crypto";

const STAGES = {
  requested: {
    marker: "accessRequestedEmailSentAt",
    subject: "Squiggles access requested",
    body: [
      "We received your request for access to Squiggles. An administrator will review it and you’ll receive another email if you’re approved.",
      "",
      "Squiggles sends only three lifecycle emails: this request confirmation, access approval, and archive optimization completion. We do not send marketing or engagement email.",
    ].join("\n"),
  },
  approved: {
    marker: "accessApprovedEmailSentAt",
    subject: "You’re approved for Squiggles",
    body: [
      "Your Squiggles access has been approved. You can now sign in and upload your activity archive.",
      "",
      "Squiggles sends only the three lifecycle emails described when you requested access. The only remaining automated email is when your archive has finished optimizing.",
    ].join("\n"),
  },
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key, value, encoding) {
  return createHmac("sha256", key).update(value).digest(encoding);
}

function signingKey(secret, date, region) {
  const dateKey = hmac(`AWS4${secret}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "ses");
  return hmac(serviceKey, "aws4_request");
}

async function sendSesEmail({ to, subject, body }) {
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.AWS_SESSION_TOKEN;
  const from = process.env.NOTIFICATION_FROM_EMAIL ?? "notifications@squiggles.io";
  if (!region || !accessKeyId || !secretAccessKey || !sessionToken) throw new Error("SES signing credentials unavailable");

  const host = `email.${region}.amazonaws.com`;
  const path = "/v2/email/outbound-emails";
  const payload = JSON.stringify({
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    Content: { Simple: { Subject: { Data: subject, Charset: "UTF-8" }, Body: { Text: { Data: body, Charset: "UTF-8" } } } },
  });
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(payload);
  const canonicalHeaders = [
    "content-type:application/json",
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    `x-amz-security-token:${sessionToken}`,
  ].join("\n") + "\n";
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token";
  const canonicalRequest = ["POST", path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${region}/ses/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(secretAccessKey, date, region), stringToSign, "hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(`https://${host}${path}`, {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      "x-amz-security-token": sessionToken,
    },
    body: payload,
  });
  if (!response.ok) throw new Error(`SES SendEmail failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
}

export async function sendLifecycleEmail({ dynamo, tableName, key, email, stage }) {
  const definition = STAGES[stage];
  if (!definition || !email) return false;
  const now = new Date().toISOString();
  try {
    await dynamo.send(new UpdateItemCommand({
      TableName: tableName,
      Key: key,
      ConditionExpression: "attribute_not_exists(#marker)",
      UpdateExpression: "SET #marker = :now",
      ExpressionAttributeNames: { "#marker": definition.marker },
      ExpressionAttributeValues: { ":now": { S: now } },
    }));
  } catch (error) {
    if (error?.name === "ConditionalCheckFailedException") return false;
    throw error;
  }

  try {
    await sendSesEmail({ to: email, subject: definition.subject, body: definition.body });
    return true;
  } catch (error) {
    await dynamo.send(new UpdateItemCommand({
      TableName: tableName,
      Key: key,
      UpdateExpression: "REMOVE #marker",
      ExpressionAttributeNames: { "#marker": definition.marker },
    })).catch(() => undefined);
    throw error;
  }
}
