import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Owner-approved exposure review. These versions are not claimed to be patched.
const reviewed = {
	deepmerge: ['4.3.1', 'node_modules/deepmerge', 'low', 'tooling', ['GHSA-gcqx-w48m-w2h4']],
	qs: [
		'6.15.2',
		'node_modules/@n8n/backend-network/node_modules/qs',
		'moderate',
		'tooling-and-host',
		['GHSA-x5fp-wj9c-mxmx', 'GHSA-4mjr-xmp4-gh2g', 'GHSA-6pq8-jhm2-2vcw'],
	],
	'stream-json': [
		'1.9.1',
		'node_modules/stream-json',
		'moderate',
		'tooling-and-host',
		['GHSA-528h-pc64-c93x', 'GHSA-hqr4-qq8f-hg3x', 'GHSA-mjw6-4jj6-33hc'],
	],
	tmp: [
		'0.2.4',
		'node_modules/@n8n/scan-community-package/node_modules/tmp',
		'high',
		'tooling',
		['GHSA-ph9p-34f9-6g65'],
	],
	uuid: ['10.0.0', 'node_modules/uuid', 'moderate', 'tooling', ['GHSA-w5hq-g745-h8pq']],
	zod: ['3.25.76', 'node_modules/zod', 'high', 'tooling-and-host', ['GHSA-mrhx-c7xc-m3w5']],
};
const reviewedTools = {
	'@n8n/node-cli': '0.54.3',
	'@n8n/scan-community-package': '0.41.0',
	'n8n-workflow': '2.45.1',
};
const reviewUntil = '2026-11-27T23:59:59Z';

export function reviewDependencies(report, lock, pkg, now = Date.now()) {
	assert(
		!report.error &&
			report.auditReportVersion === 2 &&
			report.vulnerabilities &&
			report.metadata?.vulnerabilities,
		'A complete npm audit report is required',
	);
	assert(now <= Date.parse(reviewUntil), 'Renew the dependency exposure review');
	for (const key of ['dependencies', 'optionalDependencies'])
		assert.deepEqual(pkg[key] ?? {}, {}, 'No external runtime dependencies');
	assert.deepEqual(pkg.bundledDependencies ?? [], []);
	assert.deepEqual(pkg.peerDependencies, { 'n8n-workflow': '*' });
	assert.equal(pkg.n8n.strict, true);
	for (const [name, version] of Object.entries(reviewedTools))
		assert.equal(pkg.devDependencies[name], version, 'Review changed tooling/peer versions');
	const findings = report.vulnerabilities;
	assert.equal(
		report.metadata.vulnerabilities.total,
		Object.keys(findings).length,
		'Incomplete audit counts',
	);
	const roots = [];
	for (const finding of Object.values(findings)) {
		assert(Array.isArray(finding.via) && finding.via.length, 'Unclassified audit entry');
		const direct = finding.via.filter((value) => typeof value === 'object');
		if (!direct.length) continue;
		const policy = reviewed[finding.name];
		assert(policy, `Unreviewed advisory package: ${finding.name}`);
		const [version, path, severity, scope, ids] = policy;
		assert.deepEqual(finding.nodes, [path], `Review changed dependency paths: ${finding.name}`);
		assert.equal(lock.packages[path]?.version, version, `Review changed ${finding.name} version`);
		assert.equal(lock.packages[path]?.dev, true, `Review runtime exposure: ${finding.name}`);
		for (const advisory of direct) {
			const id = /^https:\/\/github\.com\/advisories\/(GHSA-[a-z0-9-]+)$/.exec(advisory.url)?.[1];
			assert(
				ids.includes(id) && advisory.severity === severity,
				`Unreviewed advisory or severity: ${advisory.url}`,
			);
			roots.push({ package: finding.name, version, path, id, severity, scope });
		}
	}
	function hasReviewedRoot(name, seen = new Set()) {
		assert(findings[name], `Missing advisory dependency: ${name}`);
		if (seen.has(name)) return false;
		seen.add(name);
		return findings[name].via
			.map((via) => typeof via === 'object' || hasReviewedRoot(via, seen))
			.some(Boolean);
	}
	for (const name of Object.keys(findings))
		assert(hasReviewedRoot(name), `Unresolved audit entry: ${name}`);
	return { reviewUntil, rawCounts: report.metadata.vulnerabilities, roots, patched: false };
}

if (
	process.argv[1] &&
	realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
	const root = fileURLToPath(new URL('..', import.meta.url));
	mkdirSync(`${root}/.local`, { recursive: true });
	rmSync(`${root}/.local/dependency-review.json`, { force: true });
	const result = spawnSync('npm', ['audit', '--json'], {
		cwd: root,
		encoding: 'utf8',
		timeout: 60000,
		maxBuffer: 5 * 1024 * 1024,
	});
	writeFileSync(`${root}/.local/dependency-audit.json`, result.stdout ?? '', { mode: 0o600 });
	assert(!result.error && [0, 1].includes(result.status), 'npm audit did not complete');
	const read = (path) => JSON.parse(readFileSync(`${root}/${path}`, 'utf8'));
	const review = reviewDependencies(
		read('.local/dependency-audit.json'),
		read('package-lock.json'),
		read('package.json'),
	);
	writeFileSync(`${root}/.local/dependency-review.json`, JSON.stringify(review, null, 2), {
		mode: 0o600,
	});
	console.warn(`Upstream findings remain unpatched: ${JSON.stringify(review.rawCounts)}`);
	for (const { package: name, id, scope } of review.roots)
		console.warn(`${id}: ${name}, ${scope}; see docs/dependency-exposure.md`);
	console.log(
		'Exposure review passed, not a clean audit. Package boundary, official scanner and native host checks remain mandatory.',
	);
}
