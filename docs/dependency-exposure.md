# Dependency Exposure Review

Updated November 18, 2026 for version 0.2.0 and the pinned n8n 2.48.5
acceptance host, following the October review. This is not a security
certification of n8n itself. Official CLI/scanner releases and the matching
workflow peer are updated without dependency overrides or scanner suppressions.

## What Ships

The tarball contains the compiled node, credential, static logo, README, license
and package metadata. It has no runtime, optional or bundled dependencies.
Its only external runtime import is the host API, `n8n-workflow`. The package
check parses compiled JavaScript to reject other external imports, computed
imports and relative imports outside the packaged files.

The native n8n installer removes development, peer and optional dependency
declarations before installation. Our acceptance test invokes that actual
installer with the exact local tarball; only the registry download is replaced
because the package is unpublished. It then runs n8n's real npm installation.
Zero dependency modules are added. Functional acceptance uses the host's normal
module resolution, without a manually supplied peer symlink.

Do not infer this from `npm audit --omit=dev` alone: npm can install peers in
other installation contexts. This package is intended for installation in n8n.

## Advisory Classification

The full development audit remains available through `npm run audit:dependencies`.
Affected parent entries often repeat the same root advisory; the count is not a
count of confirmed vulnerabilities in the Swarm node.

| Flagged root        | Audited copy and relevance                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `glob` 11.1.0 | Official CLI cleanup dependency. Its abort behavior remains unpatched upstream in this dependency range. It is used only on the reviewed local source tree during development/release, never by the node or with workflow input. The release workflow also has a job timeout. |
| `minimatch` 10.2.6 | Official CLI/linting dependency. The advisory requires an attacker-controlled glob pattern; workflow data never reaches this tooling. Release tooling runs only against reviewed source and repository-controlled patterns, not arbitrary submitted projects. Not bundled or imported by the node. |
| `tmp` 0.2.4         | Official scanner dependency. Its observed temporary-directory call uses static options, without untrusted prefix/postfix/directory input. Still an unpatched tooling finding.                                                                                                                                                                                                                                                                                |
| `uuid` 10.0.0       | CLI/LangChain dependency, not added by this node. The qualified host's workflow peer uses 11.1.1. Swarm does not call UUID buffer APIs.                                                                                                                                                                                                                                                                                                                      |
| `qs` 6.16.0 | Present in tooling and the qualified host HTTP helper. Two earlier advisories no longer apply to this copy; the remaining comma-array serializer advisory is retained. Swarm constructs scalar-only query parameters and exposes no serializer options. Other host uses are not cleared. |
| `stream-json` 1.9.1 | Present in tooling and host execution-data parsing. Swarm's HTTP JSON path uses Axios, not stream-json. Host persistence/readback remains a host-level concern; absence from our tarball does not prove the host unaffected.                                                                                                                                                                                                                                 |
| `zod` 3.25.76       | Present in tooling and host validation. Native schema checks cover all 31 Swarm actions and 102 arguments: scalars and custom JSON validators, with no per-element array validators. Scalars reject an array with one issue; the JSON validator does not validate each element. Swarm then enforces its collection limits before mapping. This excludes the reported array-error amplification path for those tool arguments, not every n8n validation path. |

Relevant primary sources: [n8n verification requirements](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines.md),
[Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
[tmp advisory](https://github.com/advisories/GHSA-ph9p-34f9-6g65).
The refreshed review also covers the [glob abort advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)
and [minimatch pattern advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249).
Exact advisory IDs, versions, paths and severities are retained in the unfiltered
local npm audit report. Counts can change with the advisory feed.

## Review And Release Status

The node can be reviewed independently of the complete development dependency
tree. Official strict lint and scanner checks, native functional acceptance,
source/package checks and provenance requirements remain mandatory and unchanged.
No vulnerable package was renamed, overridden, forked or hidden from the audit.

The owner-approved `npm run review:dependencies` gate retains the unfiltered
audit and visibly reports the reviewed findings. Its seven root-package reviews
are bound to exact versions, installation paths, advisory IDs and severities,
the qualified toolchain and the no-added-runtime-dependencies boundary. New or
changed findings, incomplete reports and an expired review block release.
This review expires November 27, 2026; rerun it on the exact release source.
`npm run audit:dependencies` remains unchanged and currently exits nonzero.

Publication and submission remain subject to final owner approval. Review
readiness does not mean the upstream libraries are patched or all host risk is
eliminated. No n8n verification requirement is waived by this custom review.

For self-hosted use, maintain n8n security updates, restrict workflow and
credential access, and apply execution-resource and data-retention limits.
n8n Cloud operators manage their platform libraries. A community node cannot
patch those host installations. Keep Swarm connections scoped and read-only
unless a workflow deliberately needs permitted writes.
