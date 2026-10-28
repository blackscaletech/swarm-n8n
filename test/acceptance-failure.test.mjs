import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

test('native acceptance failure removes stale exports and cleans secrets despite Docker errors', () => {
	const dir = mkdtempSync(join(tmpdir(), 'swarm-n8n-failure-'));
	try {
		for (const name of ['test', 'bin']) mkdirSync(join(dir, name));
		for (const name of ['package.json', 'README.md', 'LICENSE', 'dist'])
			cpSync(new URL(`../${name}`, import.meta.url), join(dir, name), { recursive: true });
		cpSync(new URL('./acceptance.mjs', import.meta.url), join(dir, 'test/acceptance.mjs'));
		// No real Docker command is used. Simulate loss of the daemon after network setup.
		writeFileSync(
			join(dir, 'bin/docker'),
			'#!/bin/sh\nif [ "$1" = network ] && [ "$2" = create ]; then echo synthetic-network; exit 0; fi\nexit 1\n',
			{ mode: 0o700 },
		);
		// Reuse the already compiled fixture; only simulate failures, never a successful qualification.
		writeFileSync(
			join(dir, 'bin/npm'),
			'#!/bin/sh\nif [ "$1" = run ] && [ "$2" = build ]; then if [ "$SIMULATE_BUILD_FAILURE" = 1 ]; then echo synthetic-build-failure >&2; exit 1; fi; exit 0; fi\nexec "$REAL_NODE" "$REAL_NPM" "$@"\n',
			{ mode: 0o700 },
		);
		const { version } = JSON.parse(readFileSync(join(dir, 'package.json')));
		const filename = `blackscaletech-n8n-nodes-swarm-${version}.tgz`;
		for (const phase of ['docker', 'build']) {
			for (const name of [filename, `${filename}.sha256`]) writeFileSync(join(dir, name), 'stale');
			const result = spawnSync(process.execPath, [join(dir, 'test/acceptance.mjs')], {
				cwd: dir,
				env: {
					...process.env,
					PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
					REAL_NODE: process.execPath,
					REAL_NPM: realpathSync(
						process.env.npm_execpath ?? join(dirname(process.execPath), 'npm'),
					),
					SIMULATE_BUILD_FAILURE: phase === 'build' ? '1' : '0',
				},
				encoding: 'utf8',
				timeout: 30000,
			});
			assert.equal(result.error, undefined);
			assert.equal(result.status, 1);
			assert.match(result.stderr, /Native acceptance or cleanup did not complete/);
			assert.match(
				result.stderr,
				phase === 'build' ? /synthetic-build-failure/ : /Command failed: docker run/,
			);
			for (const name of [filename, `${filename}.sha256`]) assert(!existsSync(join(dir, name)));
		}
		const fixtures = readdirSync(join(dir, '.local'));
		assert.equal(fixtures.length, 2);
		for (const directory of fixtures) {
			const fixture = join(dir, '.local', directory);
			for (const name of [
				'state',
				'credentials.json',
				'server.key',
				'server.crt',
				'openssl.conf',
				'receipt.json',
			])
				assert(!existsSync(join(fixture, name)), `Failed run retained ${name}`);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
