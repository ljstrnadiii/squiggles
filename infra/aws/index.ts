import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
const protectData = config.getBoolean("protectData") ?? true;
const budgetEmail = config.get("budgetEmail") ?? process.env.SQUIGGLES_BUDGET_EMAIL;
const monthlyBudgetUsd = config.getNumber("monthlyBudgetUsd") ?? 10;
const domainName = config.get("domainName") ?? "squiggles.io";
const defaultDatasetId = config.get("defaultDatasetId") ?? "97d948ec-47c1-435a-add9-65eee580fa49";
const googleClientId = config.get("googleClientId") ?? process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = config.getSecret("googleClientSecret") ?? (process.env.GOOGLE_CLIENT_SECRET ? pulumi.secret(process.env.GOOGLE_CLIENT_SECRET) : undefined);
const ingestImage = process.env.INGEST_IMAGE ?? "public.ecr.aws/docker/library/alpine:3.22";
if (Boolean(googleClientId) !== Boolean(googleClientSecret)) throw new Error("Google federation requires both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET");
if (monthlyBudgetUsd <= 0 || monthlyBudgetUsd > 50) throw new Error("monthlyBudgetUsd must be greater than 0 and no more than 50");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const webDist = path.join(projectRoot, "apps/web/dist");
if (!fs.existsSync(path.join(webDist, "index.html"))) throw new Error("apps/web/dist is missing; run `pnpm build` from the repository root");
const tags = { Project: "squiggles", ManagedBy: "pulumi", Environment: pulumi.getStack() };
const notificationEmail = `notifications@${domainName}`;
const ingestRepository = new aws.ecr.Repository("ingest", { name: "squiggles-ingest", imageScanningConfiguration: { scanOnPush: true }, imageTagMutability: "IMMUTABLE", tags }, { import: "squiggles-ingest", protect: protectData });
new aws.ecr.LifecyclePolicy("ingest", { repository: ingestRepository.name, policy: JSON.stringify({ rules: [{ rulePriority: 1, description: "Keep five ingest images", selection: { tagStatus: "any", countType: "imageCountMoreThan", countNumber: 5 }, action: { type: "expire" } }] }) }, { protect: protectData });

const eastRegion = new aws.Provider("us-east-1", { region: "us-east-1" });
const hostedZone = aws.route53.getZoneOutput({ name: domainName, privateZone: false });
const emailIdentity = new aws.sesv2.EmailIdentity("notifications", { emailIdentity: domainName, tags }, { protect: protectData });
for (let index = 0; index < 3; index += 1) {
  const token = emailIdentity.dkimSigningAttributes.apply(attributes => attributes.tokens[index]);
  new aws.route53.Record(`notifications-dkim-${index}`, {
    zoneId: hostedZone.zoneId,
    name: pulumi.interpolate`${token}._domainkey.${domainName}`,
    type: "CNAME",
    records: [pulumi.interpolate`${token}.dkim.amazonses.com`],
    ttl: 300,
  });
}
if (budgetEmail) new aws.sesv2.EmailIdentity("notification-test-recipient", { emailIdentity: budgetEmail, tags }, { protect: protectData });
const certificate = new aws.acm.Certificate("application", {
  domainName,
  validationMethod: "DNS",
  tags,
}, { provider: eastRegion });
const validationOption = certificate.domainValidationOptions.apply(options => {
  const option = options.find(candidate => candidate.domainName === domainName);
  if (!option) throw new Error(`ACM did not return DNS validation details for ${domainName}`);
  return option;
});
const certificateValidationRecord = new aws.route53.Record("application-certificate-validation", {
  zoneId: hostedZone.zoneId,
  name: validationOption.apply(option => option.resourceRecordName),
  type: validationOption.apply(option => option.resourceRecordType),
  records: [validationOption.apply(option => option.resourceRecordValue)],
  ttl: 60,
  allowOverwrite: true,
});
const certificateValidation = new aws.acm.CertificateValidation("application", {
  certificateArn: certificate.arn,
  validationRecordFqdns: [certificateValidationRecord.fqdn],
}, { provider: eastRegion });

function privateBucket(name: string, protect = false) {
  const bucket = new aws.s3.Bucket(name, { forceDestroy: false, tags }, { protect });
  new aws.s3.BucketOwnershipControls(`${name}-ownership`, { bucket: bucket.id, rule: { objectOwnership: "BucketOwnerEnforced" } }, { protect });
  new aws.s3.BucketPublicAccessBlock(`${name}-public-access`, {
    bucket: bucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  }, { protect });
  new aws.s3.BucketServerSideEncryptionConfiguration(`${name}-encryption`, {
    bucket: bucket.id,
    rules: [{ applyServerSideEncryptionByDefault: { sseAlgorithm: "AES256" }, bucketKeyEnabled: true }],
  }, { protect });
  return bucket;
}

const webBucket = privateBucket("web");
const dataBucket = privateBucket("data", protectData);
const uploadBucket = privateBucket("uploads", protectData);
const ingestedBucket = privateBucket("ingested", protectData);

// Identity and control-plane metadata are intentionally separate from canonical
// activity data. Cognito owns authentication; DynamoDB contains only ownership,
// approval, dataset, and saved-query records.
const userPool = new aws.cognito.UserPool("users", {
  deletionProtection: "ACTIVE",
  autoVerifiedAttributes: ["email"],
  usernameAttributes: ["email"],
  mfaConfiguration: "OFF",
  adminCreateUserConfig: { allowAdminCreateUserOnly: false },
  userAttributeUpdateSettings: { attributesRequireVerificationBeforeUpdates: ["email"] },
  schemas: [
    { name: "email", attributeDataType: "String", mutable: true, required: true },
    { name: "name", attributeDataType: "String", mutable: true, required: false },
    { name: "picture", attributeDataType: "String", mutable: true, required: false },
  ],
  tags,
}, { protect: protectData });

const userPoolDomain = new aws.cognito.UserPoolDomain("login", {
  domain: pulumi.interpolate`squiggles-${pulumi.getStack()}-${aws.getCallerIdentityOutput().accountId}`,
  userPoolId: userPool.id,
  managedLoginVersion: 2,
}, { protect: protectData });

const googleProvider = googleClientId && googleClientSecret ? new aws.cognito.IdentityProvider("google", {
  userPoolId: userPool.id,
  providerName: "Google",
  providerType: "Google",
  providerDetails: {
    client_id: googleClientId,
    client_secret: googleClientSecret,
    authorize_scopes: "profile email openid",
  },
  attributeMapping: {
    email: "email",
    email_verified: "email_verified",
    name: "name",
    picture: "picture",
    username: "sub",
  },
}) : undefined;

const userPoolClient = new aws.cognito.UserPoolClient("browser", {
  userPoolId: userPool.id,
  generateSecret: false,
  allowedOauthFlowsUserPoolClient: true,
  allowedOauthFlows: ["code"],
  allowedOauthScopes: ["openid", "email", "profile"],
  callbackUrls: [`https://${domainName}/auth/callback`, "http://localhost:5173/auth/callback"],
  logoutUrls: [`https://${domainName}/`, "http://localhost:5173/"],
  supportedIdentityProviders: googleProvider ? [googleProvider.providerName] : ["COGNITO"],
  preventUserExistenceErrors: "ENABLED",
  accessTokenValidity: 1,
  idTokenValidity: 1,
  refreshTokenValidity: 30,
  tokenValidityUnits: { accessToken: "hours", idToken: "hours", refreshToken: "days" },
}, googleProvider ? { dependsOn: [googleProvider] } : undefined);

const metadataTable = new aws.dynamodb.Table("control-plane", {
  billingMode: "PAY_PER_REQUEST",
  hashKey: "PK",
  rangeKey: "SK",
  attributes: [
    { name: "PK", type: "S" },
    { name: "SK", type: "S" },
    { name: "GSI1PK", type: "S" },
    { name: "GSI1SK", type: "S" },
  ],
  globalSecondaryIndexes: [{
    name: "GSI1",
    keySchemas: [
      { attributeName: "GSI1PK", keyType: "HASH" },
      { attributeName: "GSI1SK", keyType: "RANGE" },
    ],
    projectionType: "ALL",
  }],
  pointInTimeRecovery: { enabled: true },
  serverSideEncryption: { enabled: true },
  deletionProtectionEnabled: true,
  tags,
}, { protect: protectData });

const batchServiceRole = new aws.iam.Role("batch-service", { assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: "batch.amazonaws.com" }), tags });
new aws.iam.RolePolicyAttachment("batch-service", { role: batchServiceRole.name, policyArn: "arn:aws:iam::aws:policy/service-role/AWSBatchServiceRole" });
const taskExecutionRole = new aws.iam.Role("ingest-execution", { assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: "ecs-tasks.amazonaws.com" }), tags });
new aws.iam.RolePolicyAttachment("ingest-execution", { role: taskExecutionRole.name, policyArn: aws.iam.ManagedPolicy.AmazonECSTaskExecutionRolePolicy });
const ingestTaskRole = new aws.iam.Role("ingest-task", { assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: "ecs-tasks.amazonaws.com" }), tags });
new aws.iam.RolePolicy("ingest-task", { role: ingestTaskRole.id, policy: aws.iam.getPolicyDocumentOutput({ statements: [
  { effect: "Allow", actions: ["s3:GetObject"], resources: [pulumi.interpolate`${uploadBucket.arn}/users/*`] },
  { effect: "Allow", actions: ["s3:PutObject"], resources: [pulumi.interpolate`${ingestedBucket.arn}/datasets/*`] },
  { effect: "Allow", actions: ["dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:PutItem"], resources: [metadataTable.arn] },
  { effect: "Allow", actions: ["ses:SendEmail"], resources: [emailIdentity.arn] },
] }).json });
const ingestLogs = new aws.cloudwatch.LogGroup("ingest", { retentionInDays: 14, tags });
const defaultVpc = aws.ec2.getVpcOutput({ default: true });
const defaultSubnets = aws.ec2.getSubnetsOutput({ filters: [{ name: "vpc-id", values: [defaultVpc.id] }] });
const ingestSecurityGroup = new aws.ec2.SecurityGroup("ingest", { vpcId: defaultVpc.id, ingress: [], egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }], tags });
const ingestCompute = new aws.batch.ComputeEnvironment("ingest", { type: "MANAGED", serviceRole: batchServiceRole.arn, computeResources: { type: "FARGATE", maxVcpus: 8, subnets: defaultSubnets.ids, securityGroupIds: [ingestSecurityGroup.id] }, tags });
const ingestQueue = new aws.batch.JobQueue("ingest", { state: "ENABLED", priority: 1, computeEnvironmentOrders: [{ order: 1, computeEnvironment: ingestCompute.arn }], tags });
const ingestDefinition = new aws.batch.JobDefinition("ingest", { type: "container", platformCapabilities: ["FARGATE"], retryStrategy: { attempts: 1 }, timeout: { attemptDurationSeconds: 14400 }, containerProperties: pulumi.jsonStringify({ image: ingestImage, executionRoleArn: taskExecutionRole.arn, jobRoleArn: ingestTaskRole.arn, environment: [{ name: "FROM_EMAIL", value: notificationEmail }], resourceRequirements: [{ type: "VCPU", value: "8" }, { type: "MEMORY", value: "16384" }], ephemeralStorage: { sizeInGiB: 40 }, networkConfiguration: { assignPublicIp: "ENABLED" }, logConfiguration: { logDriver: "awslogs", options: { "awslogs-group": ingestLogs.name, "awslogs-region": aws.getRegionOutput().name, "awslogs-stream-prefix": "job" } } }), tags });

const controlPlaneRole = new aws.iam.Role("control-plane-api", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: "lambda.amazonaws.com" }),
  tags,
});
new aws.iam.RolePolicyAttachment("control-plane-api-logs", {
  role: controlPlaneRole.name,
  policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
});
new aws.iam.RolePolicy("control-plane-api-data", {
  role: controlPlaneRole.id,
  policy: aws.iam.getPolicyDocumentOutput({ statements: [
    { effect: "Allow", actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query", "dynamodb:BatchWriteItem"], resources: [metadataTable.arn, pulumi.interpolate`${metadataTable.arn}/index/*`] },
    { effect: "Allow", actions: ["cognito-idp:AdminGetUser", "cognito-idp:AdminDeleteUser"], resources: [userPool.arn] },
    { effect: "Allow", actions: ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListMultipartUploadParts", "s3:AbortMultipartUpload"], resources: [pulumi.interpolate`${uploadBucket.arn}/users/*`, pulumi.interpolate`${ingestedBucket.arn}/users/*`] },
    { effect: "Allow", actions: ["s3:ListBucket"], resources: [uploadBucket.arn, ingestedBucket.arn] },
    { effect: "Allow", actions: ["batch:SubmitJob", "batch:TerminateJob"], resources: [ingestQueue.arn, ingestDefinition.arn, "*"] },
  ] }).json,
});
const controlPlaneFunction = new aws.lambda.Function("control-plane-api", {
  role: controlPlaneRole.arn,
  runtime: aws.lambda.Runtime.NodeJS22dX,
  handler: "control-plane.handler",
  code: new pulumi.asset.AssetArchive({ "control-plane.cjs": new pulumi.asset.FileAsset(path.join(path.dirname(fileURLToPath(import.meta.url)), "dist/control-plane.cjs")) }),
  environment: { variables: { METADATA_TABLE_NAME: metadataTable.name, USER_POOL_ID: userPool.id, UPLOAD_BUCKET_NAME: uploadBucket.bucket, DATA_BUCKET_NAME: ingestedBucket.bucket, INGEST_JOB_QUEUE: ingestQueue.arn, INGEST_JOB_DEFINITION: ingestDefinition.arn } },
  memorySize: 256,
  timeout: 10,
  tags,
});
const controlPlaneApi = new aws.apigatewayv2.Api("control-plane", {
  protocolType: "HTTP",
  corsConfiguration: {
    allowOrigins: [`https://${domainName}`, "http://localhost:5173"],
    allowHeaders: ["authorization", "content-type"],
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    maxAge: 3600,
  },
  tags,
});
const controlPlaneAuthorizer = new aws.apigatewayv2.Authorizer("control-plane-jwt", {
  apiId: controlPlaneApi.id,
  authorizerType: "JWT",
  identitySources: ["$request.header.Authorization"],
  jwtConfiguration: {
    audiences: [userPoolClient.id],
    issuer: pulumi.interpolate`https://cognito-idp.${aws.getRegionOutput().name}.amazonaws.com/${userPool.id}`,
  },
});
const controlPlaneIntegration = new aws.apigatewayv2.Integration("control-plane", {
  apiId: controlPlaneApi.id,
  integrationType: "AWS_PROXY",
  integrationUri: controlPlaneFunction.arn,
  payloadFormatVersion: "2.0",
});
new aws.apigatewayv2.Route("me", {
  apiId: controlPlaneApi.id,
  routeKey: "GET /api/me",
  target: pulumi.interpolate`integrations/${controlPlaneIntegration.id}`,
  authorizationType: "JWT",
  authorizerId: controlPlaneAuthorizer.id,
  authorizationScopes: ["openid"],
});
new aws.apigatewayv2.Route("me-delete", {
  apiId: controlPlaneApi.id, routeKey: "DELETE /api/me", target: pulumi.interpolate`integrations/${controlPlaneIntegration.id}`,
  authorizationType: "JWT", authorizerId: controlPlaneAuthorizer.id, authorizationScopes: ["openid"],
});
for (const [name, routeKey] of [["uploads-create", "POST /api/uploads"], ["uploads-part", "POST /api/uploads/{id}/parts"], ["uploads-parts", "GET /api/uploads/{id}/parts"], ["uploads-complete", "POST /api/uploads/{id}/complete"], ["uploads-list", "GET /api/uploads"]] as const) {
  new aws.apigatewayv2.Route(name, { apiId: controlPlaneApi.id, routeKey, target: pulumi.interpolate`integrations/${controlPlaneIntegration.id}`, authorizationType: "JWT", authorizerId: controlPlaneAuthorizer.id, authorizationScopes: ["openid"] });
}
new aws.apigatewayv2.Route("published-save", { apiId: controlPlaneApi.id, routeKey: "POST /api/published", target: pulumi.interpolate`integrations/${controlPlaneIntegration.id}`, authorizationType: "JWT", authorizerId: controlPlaneAuthorizer.id, authorizationScopes: ["openid"] });
new aws.apigatewayv2.Route("published-get", { apiId: controlPlaneApi.id, routeKey: "GET /api/published/{slug}", target: pulumi.interpolate`integrations/${controlPlaneIntegration.id}` });
new aws.apigatewayv2.Stage("control-plane", {
  apiId: controlPlaneApi.id,
  name: "$default",
  autoDeploy: true,
  tags,
});
new aws.lambda.Permission("control-plane-api", {
  action: "lambda:InvokeFunction",
  function: controlPlaneFunction.name,
  principal: "apigateway.amazonaws.com",
  sourceArn: pulumi.interpolate`${controlPlaneApi.executionArn}/*/*`,
});

new aws.s3.BucketVersioning("web-versioning", {
  bucket: webBucket.id,
  versioningConfiguration: { status: "Enabled" },
});

new aws.s3.BucketLifecycleConfiguration("data-lifecycle", {
  bucket: dataBucket.id,
  rules: [{ id: "abort-incomplete-uploads", status: "Enabled", abortIncompleteMultipartUpload: { daysAfterInitiation: 1 } }],
}, { protect: protectData });

new aws.s3.BucketCorsConfiguration("data-cors", {
  bucket: dataBucket.id,
  corsRules: [{
    allowedHeaders: ["*"],
    allowedMethods: ["GET", "HEAD"],
    allowedOrigins: ["*"],
    exposeHeaders: ["Accept-Ranges", "Content-Length", "Content-Range", "ETag"],
    maxAgeSeconds: 3600,
  }],
}, { protect: protectData });

const oac = new aws.cloudfront.OriginAccessControl("private-s3", {
  originAccessControlOriginType: "s3",
  signingBehavior: "always",
  signingProtocol: "sigv4",
});
new aws.s3.BucketLifecycleConfiguration("upload-lifecycle", { bucket: uploadBucket.id, rules: [{ id: "expire-source", status: "Enabled", expiration: { days: 2 }, abortIncompleteMultipartUpload: { daysAfterInitiation: 1 } }] }, { protect: protectData });
new aws.s3.BucketCorsConfiguration("upload-cors", { bucket: uploadBucket.id, corsRules: [{ allowedHeaders: ["content-type", "x-amz-checksum-sha256"], allowedMethods: ["PUT"], allowedOrigins: [`https://${domainName}`, "http://localhost:5173"], exposeHeaders: ["ETag"], maxAgeSeconds: 3600 }] }, { protect: protectData });

const spaRewrite = new aws.cloudfront.Function("spa-rewrite", {
  runtime: "cloudfront-js-2.0",
  publish: true,
  code: `function handler(event) {
  var request = event.request;
  if (request.uri === '/' || (!request.uri.includes('.') && !request.uri.startsWith('/datasets/'))) {
    request.uri = '/index.html';
  }
  return request;
}`,
});

const responseHeaders = new aws.cloudfront.ResponseHeadersPolicy("browser-data", {
  customHeadersConfig: { items: [
    { header: "Cross-Origin-Opener-Policy", value: "same-origin", override: true },
    { header: "Cross-Origin-Embedder-Policy", value: "credentialless", override: true },
  ] },
  corsConfig: {
    accessControlAllowCredentials: false,
    accessControlAllowHeaders: { items: ["*"] },
    accessControlAllowMethods: { items: ["GET", "HEAD", "OPTIONS"] },
    accessControlAllowOrigins: { items: ["*"] },
    accessControlExposeHeaders: { items: ["Accept-Ranges", "Content-Length", "Content-Range", "ETag"] },
    accessControlMaxAgeSec: 3600,
    originOverride: true,
  },
  securityHeadersConfig: {
    contentTypeOptions: { override: true },
    frameOptions: { frameOption: "DENY", override: true },
    referrerPolicy: { referrerPolicy: "strict-origin-when-cross-origin", override: true },
    strictTransportSecurity: { accessControlMaxAgeSec: 31536000, includeSubdomains: true, preload: false, override: true },
  },
});

const cachingOptimized = aws.cloudfront.getCachePolicyOutput({ name: "Managed-CachingOptimized" });
const cachingDisabled = aws.cloudfront.getCachePolicyOutput({ name: "Managed-CachingDisabled" });
const distribution = new aws.cloudfront.Distribution("delivery", {
  enabled: true,
  isIpv6Enabled: true,
  defaultRootObject: "index.html",
  priceClass: "PriceClass_100",
  origins: [
    { domainName: dataBucket.bucketRegionalDomainName, originAccessControlId: oac.id, originId: "data", s3OriginConfig: { originAccessIdentity: "" } },
    { domainName: webBucket.bucketRegionalDomainName, originAccessControlId: oac.id, originId: "web", s3OriginConfig: { originAccessIdentity: "" } },
  ],
  defaultCacheBehavior: {
    targetOriginId: "web",
    viewerProtocolPolicy: "redirect-to-https",
    allowedMethods: ["GET", "HEAD", "OPTIONS"],
    cachedMethods: ["GET", "HEAD"],
    cachePolicyId: cachingDisabled.id,
    responseHeadersPolicyId: responseHeaders.id,
    compress: true,
    functionAssociations: [{ eventType: "viewer-request", functionArn: spaRewrite.arn }],
  },
  orderedCacheBehaviors: [
    {
      pathPattern: "/assets/*",
      targetOriginId: "web",
      viewerProtocolPolicy: "redirect-to-https",
      allowedMethods: ["GET", "HEAD", "OPTIONS"],
      cachedMethods: ["GET", "HEAD"],
      cachePolicyId: cachingOptimized.id,
      responseHeadersPolicyId: responseHeaders.id,
      compress: true,
    },
    {
      pathPattern: "/datasets/*",
      targetOriginId: "data",
      viewerProtocolPolicy: "redirect-to-https",
      allowedMethods: ["GET", "HEAD", "OPTIONS"],
      cachedMethods: ["GET", "HEAD", "OPTIONS"],
      cachePolicyId: cachingOptimized.id,
      responseHeadersPolicyId: responseHeaders.id,
      compress: false,
    },
  ],
  restrictions: { geoRestriction: { restrictionType: "none" } },
  aliases: [domainName],
  viewerCertificate: {
    acmCertificateArn: certificateValidation.certificateArn,
    minimumProtocolVersion: "TLSv1.2_2021",
    sslSupportMethod: "sni-only",
  },
  tags,
});

for (const type of ["A", "AAAA"] as const) {
  new aws.route53.Record(`application-${type.toLowerCase()}`, {
    zoneId: hostedZone.zoneId,
    name: domainName,
    type,
    aliases: [{
      name: distribution.domainName,
      zoneId: distribution.hostedZoneId,
      evaluateTargetHealth: false,
    }],
  });
}

function allowCloudFrontRead(name: string, bucket: aws.s3.Bucket, protect = false) {
  const policy = aws.iam.getPolicyDocumentOutput({ statements: [{
    effect: "Allow",
    actions: ["s3:GetObject"],
    resources: [pulumi.interpolate`${bucket.arn}/*`],
    principals: [{ type: "Service", identifiers: ["cloudfront.amazonaws.com"] }],
    conditions: [{ test: "StringEquals", variable: "AWS:SourceArn", values: [distribution.arn] }],
  }] });
  new aws.s3.BucketPolicy(name, { bucket: bucket.id, policy: policy.json }, { protect });
}

allowCloudFrontRead("data-cloudfront-read", dataBucket, protectData);
allowCloudFrontRead("web-cloudfront-read", webBucket);

function filesUnder(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(absolute) : [absolute];
  });
}

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

for (const absolute of filesUnder(webDist)) {
  const key = path.relative(webDist, absolute).split(path.sep).join("/");
  new aws.s3.BucketObject(`web-${key.replaceAll(/[^a-zA-Z0-9-]/g, "-")}`, {
    bucket: webBucket.id,
    key,
    source: new pulumi.asset.FileAsset(absolute),
    contentType: contentTypes[path.extname(key)] ?? "application/octet-stream",
    cacheControl: key === "index.html" ? "no-cache, no-store, must-revalidate" : "public, max-age=31536000, immutable",
  });
}

new aws.s3.BucketObject("web-runtime-config", {
  bucket: webBucket.id,
  key: "runtime-config.json",
  content: pulumi.jsonStringify({
    apiUrl: controlPlaneApi.apiEndpoint,
    cognitoDomain: pulumi.interpolate`https://${userPoolDomain.domain}.auth.${aws.getRegionOutput().name}.amazoncognito.com`,
    cognitoClientId: userPoolClient.id,
    defaultDatasetId,
  }),
  contentType: "application/json; charset=utf-8",
  cacheControl: "no-cache, no-store, must-revalidate",
});

const budget = new aws.budgets.Budget("monthly-development", {
  budgetType: "COST",
  limitAmount: monthlyBudgetUsd.toString(),
  limitUnit: "USD",
  timeUnit: "MONTHLY",
  notifications: budgetEmail ? [10, 50, 80].map(threshold => ({
    comparisonOperator: "GREATER_THAN",
    notificationType: "ACTUAL",
    threshold,
    thresholdType: "PERCENTAGE",
    subscriberEmailAddresses: [budgetEmail],
  })) : [],
  tags,
});

// Bootstrap this identity locally. The deployment role can read IAM state but cannot
// change its own trust or permissions, preventing a workflow from escalating itself.
const githubOidc = new aws.iam.OpenIdConnectProvider("github-actions", {
  url: "https://token.actions.githubusercontent.com",
  clientIdLists: ["sts.amazonaws.com"],
  tags,
});
const deployRole = new aws.iam.Role("github-deploy", {
  assumeRolePolicy: aws.iam.getPolicyDocumentOutput({ statements: [{
    effect: "Allow",
    actions: ["sts:AssumeRoleWithWebIdentity"],
    principals: [{ type: "Federated", identifiers: [githubOidc.arn] }],
    conditions: [
      { test: "StringEquals", variable: "token.actions.githubusercontent.com:aud", values: ["sts.amazonaws.com"] },
      // Repositories created after 2026-07-15 use GitHub's immutable OIDC
      // subject format. Keep both IDs explicit so renames cannot broaden trust.
      { test: "StringEquals", variable: "token.actions.githubusercontent.com:sub", values: ["repo:ljstrnadiii@3171991/squiggles@1344040553:environment:production"] },
    ],
  }] }).json,
  maxSessionDuration: 3600,
  tags,
});
const caller = aws.getCallerIdentityOutput();
const stateBucketArn = pulumi.interpolate`arn:aws:s3:::squiggle-pulumi-state-${caller.accountId}-us-west-2`;
const deployPolicy = aws.iam.getPolicyDocumentOutput({ statements: [
  {
    sid: "PulumiState",
    effect: "Allow",
    actions: ["s3:GetBucketLocation", "s3:GetObject", "s3:ListBucket", "s3:PutObject", "s3:DeleteObject"],
    resources: [stateBucketArn, pulumi.interpolate`${stateBucketArn}/*`],
  },
  {
    sid: "ApplicationBuckets",
    effect: "Allow",
    actions: ["s3:CreateBucket", "s3:Get*", "s3:List*", "s3:Put*", "s3:DeleteObject", "s3:DeleteObjectVersion", "s3:AbortMultipartUpload"],
    resources: [webBucket.arn, pulumi.interpolate`${webBucket.arn}/*`, dataBucket.arn, pulumi.interpolate`${dataBucket.arn}/*`, uploadBucket.arn, pulumi.interpolate`${uploadBucket.arn}/*`, ingestedBucket.arn, pulumi.interpolate`${ingestedBucket.arn}/*`, "arn:aws:s3:::uploads-*", "arn:aws:s3:::ingested-*"],
  },
  {
    sid: "CloudFrontDelivery",
    effect: "Allow",
    actions: ["cloudfront:Get*", "cloudfront:List*", "cloudfront:UpdateDistribution", "cloudfront:CreateInvalidation", "cloudfront:UpdateFunction", "cloudfront:PublishFunction", "cloudfront:UpdateResponseHeadersPolicy", "cloudfront:TagResource", "cloudfront:UntagResource"],
    resources: ["*"],
  },
  {
    sid: "ApplicationDns",
    effect: "Allow",
    actions: ["route53:Get*", "route53:List*", "route53:ChangeResourceRecordSets"],
    resources: ["*"],
  },
  {
    sid: "ReadCertificateBudgetAndBootstrapIdentity",
    effect: "Allow",
    actions: ["acm:AddTagsToCertificate", "acm:DescribeCertificate", "acm:GetCertificate", "acm:ListCertificates", "acm:RemoveTagsFromCertificate", "budgets:ListTagsForResource", "budgets:ModifyBudget", "budgets:ViewBudget", "iam:Get*", "iam:List*"],
    resources: ["*"],
  },
  {
    sid: "IngestImageAndBatch",
    effect: "Allow",
    actions: ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:CompleteLayerUpload", "ecr:DeleteLifecyclePolicy", "ecr:DescribeImages", "ecr:DescribeRepositories", "ecr:GetAuthorizationToken", "ecr:GetDownloadUrlForLayer", "ecr:GetLifecyclePolicy", "ecr:InitiateLayerUpload", "ecr:ListTagsForResource", "ecr:PutImage", "ecr:PutImageScanningConfiguration", "ecr:PutImageTagMutability", "ecr:PutLifecyclePolicy", "ecr:TagResource", "ecr:UntagResource", "ecr:UploadLayerPart", "batch:*", "ec2:AuthorizeSecurityGroupEgress", "ec2:CreateSecurityGroup", "ec2:CreateTags", "ec2:DeleteSecurityGroup", "ec2:Describe*", "ec2:RevokeSecurityGroupEgress"],
    resources: ["*"],
  },
  {
    sid: "ControlPlaneInfrastructure",
    effect: "Allow",
    actions: ["cognito-idp:*", "dynamodb:CreateTable", "dynamodb:DeleteTable", "dynamodb:Describe*", "dynamodb:List*", "dynamodb:TagResource", "dynamodb:UntagResource", "dynamodb:Update*", "apigateway:*", "lambda:AddPermission", "lambda:CreateFunction", "lambda:DeleteFunction", "lambda:Get*", "lambda:List*", "lambda:RemovePermission", "lambda:TagResource", "lambda:UntagResource", "lambda:Update*", "logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:DescribeLogGroups", "logs:ListTagsForResource", "logs:PutRetentionPolicy", "logs:TagResource", "logs:UntagResource", "iam:AttachRolePolicy", "iam:CreateRole", "iam:DeleteRole", "iam:DeleteRolePolicy", "iam:DetachRolePolicy", "iam:PassRole", "iam:PutRolePolicy", "iam:TagRole", "iam:UntagRole", "iam:UpdateAssumeRolePolicy"],
    resources: ["*"],
  },
] });
new aws.iam.RolePolicy("github-deploy", { role: deployRole.id, policy: deployPolicy.json });

export const applicationUrl = pulumi.interpolate`https://${distribution.domainName}`;
export const canonicalApplicationUrl = `https://${domainName}`;
export const datasetBaseUrl = pulumi.interpolate`https://${distribution.domainName}/datasets`;
export const webBucketName = webBucket.bucket;
export const dataBucketName = dataBucket.bucket;
export const distributionId = distribution.id;
export const budgetName = budget.name;
export const githubDeployRoleArn = deployRole.arn;
export const userPoolId = userPool.id;
export const userPoolClientId = userPoolClient.id;
export const loginDomain = pulumi.interpolate`https://${userPoolDomain.domain}.auth.${aws.getRegionOutput().name}.amazoncognito.com`;
export const googleOauthRedirectUrl = pulumi.interpolate`https://${userPoolDomain.domain}.auth.${aws.getRegionOutput().name}.amazoncognito.com/oauth2/idpresponse`;
export const metadataTableName = metadataTable.name;
export const controlPlaneApiUrl = controlPlaneApi.apiEndpoint;
