# Releasing

The integration has its own SemVer lifecycle, independent of the private Swarm
service, SDKs and MCP packages. Only reviewed public client files belong here.

1. Use `.node-version` and the npm version in `packageManager`. Run
   `npm ci --ignore-scripts`, `npm run review:dependencies`, `npm run verify`,
   `npm run scan` and `npm run test:integration` on the exact source.
2. Review the packed file list, public examples and the native n8n receipt's
   tarball hash. Acceptance removes the previous same-version exports before
   starting and exports a new tarball/checksum only after tests and fixture
   cleanup succeed. Publish that artifact without repacking; the workflow
   uploads and publishes only the reviewed version and verifies its checksum.
   Confirm the public API contract is still supported. Review the unfiltered
   `.local/dependency-audit.json` and scoped `.local/dependency-review.json`.
   `npm run audit:dependencies` still reports upstream findings with a nonzero
   exit; the approved exposure gate permits only the documented, unexpired
   review. New or changed findings block. Update supported upstream releases
   and requalify; do not use forced overrides, scanner suppressions or toolchain
   downgrades to pass. See [dependency exposure](dependency-exposure.md).
3. Update the version and changelog together. Commit as Blackscale using the
   verified `blackscaletech` GitHub identity and
   `6562904+blackscaletech@users.noreply.github.com` commit email. The public
   contact address remains `hello@blackscale.tech`. Create `v<version>` at that commit.
4. Once the owner approves publication, push the reviewed source and tag to the
   public `blackscaletech/swarm-n8n` repository. No workflow runs on push or tag.
5. Configure an npm trusted publisher for this repository, `release.yml` and the
   `npm` environment. For a new package, npm's authenticated `stage publish` can
   establish ownership without giving a CI runner a reusable token. npm creates
   its public `0.0.0-stage` placeholder; the staged node remains unpublished.
   Configure trusted publishing, reject the local bootstrap stage without
   approving it, then publish the actual release only from the approved GitHub
   workflow with provenance. Do not publish the node locally or create broad
   long-lived tokens. See [npm's staging documentation](https://docs.npmjs.com/staged-publishing/).
6. Only after explicit runner and release approval, manually dispatch
   **Review Or Publish** on that version tag, with the exact version and
   `publish=true`. It requalifies before publishing the verified tarball with npm
   provenance. Use `publish=false` for a review-only run if one is needed; no
   redundant dry run is required after exact-source local qualification.
7. Verify npm version, package integrity and provenance, install that exact
   package in a disposable n8n instance, then prepare the Creator Portal review.

No GitHub Actions runs, npm publication or Creator Portal submission are
authorized by creating these files. The first release requires separate approval.

For rollback, stop workflows that depend on an affected action and reinstall the
previous qualified package version. Revoke a compromised Swarm connection in
Swarm. Do not rewrite published versions or loosen server permissions to fix a
workflow. API, credential and transport changes require a new compatibility review.
