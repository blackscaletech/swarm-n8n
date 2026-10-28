// Runs only inside the pinned, disposable n8n acceptance host.
import assert from 'node:assert/strict';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';

const hostRoot = '/usr/local/lib/node_modules/n8n';
const host = createRequire(`${hostRoot}/package.json`);
host('reflect-metadata');
const { CommunityPackagesService } = host(
	`${hostRoot}/dist/modules/community-packages/community-packages.service.js`,
);
const npm = host(`${hostRoot}/dist/modules/community-packages/npm-utils.js`);
const candidate = createRequire('/candidate/package.json');
const pkg = candidate('./package.json');
const { operations } = candidate('./dist/nodes/Swarm/catalog.js');
const { fieldName } = candidate('./dist/nodes/Swarm/fields.js');
const folder = '/state/.n8n/nodes';
mkdirSync(folder, { recursive: true });
writeFileSync(`${folder}/package.json`, JSON.stringify({ private: true, dependencies: {} }));
const service = Object.create(CommunityPackagesService.prototype);
service.downloadFolder = folder;
service.packageJsonPath = `${folder}/package.json`;
service.getNpmRegistry = () => 'https://api.swarm.services/registry';
const executeNpm = npm.executeNpmCommand;
let installCalled = false;
try {
	// Only the unpublished registry download is replaced. Installation is native.
	npm.executeNpmCommand = async (args, options) => {
		if (args[0] === 'pack') {
			const filename = basename(process.argv[2]);
			copyFileSync(process.argv[2], join(options.cwd, filename));
			return filename;
		}
		assert.equal(args[0], 'install');
		assert(args.includes('--ignore-scripts=true'));
		installCalled = true;
		return executeNpm(args, options);
	};
	await service.downloadPackage(pkg.name, pkg.version);
} finally {
	npm.executeNpmCommand = executeNpm;
}
assert(installCalled);
const installed = join(folder, 'node_modules', pkg.name);
const manifest = JSON.parse(readFileSync(`${installed}/package.json`));
for (const key of ['devDependencies', 'peerDependencies', 'optionalDependencies'])
	assert.equal(manifest[key], undefined, `Native installer must remove ${key}`);
assert.deepEqual(manifest.dependencies ?? {}, {});
const addedModules = existsSync(`${installed}/node_modules`)
	? readdirSync(`${installed}/node_modules`).filter((name) => !name.startsWith('.'))
	: [];
assert.deepEqual(
	addedModules,
	[],
	'Node installation must not add the development dependency tree',
);
assert.deepEqual(
	readdirSync(`${folder}/node_modules`).filter((name) => !name.startsWith('.')),
	['@blackscaletech'],
);

const coreRoot = dirname(host.resolve('n8n-core/package.json'));
const { getSchema } = host(
	`${coreRoot}/dist/execution-engine/node-execution-context/utils/create-node-as-tool.js`,
);
let argumentsChecked = 0;
function checkSchema(schema) {
	const def = schema._def;
	assert(
		[
			'ZodObject',
			'ZodString',
			'ZodNumber',
			'ZodBoolean',
			'ZodEffects',
			'ZodAny',
			'ZodDefault',
		].includes(def.typeName),
		`Review changed host tool validator: ${def.typeName}`,
	);
	if (def.typeName === 'ZodObject') Object.values(schema.shape).forEach(checkSchema);
	if (def.schema) checkSchema(def.schema);
	if (def.innerType) checkSchema(def.innerType);
}
for (const operation of operations) {
	const parameters = {
		resource: operation.resource,
		operation: operation.id,
		additionalFields: {},
	};
	for (const field of operation.fields) {
		const type = ['ids', 'strings', 'scores'].includes(field.kind)
			? 'json'
			: ['boolean', 'number'].includes(field.kind)
				? field.kind
				: 'string';
		const name = fieldName(field);
		(field.required ? parameters : parameters.additionalFields)[name] =
			`={{ $fromAI('${name}', '', '${type}') }}`;
	}
	const schema = getSchema({ name: 'Swarm', parameters });
	checkSchema(schema);
	for (const input of Object.values(schema.shape)) {
		argumentsChecked++;
		// Scalars reject a collection once; JSON custom validation does not parse elements.
		const result = input.safeParse(Array(64).fill(null));
		if (!result.success) assert.equal(result.error.issues.length, 1);
	}
}
const receipt = {
	host: host('./package.json').version,
	peer: host('n8n-workflow/package.json').version,
	installer: 'native downloadPackage with local tarball download',
	addedRuntimeModules: addedModules,
	aiSchemas: operations.length,
	argumentsChecked,
	perElementArrayValidators: 0,
	standaloneHostSecurityAudit: false,
};
writeFileSync('/fixture/host-contract.json', JSON.stringify(receipt, null, 2), { mode: 0o600 });
console.log(JSON.stringify(receipt));
