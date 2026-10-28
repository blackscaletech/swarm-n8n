import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	analyzePackage,
	SOURCE_FILE_PATTERNS,
} from '@n8n/scan-community-package/scanner/scanner.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'swarm-n8n-scan-'));
try {
	const [pack] = JSON.parse(
		execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', dir], {
			cwd: root,
			encoding: 'utf8',
		}),
	);
	execFileSync('tar', ['-xzf', join(dir, pack.filename), '-C', dir]);
	for (const [scope, path, patterns] of [
		['source', root, SOURCE_FILE_PATTERNS],
		['tarball', join(dir, 'package'), ['**/*.js', 'package.json']],
	]) {
		const result = await analyzePackage(path, patterns);
		assert(result.passed, `${scope}: ${result.message}\n${result.details ?? ''}`);
		console.log(`Official n8n scanner ${scope} rules passed`);
	}
	console.log(
		'Unpublished local checks only; registry provenance and public-source verification still require publication.',
	);
} finally {
	rmSync(dir, { recursive: true, force: true });
}
