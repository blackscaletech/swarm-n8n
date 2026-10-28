import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { posix, sep } from 'node:path';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { validateNodeName } = require('../node_modules/@n8n/node-cli/dist/utils/validation.js');
const pkg = require('../package.json');
const compiler = require('typescript/package.json');
assert.equal(compiler.name, 'typescript', 'Use the declared compiler, not a stale alias');
assert.equal(compiler.version, pkg.devDependencies.typescript);
assert.equal(require('n8n-workflow/package.json').version, pkg.devDependencies['n8n-workflow']);
assert.equal(pkg.name, '@blackscaletech/n8n-nodes-swarm');
assert.equal(validateNodeName(pkg.name), undefined, 'Use the official n8n naming convention');
assert(
	validateNodeName('@blackscaletech/swarm-n8n-nodes'),
	'Swarm-first npm names are not n8n-compatible',
);
assert.equal(pkg.author.name, 'Blackscale');
assert.equal(pkg.author.email, 'hello@blackscale.tech');
assert.equal(pkg.repository.url, 'https://github.com/blackscaletech/swarm-n8n.git');
assert.equal(pkg.license, 'MIT');
assert.equal(pkg.n8n.strict, true);
assert.deepEqual(pkg.dependencies ?? {}, {});
assert.deepEqual(pkg.optionalDependencies ?? {}, {});
assert.deepEqual(pkg.bundledDependencies ?? [], []);
assert.deepEqual(pkg.peerDependencies, { 'n8n-workflow': '*' });
const [pack] = JSON.parse(
	execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], { encoding: 'utf8' }),
);
assert(pack.size < 100000, 'Keep the integration lightweight');
const expectedFiles = [
	'package.json',
	'README.md',
	'LICENSE',
	...['nodes', 'credentials'].flatMap((directory) =>
		readdirSync(directory, { recursive: true })
			.filter((file) => /\.(ts|json|svg)$/.test(file))
			.map((file) => `dist/${directory}/${file.split(sep).join('/').replace(/\.ts$/, '.js')}`),
	),
];
assert.deepEqual(
	pack.files.map((file) => file.path).sort(),
	expectedFiles.sort(),
	'Packaged files must match the reviewed sources and public assets exactly',
);
for (const { path } of pack.files) {
	if (path.endsWith('.js')) {
		const code = readFileSync(path, 'utf8');
		const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
		function checkImports(node) {
			if (
				ts.isCallExpression(node) &&
				((ts.isIdentifier(node.expression) && node.expression.text === 'require') ||
					node.expression.kind === ts.SyntaxKind.ImportKeyword)
			) {
				assert(
					node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]),
					`Dynamic module import: ${path}`,
				);
				const specifier = node.arguments[0].text;
				if (specifier !== 'n8n-workflow') {
					assert(
						specifier.startsWith('./') || specifier.startsWith('../'),
						`Unreviewed runtime import: ${specifier}`,
					);
					const target = posix.normalize(posix.join(posix.dirname(path), specifier));
					assert(
						pack.files.some((file) => file.path === target || file.path === `${target}.js`),
						`Import outside package: ${specifier}`,
					);
				}
			}
			ts.forEachChild(node, checkImports);
		}
		checkImports(source);
		assert(
			!/\bprocess\.env\b|node:fs|require\(["']fs["']\)|console\./.test(code),
			`Runtime boundary: ${path}`,
		);
	}
}
for (const path of [...pkg.n8n.nodes, ...pkg.n8n.credentials, 'dist/nodes/Swarm/swarm.svg']) {
	assert(
		pack.files.some((file) => file.path === path),
		`Missing packaged entry: ${path}`,
	);
}
const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
assert(workflow.includes('workflow_dispatch:'));
assert(
	!/^\s{2}(push|pull_request|release|schedule):/m.test(workflow),
	'Only manually approved releases',
);
if (execFileSync('git', ['rev-list', '--all', '--count'], { encoding: 'utf8' }).trim() !== '0') {
	const authors = execFileSync('git', ['log', '--all', '--format=%ae%n%ce'], { encoding: 'utf8' })
		.trim()
		.split('\n');
	assert(
		authors.every((author) => author === '6562904+blackscaletech@users.noreply.github.com'),
		'Review commit attribution',
	);
}
console.log(
	`Package boundary passed: ${pack.files.length} files, ${pack.size} compressed bytes, no bundled dependencies`,
);
