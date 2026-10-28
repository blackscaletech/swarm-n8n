# Changelog

## 0.1.1 (2026-10-27)

Initial npm release. The isolated HTTPS acceptance peer uses the fixture owner's
UID/GID on Linux and macOS, with container-local nonprivileged port binding and
failure diagnostics. Runtime actions and credential boundaries are unchanged.

## 0.1.0 (Source Candidate, Not Published)

Initial release with 31 curated actions, native n8n AI tool support,
scoped credentials, read-only defaults, explicit write consent, bounded requests,
cursor output and stable write idempotency keys.

Qualified in native n8n 2.45.4 with its matching peer. Includes workflow
cancellation, an absolute request deadline, response and input bounds, official
source/package scanning, and a manual provenance release workflow with a scoped,
expiring upstream dependency review and unfiltered audit reporting. New or
unreviewed advisories block release. No Swarm server or existing plugin changes
are required.

The release workflow consumes the exact native-tested tarball and verifies its
checksum before publication. Task ID lists reject non-string inputs before
conversion or allocation.

Response fields can be raw, simplified or explicitly selected through one shared
filter. Identifiers, trust notices, item links and page cursors are preserved;
raw output remains the default. The audit gate rejects stale success receipts
after failures and executes correctly through symlinked checkout paths.
List responses emit individual records with explicit input-item links, including
empty and uneven multi-item results.

Credential authentication dispatches the exact validated URL with one canonical
Authorization header. Timestamp validation checks real calendar dates while
preserving valid precision and offsets. Failed native qualification removes
stale exports and cleans local secrets even when Docker cleanup fails; only the
exact reviewed package version can be published by the workflow.

Task dependency lists expose bounded cursor pagination so workflows can read
every page. Context packs require a query or objective before sending, and saved
memory output shapes use the service's supported choices.
