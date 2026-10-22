# Security Policy

## Reporting a vulnerability

Please do not report security issues in a public issue, discussion or pull
request.

Report them privately, either through GitHub
([Report a vulnerability](https://github.com/symbiosika/bugreport/security/advisories/new)
in the Security tab) or by mail to **info@symbiosika.de** with "Security" in
the subject.

Include what you found, where (package, file, version or commit) and how to
reproduce it. We confirm receipt within a few working days, keep you informed
while we work on a fix and credit you in the advisory unless you prefer not to
be named.

## Supported versions

Fixes land on `main` and ship in the next release of the affected
`@symbiosika/bugreport-*` packages. Older versions receive no backports;
upgrade to the latest release.

## Scope

The published packages (`packages/*`). The reference example in
`examples/hono-reference` is a copy template for local experiments, not a
production service — issues there are still welcome, but treat it as sample
code.

Things that are in scope and that we care about in particular:

- bypassing `auth`, rate limits or the asset size/count limits of
  `@symbiosika/bugreport-server`
- redaction (`redact.selectors`, `redact.urlParams`) leaking data it should
  have masked when the user shares the current tab
- the client capturing anything outside of an explicit, consented recording
