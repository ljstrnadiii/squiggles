import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

import * as app from "./index.ts";
export * from "./index.ts";

const config = new pulumi.Config();
const domainName = config.get("domainName") ?? "squiggles.io";
const stack = pulumi.getStack();
const tags = { Project: "squiggles", ManagedBy: "pulumi", Environment: stack };
const region = aws.getRegionOutput().name;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const webPackage = JSON.parse(fs.readFileSync(path.join(projectRoot, "apps/web/package.json"), "utf8")) as { version?: string };
const appVersion = webPackage.version ?? "0.0.0";
const gitSha = process.env.GITHUB_SHA ?? "local";

// The existing deploy role can manage its own inline policies. Add the narrow
// permissions required to create and maintain RUM's unauthenticated ingestion path.
const telemetryDeployPolicy = new aws.iam.RolePolicy("github-deploy-telemetry", {
  role: app.githubDeployRoleArn.apply(arn => arn.split("/").at(-1)!),
  policy: aws.iam.getPolicyDocumentOutput({ statements: [{
    effect: "Allow",
    actions: [
      "rum:CreateAppMonitor",
      "rum:DeleteAppMonitor",
      "rum:GetAppMonitor",
      "rum:ListTagsForResource",
      "rum:TagResource",
      "rum:UntagResource",
      "rum:UpdateAppMonitor",
      "cognito-identity:CreateIdentityPool",
      "cognito-identity:DeleteIdentityPool",
      "cognito-identity:DescribeIdentityPool",
      "cognito-identity:GetIdentityPoolRoles",
      "cognito-identity:SetIdentityPoolRoles",
      "cognito-identity:UpdateIdentityPool",
      "logs:PutResourcePolicy",
    ],
    resources: ["*"],
  }] }).json,
});

const telemetryIdentityPool = new aws.cognito.IdentityPool("error-telemetry", {
  identityPoolName: `squiggles_${stack}_error_telemetry`,
  allowUnauthenticatedIdentities: true,
  allowClassicFlow: false,
  tags,
}, { dependsOn: [telemetryDeployPolicy] });

const telemetryGuestRole = new aws.iam.Role("error-telemetry-guest", {
  assumeRolePolicy: aws.iam.getPolicyDocumentOutput({ statements: [{
    effect: "Allow",
    actions: ["sts:AssumeRoleWithWebIdentity"],
    principals: [{ type: "Federated", identifiers: ["cognito-identity.amazonaws.com"] }],
    conditions: [
      { test: "StringEquals", variable: "cognito-identity.amazonaws.com:aud", values: [telemetryIdentityPool.id] },
      { test: "ForAnyValue:StringLike", variable: "cognito-identity.amazonaws.com:amr", values: ["unauthenticated"] },
    ],
  }] }).json,
  tags,
});

new aws.cognito.IdentityPoolRoleAttachment("error-telemetry", {
  identityPoolId: telemetryIdentityPool.id,
  roles: { unauthenticated: telemetryGuestRole.arn },
}, { dependsOn: [telemetryDeployPolicy] });

const errorMonitor = new aws.rum.AppMonitor("client-errors", {
  name: `squiggles-${stack}-errors`,
  domain: domainName,
  appMonitorConfiguration: {
    allowCookies: false,
    enableXray: false,
    guestRoleArn: telemetryGuestRole.arn,
    identityPoolId: telemetryIdentityPool.id,
    sessionSampleRate: 1,
    telemetries: ["errors"],
  },
  customEvents: { status: "ENABLED" },
  cwLogEnabled: true,
  tags,
}, { dependsOn: [telemetryDeployPolicy] });

const telemetryGuestPolicy = new aws.iam.RolePolicy("error-telemetry-guest", {
  role: telemetryGuestRole.id,
  policy: aws.iam.getPolicyDocumentOutput({ statements: [{
    effect: "Allow",
    actions: ["rum:PutRumEvents"],
    resources: [errorMonitor.arn],
  }] }).json,
});

new aws.s3.BucketObject("web-error-telemetry-config", {
  bucket: app.webBucketName,
  key: "telemetry-config.json",
  content: pulumi.jsonStringify({
    appMonitorId: errorMonitor.appMonitorId,
    region,
    identityPoolId: telemetryIdentityPool.id,
    appVersion,
    gitSha,
  }),
  contentType: "application/json; charset=utf-8",
  cacheControl: "no-cache, no-store, must-revalidate",
}, { dependsOn: [telemetryGuestPolicy] });

export const errorTelemetryAppMonitorId = errorMonitor.appMonitorId;
export const errorTelemetryIdentityPoolId = telemetryIdentityPool.id;
