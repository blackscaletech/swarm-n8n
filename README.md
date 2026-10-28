# Swarm for n8n

Use [Swarm](https://swarm.services) knowledge and work in n8n workflows and AI agents.
Retrieve context for a support case, save a sourced report, record feedback, or
keep a project conversation up to date.

## Installation

In a supported self-hosted n8n instance, open **Settings > Community nodes** and
install `@blackscaletech/n8n-nodes-swarm`. n8n verification has not been granted;
n8n Cloud availability depends on that approval.

The repository is `swarm-n8n`. The npm package is
`@blackscaletech/n8n-nodes-swarm` because n8n requires the `n8n-nodes-` prefix.
The node's display name is **Swarm**.

## Actions

| Resource        | Available actions                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| Space           | List, get, search, build a context pack, get the decision graph, work contract and action intelligence |
| Memory          | Ask saved memory, list answers, get an answer with its evidence                                        |
| Artifact        | List, get metadata, content and sources, create a sourced output                                       |
| Task            | Get selected Tasks, get, create, update with a version precondition                                    |
| Run             | List, get status and results, get authorized context                                                   |
| Conversation    | Get the Space thread, list entries, post a message or reply                                            |
| Evaluation      | List, get, record feedback using a simple score or a Run scoring contract                              |
| Task Dependency | List for one predecessor, get, create a dependency                                                     |

The same node is available as an AI agent tool. Choose one action and bind the
Space and other security-sensitive identifiers before letting a model supply
the question or content. Use separate read-only tools and write-enabled tools.

## Credentials

1. Sign in to [Swarm Connect](https://swarm.services/connect).
2. Create a connection restricted to the Spaces and capabilities your workflow needs.
3. Add a **Swarm API** credential in n8n. Enter its access token in the password field.
4. Test the credential. The test reads one authorized Space; it does not create data.
5. Leave **Allow Writes** off for retrieval workflows. Enable it only for deliberate
   create/update actions and grant the corresponding permissions in Swarm.

Use a Universal Connection access token for these REST actions. Swarm's MCP OAuth
tokens are scoped to MCP and cannot authenticate this node.

Swarm enforces the token's current permissions on every request. The write switch
can restrict a token further; it cannot grant permission. Revoke the connection
in Swarm to remove access. Never put tokens in node parameters, expressions,
workflow exports, screenshots or shared execution logs.

n8n encrypts credentials using its configured encryption key. Protect that key
and access to the n8n instance. Stored workflow outputs may contain private
Space content: restrict execution history, sharing and retention appropriately.

## Example Workflows

- Import [`prepare-brief.json`](examples/prepare-brief.json), select a credential
  and a Space, then set the support question. The context pack returns bounded
  evidence for the next step in your workflow.
- Import [`save-report.json`](examples/save-report.json), select a write-enabled
  credential, and supply a Space ID, report and unique business event ID. It
  saves the report as an Artifact and posts a short conversation update.

Use n8n's Schedule Trigger for periodic workflows and its own webhook nodes for
incoming events. This action node does not register a Swarm listener, maintain
a background session, claim Runs or act as a Run executor.

## Controls And Limits

- Requests go only to `https://api.swarm.services`, with TLS verification and
  redirects disabled. There is no custom host, URL or arbitrary HTTP operation.
- Page size is 1 to 100, default 50. **Records** emits each result as an n8n item.
  **Page With Cursor** emits `{ items, nextCursor, hasMore }`. Pass `nextCursor`
  into the next request explicitly. This node adds no automatic pagination or
  application retry loop. Native n8n may retry a `401` authentication failure once.
- Each incoming n8n item makes one request. n8n can execute these concurrently;
  use Loop Over Items and Wait for large batches. This node does not add its own
  scheduler or global concurrency limit. Respect Swarm's rate-limit responses.
- **Response Fields** defaults to **Raw**. Choose **Simplified** for up to ten
  useful top-level fields, or **Selected Fields** and list up to 32 field names.
  Record IDs, trust notices and page cursors are retained. This filters the
  existing response locally; it does not fetch extra data or reduce server access.
  Bind this choice before using the node as an AI agent tool.
- **Get Selected Tasks** requires a Space and up to 40 known Task IDs. Search
  first if you need to discover Tasks. Dependency lists require one predecessor
  and support the same explicit limit, cursor and page output as other lists.
- Requests time out after 30 seconds and responses are capped at 8 MiB. Artifact
  creation supports text, Markdown and JSON up to 256 KiB. Use the API or SDK
  directly for larger payloads and binary streaming.
- Writes require a stable **Request Key**, 8 to 128 characters. Use a business
  identifier such as `support-case:123:summary:v1`. Retry the same action with
  the same key. Change the key when the input or intended action changes. An n8n
  execution ID changes on replay, so it is not a reliable business deduplication key.
- Task updates require the current Task's `updated_at`. A concurrent edit
  returns `409`; read the latest Task before deciding whether to retry.
  Task titles allow 160 UTF-8 bytes and descriptions 4,000.
- **Ask Saved Memory** saves an answer from visible evidence. Learning suggestions
  are off by default. Choose a supported Output Shape when needed. Context packs
  require a Query or Objective in Additional Fields. **Create Evaluation** may activate an existing authorized
  follow-up policy in the Space; review those policies before using it in a loop.
  Select a Run ID or Artifact ID and supply Outcome and Score, or the Run's
  scoring contract hash and dimension scores, in Additional Fields.

This node does not administer users, Spaces, billing, credentials or permissions.
It does not configure schedulers, approve human gates, delete records or directly
launch paid hosted work. Connected MCP clients, SDKs and other plugins keep
using their existing interfaces and permissions.

## Errors

`401`: reconnect or replace an expired/revoked token. `403`: check selected Spaces
and capabilities; the node never broadens them. `409`: reconcile the current
record or idempotency conflict. `429`: slow the workflow down and respect the
server's retry guidance. Network timeouts have an uncertain write outcome: retry
with the original Request Key. Do not put automatic retries around changed inputs.

## Development

Use the Node.js version in `.node-version` (24.22.1) and npm 11.19.1 for development.
n8n 2.45.4 or later is required. The candidate is qualified against n8n 2.45.4
and its `n8n-workflow` 2.45.1 peer, including HTTP response-byte limits.

```sh
npm ci --ignore-scripts
npm run review:dependencies
npm run verify
npm run scan
```

For native n8n execution and AI tool acceptance with an isolated, synthetic HTTPS
peer, use macOS, Linux or WSL with Docker and OpenSSL, then run
`npm run test:integration`. This uses a digest-pinned n8n image, a private Docker
network and no production credentials. Temporary credentials, TLS keys, database
and containers are removed; ignored receipts, logs and the exact tarball remain
under `.local/`.
On success, the native acceptance command also copies the exact tested tarball
and its SHA-256 file to the repository root for release. The publishing workflow
uses these files without repacking and verifies the checksum before publishing.

`npm run dev` uses the official node development tool in external-host mode.
It compiles on change and links this package under `.local/dev/.n8n/custom`.
Start your separately installed, patched n8n host with `N8N_DEV_RELOAD=true` and
`N8N_USER_FOLDER` set to this repository's absolute `.local/dev` path. This avoids
an implicit download of an unpinned host or changes to your usual n8n data.

The scanner checks local source and the packed files using n8n's official rules.
Registry provenance and public source verification require publication and are
not established by this local scan. The dependency review retains the full raw
audit and permits only the explicitly reviewed upstream findings until its
expiry. New advisories or changed reviewed versions, paths or severities block
release. `npm run audit:dependencies` remains available and exits nonzero for
the current findings; a passing exposure review is not a clean audit.
Development tools are not included in the npm tarball. The package has no bundled
external runtime dependencies and uses the host's `n8n-workflow` peer API.
Manage host security updates separately.
The native acceptance test verifies the real n8n installer adds no dependency
modules and checks the AI-tool validators. See the
[dependency exposure review](docs/dependency-exposure.md) for the distinction
between tooling findings and host concerns. Official n8n checks and provenance
requirements are unchanged.

See [Swarm's guide](https://swarm.services/guide) and
[API reference](https://swarm.services/guide/api). Release preparation is in
[`docs/releasing.md`](docs/releasing.md).

## License

MIT. This license covers this integration, not the Swarm service.
