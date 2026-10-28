import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { reviewDependencies } from '../scripts/review-dependencies.mjs';

test('dependency exposure review is narrow and fails closed on changed risk', () => {
	const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
	const path = 'node_modules/@n8n/scan-community-package/node_modules/tmp';
	const lock = { packages: { [path]: { version: '0.2.4', dev: true } } };
	const report = {
		auditReportVersion: 2,
		metadata: { vulnerabilities: { total: 1 } },
		vulnerabilities: {
			tmp: {
				name: 'tmp',
				nodes: [path],
				via: [{ url: 'https://github.com/advisories/GHSA-ph9p-34f9-6g65', severity: 'high' }],
			},
		},
	};
	const now = Date.parse('2026-10-28T00:00:00Z');
	assert.equal(reviewDependencies(report, lock, pkg, now).roots[0].scope, 'tooling');
	assert.throws(() =>
		reviewDependencies(report, lock, { ...pkg, dependencies: { tmp: '0.2.4' } }, now),
	);
	assert.throws(() =>
		reviewDependencies(report, { packages: { [path]: { version: '0.2.4' } } }, pkg, now),
	);
	assert.throws(() =>
		reviewDependencies(report, { packages: { [path]: { version: '0.2.5', dev: true } } }, pkg, now),
	);
	assert.throws(() =>
		reviewDependencies(
			{
				...report,
				vulnerabilities: { tmp: { ...report.vulnerabilities.tmp, nodes: ['node_modules/tmp'] } },
			},
			lock,
			pkg,
			now,
		),
	);
	const changed = structuredClone(report);
	changed.vulnerabilities.tmp.via[0].url = 'https://github.com/advisories/GHSA-new-risk';
	assert.throws(() => reviewDependencies(changed, lock, pkg, now));
	changed.vulnerabilities.tmp.via[0].url = report.vulnerabilities.tmp.via[0].url;
	changed.vulnerabilities.tmp.via[0].severity = 'critical';
	assert.throws(() => reviewDependencies(changed, lock, pkg, now));
	assert.throws(() =>
		reviewDependencies({ ...report, error: { code: 'network' } }, lock, pkg, now),
	);
	assert.throws(() => reviewDependencies(report, lock, pkg, Date.parse('2026-11-28')));
});

test('a failed audit cannot leave a previous successful review receipt', () => {
	const dir = mkdtempSync(join(tmpdir(), 'swarm-n8n-audit-'));
	try {
		mkdirSync(join(dir, 'scripts'));
		mkdirSync(join(dir, '.local'));
		const script = join(dir, 'scripts/review-dependencies.mjs');
		writeFileSync(
			script,
			readFileSync(new URL('../scripts/review-dependencies.mjs', import.meta.url)),
		);
		writeFileSync(join(dir, '.local/dependency-review.json'), '{}');
		const result = spawnSync(process.execPath, [script], {
			env: { ...process.env, PATH: join(dir, 'missing-bin') },
			encoding: 'utf8',
			timeout: 5000,
		});
		assert.equal(result.error, undefined);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /npm audit did not complete/);
		assert(!existsSync(join(dir, '.local/dependency-review.json')));
		assert.equal(readFileSync(join(dir, '.local/dependency-audit.json'), 'utf8'), '');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
