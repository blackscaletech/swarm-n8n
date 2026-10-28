# Security

Report suspected vulnerabilities privately to hello@swarm.services. Include the
package version, affected action and a minimal synthetic reproduction. Do not
send access tokens or private Space content and do not open a public issue with
sensitive details.

Use a supported, patched n8n release, restrict access to credentials and execution
history, and grant each Swarm connection only the Spaces and capabilities it needs.

The [dependency exposure review](docs/dependency-exposure.md) distinguishes
development tools, the shipped node and host-supplied libraries. Raw audit
findings remain visible; review readiness is not a claim that the n8n host is
free of vulnerabilities.
