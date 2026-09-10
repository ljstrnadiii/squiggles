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
const accountId = aws.getCallerIdentityOutput().accountId;
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
      "cognito-identity:TagResource",
      "cognito-identity:UntagResource",
      "cognito-identity:UpdateIdentityPool",
    ],
    resources: ["*"],
  }] }).json,
});

const lifecycleEmailIdentityArn = pulumi.interpolate`arn:aws:ses:${region}:${accountId}:identity/${domainName}`;
const lifecycleEmailPolicy = aws.iam.getPolicyDocumentOutput({ statements: [{
  effect: "Allow",
  actions: ["ses:SendEmail"],
  resources: [lifecycleEmailIdentityArn],
}] }).json;

function existingRole(namePrefix: string): pulumi.Output<string> {
  const roles = aws.iam.getRolesOutput({ nameRegex: `^${namePrefix}-[A-Za-z0-9]+$` });
  return roles.names.apply(names => {
    if (names.length !== 1) throw new Error(`Expected one ${namePrefix} role, found ${names.length}`);
    return names[0];
  });
}

new aws.iam.RolePolicy("control-plane-lifecycle-email", {
  role: existingRole("control-plane-api"),
  policy: lifecycleEmailPolicy,
});
new aws.iam.RolePolicy("ingest-lifecycle-email", {
  role: existingRole("ingest-task"),
  policy: lifecycleEmailPolicy,
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
  // RUM already retains telemetry; avoid duplicating it into CloudWatch Logs,
  // which requires a separate log-delivery permission surface and adds cost.
  cwLogEnabled: false,
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
