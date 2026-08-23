# Public naming decision

The selected public identity is **Squiggles** at **squiggles.io**. Treat this as the working assumption for repository, application, infrastructure, authentication callback, and documentation changes until explicitly revised.

## Recommendation

Use **Squiggles** consistently:

```text
Product:    Squiggles
Repository: ljstrnadiii/squiggles
Domain:     squiggles.io
Directory:  squiggles
AWS tags:   squiggles
```

The repository and local directory already use the selected name. Internal `activity-map` package and infrastructure identifiers still need a compatibility-aware rename.

## Registration snapshot — 2026-08-23

The Route 53 Domains availability API reported `squiggles.io` available at $71/year. Availability is not a reservation. Registration is a manual paid action because it requires explicit purchase authorization and registrant contact details.

After registration, import or adopt the automatically created hosted zone into the Pulumi stack before adding records. Pulumi owns the ACM validation records, CloudFront alias records, and subsequent DNS changes; the registrar purchase is a documented bootstrap exception.

## DNS implementation after selection

Prefer Route 53 only if the domain is registered there or delegating DNS to AWS is desirable. Otherwise, keep the registrar's DNS and create the required validation and CloudFront alias records there. A custom CloudFront domain requires an ACM certificate in `us-east-1`; Pulumi should own the certificate, DNS validation records when possible, and distribution alias.
