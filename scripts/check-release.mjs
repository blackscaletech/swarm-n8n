import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
assert.match(version, /^\d+\.\d+\.\d+$/);
assert.equal(process.env.RELEASE_VERSION, version, 'Review version must match package.json');
assert.equal(process.env.GITHUB_REF, `refs/tags/v${version}`, 'Select the reviewed version tag');
assert.equal(process.env.GITHUB_REPOSITORY, 'blackscaletech/swarm-n8n');
assert.equal(
	process.versions.node,
	readFileSync(new URL('../.node-version', import.meta.url), 'utf8').trim(),
);
assert.equal(execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(), '11.19.1');
