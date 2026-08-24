import { AdminGetUserCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { BatchClient, SubmitJobCommand } from "@aws-sdk/client-batch";
import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { CompleteMultipartUploadCommand, CreateMultipartUploadCommand, HeadObjectCommand, ListPartsCommand, S3Client, UploadPartCommand } from "@aws-sdk/client-s3";
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
  if (!subject || !username || !tableName || !userPoolId || !uploadBucket || !dataBucket || !jobQueue || !jobDefinition) return response(401, { error: "unauthorized" });

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
  const route = event.routeKey;
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
    const uploadUrl = await getSignedUrl(s3, new UploadPartCommand({ Bucket: uploadBucket, Key: upload.objectKey.S, UploadId: upload.multipartUploadId.S, PartNumber: body.partNumber, ChecksumSHA256: body.checksumSha256 }), { expiresIn: 900 });
    return response(200, { uploadUrl });
  }
  if (route === "GET /api/uploads/{id}/parts") {
    const id = event.pathParameters?.id; const upload = (await dynamo.send(new GetItemCommand({ TableName: tableName, Key: { PK: key.PK, SK: { S: `UPLOAD#${id}` } }, ConsistentRead: true }))).Item;
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
    return response(200, { uploads: (result.Items ?? []).map(item => ({ id: item.SK.S.slice(7), filename: item.filename.S, byteSize: Number(item.byteSize.N), status: item.status.S, statusDetail: item.statusDetail?.S ?? "", createdAt: item.createdAt.S })) });
  }
  return response(200, {
    subject,
    email: current?.email?.S ?? verifiedEmail,
    name: current?.name?.S ?? verifiedName,
    picture: current?.picture?.S ?? verifiedPicture,
    status: current?.status?.S ?? "pending",
    role: current?.role?.S ?? "user",
  });
}
