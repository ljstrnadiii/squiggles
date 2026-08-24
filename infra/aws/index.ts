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
const googleClientId = config.get("googleClientId") ?? process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = config.getSecret("googleClientSecret") ?? (process.env.GOOGLE_CLIENT_SECRET ? pulumi.secret(process.env.GOOGLE_CLIENT_SECRET) : undefined);
if (Boolean(googleClientId) !== Boolean(googleClientSecret)) throw new Error("Google federation requires both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET");
if (monthlyBudgetUsd <= 0 || monthlyBudgetUsd > 50) throw new Error("monthlyBudgetUsd must be greater than 0 and no more than 50");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const webDist = path.join(projectRoot, "apps/web/dist");
if (!fs.existsSync(path.join(webDist, "index.html"))) throw new Error("apps/web/dist is missing; run `pnpm build` from the repository root");
const tags = { Project: "squiggles", ManagedBy: "pulumi", Environment: pulumi.getStack() };

const eastRegion = new aws.Provider("us-east-1", { region: "us-east-1" });
const hostedZone = aws.route53.getZoneOutput({ name: domainName, privateZone: false });
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
    actions: ["s3:Get*", "s3:List*", "s3:Put*", "s3:DeleteObject", "s3:DeleteObjectVersion", "s3:AbortMultipartUpload"],
    resources: [webBucket.arn, pulumi.interpolate`${webBucket.arn}/*`, dataBucket.arn, pulumi.interpolate`${dataBucket.arn}/*`],
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
    sid: "ControlPlaneInfrastructure",
    effect: "Allow",
    actions: ["cognito-idp:*", "dynamodb:CreateTable", "dynamodb:DeleteTable", "dynamodb:Describe*", "dynamodb:List*", "dynamodb:TagResource", "dynamodb:UntagResource", "dynamodb:Update*"],
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
