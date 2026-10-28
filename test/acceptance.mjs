import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const pkg = require('../package.json');
assert.equal(pkg.name, '@blackscaletech/n8n-nodes-swarm');
assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
const exportPath = `${root}/blackscaletech-n8n-nodes-swarm-${pkg.version}.tgz`;
for (const path of [exportPath, `${exportPath}.sha256`]) rmSync(path, { force: true });
const image =
	'docker.n8n.io/n8nio/n8n@sha256:80e23ced901f0e22597d4f3464e3aaf9d835372262ea6f08ef760d8ca35df25c';
mkdirSync(`${root}/.local`, { recursive: true });
const dir = mkdtempSync(`${root}/.local/acceptance-`);
const network = `swarm-n8n-${process.pid}`,
	peer = `${network}-peer`;
const run = (command, args, options = {}) =>
	execFileSync(command, args, {
		encoding: 'utf8',
		timeout: 120000,
		maxBuffer: 2 * 1024 * 1024,
		...options,
	});
const save = (name, value) =>
	writeFileSync(
		`${dir}/${name}`,
		typeof value === 'string' ? value : JSON.stringify(value, null, 2),
		{ mode: 0o600 },
	);
let pack, receipt, failure;
let networkCreated = false;
const cleanupErrors = [];
try {
	save('build.log', run('npm', ['run', 'build'], { cwd: root }));
	const { operations } = require('../dist/nodes/Swarm/catalog.js');
	const { fieldName } = require('../dist/nodes/Swarm/fields.js');
	save(
		'openssl.conf',
		'[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=api.swarm.services\n[ext]\nsubjectAltName=DNS:api.swarm.services\nbasicConstraints=CA:TRUE\nkeyUsage=digitalSignature,keyEncipherment,keyCertSign\n',
	);
	run(
		'openssl',
		[
			'req',
			'-x509',
			'-newkey',
			'rsa:2048',
			'-nodes',
			'-days',
			'1',
			'-config',
			`${dir}/openssl.conf`,
			'-keyout',
			`${dir}/server.key`,
			'-out',
			`${dir}/server.crt`,
		],
		{ stdio: 'pipe' },
	);
	[pack] = JSON.parse(
		run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', dir], { cwd: root }),
	);
	mkdirSync(`${dir}/state`, { recursive: true });
	save('credentials.json', [
		{
			id: 'swarmSynthetic01',
			name: 'Synthetic write connection',
			type: 'swarmApi',
			data: { accessToken: 'synthetic-writer', allowWrites: true },
		},
		{
			id: 'swarmSynthetic02',
			name: 'Synthetic viewer',
			type: 'swarmApi',
			data: { accessToken: 'synthetic-viewer', allowWrites: false },
		},
		{
			id: 'swarmSynthetic03',
			name: 'Viewer with local write switch',
			type: 'swarmApi',
			data: { accessToken: 'synthetic-viewer', allowWrites: true },
		},
		{
			id: 'swarmSynthetic04',
			name: 'Revoked synthetic connection',
			type: 'swarmApi',
			data: { accessToken: 'synthetic-revoked', allowWrites: false },
		},
		{
			id: 'modelSynthetic01',
			name: 'Offline synthetic chat model',
			type: 'openAiApi',
			data: { apiKey: 'synthetic-model-key', url: 'https://api.swarm.services/llm/v1' },
		},
	]);
	const common = [
		'--rm',
		'--network',
		network,
		'--label',
		`com.blackscale.swarm-n8n.fixture=${network}`,
		'--user',
		`${process.getuid()}:${process.getgid()}`,
		'--mount',
		`type=bind,src=${dir},dst=/fixture`,
		'--mount',
		`type=bind,src=${dir}/state,dst=/state`,
		'-e',
		'N8N_USER_FOLDER=/state',
		'-e',
		'N8N_DIAGNOSTICS_ENABLED=false',
		'-e',
		'N8N_VERSION_NOTIFICATIONS_ENABLED=false',
		'-e',
		'N8N_TEMPLATES_ENABLED=false',
		'-e',
		'N8N_PERSONALIZATION_ENABLED=false',
		'-e',
		'NODE_EXTRA_CA_CERTS=/fixture/server.crt',
	];
	const n8n = (...args) => run('docker', ['run', ...common, image, ...args]);
	const node = (name, parameters, credential = 'swarmSynthetic01', tool = false) => ({
		id: name,
		name,
		type: `@blackscaletech/n8n-nodes-swarm.swarm${tool ? 'Tool' : ''}`,
		typeVersion: 1,
		position: [240, 0],
		parameters,
		credentials: { swarmApi: { id: credential, name: 'Synthetic connection' } },
	});
	const start = {
		id: 'start',
		name: 'Start',
		type: 'n8n-nodes-base.manualTrigger',
		typeVersion: 1,
		position: [0, 0],
		parameters: {},
	};
	function workflow(name, nodes) {
		const chain = [start, ...nodes];
		return {
			id: name,
			name,
			active: false,
			nodes: chain,
			connections: Object.fromEntries(
				chain
					.slice(0, -1)
					.map((n, i) => [
						n.name,
						{ main: [[{ node: chain[i + 1].name, type: 'main', index: 0 }]] },
					]),
			),
			settings: { executionOrder: 'v1' },
		};
	}
	function parameters(op) {
		const params = {
			resource: op.resource,
			operation: op.id,
			additionalFields: {},
			...(op.writes ? { requestKey: `synthetic:${op.id}:v1` } : {}),
			...(op.page ? { outputMode: 'page' } : {}),
		};
		for (const field of op.fields) {
			if (['dimensions', 'contract_hash'].includes(field.wire)) continue;
			const value =
				field.initial ??
				(field.choices
					? field.choices[0]
					: field.kind === 'id'
						? 'id_synthetic'
						: field.kind === 'csv'
							? 'task_a,task_b'
							: field.kind === 'ids'
								? '[]'
								: field.kind === 'strings'
									? '[]'
									: field.kind === 'number'
										? 80
										: field.kind === 'boolean'
											? false
											: field.wire === 'resource_type'
												? 'artifact'
												: ['expected_updated_at', 'start_at', 'end_at'].includes(field.wire)
													? '2026-10-27T12:00:00Z'
													: 'Synthetic support report');
			(field.required ? params : params.additionalFields)[fieldName(field)] =
				fieldName(field) === 'spaceId' ? { mode: 'id', value } : value;
		}
		return params;
	}
	function execute(flow) {
		save(`${flow.id}.json`, flow);
		n8n('import:workflow', `--input=/fixture/${flow.id}.json`);
		let output;
		try {
			output = n8n('execute', `--id=${flow.id}`, '--rawOutput');
		} catch (error) {
			save(`${flow.id}.log`, `${error.stdout ?? ''}\n${error.stderr ?? ''}`);
			assertNoCredentialLeak(`${error.stdout ?? ''}\n${error.stderr ?? ''}`);
			throw error;
		}
		save(`${flow.id}.log`, output);
		assertNoCredentialLeak(output);
		const begin = output.indexOf('{\n');
		assert(begin >= 0, `Missing n8n execution result: ${flow.id}`);
		return JSON.parse(output.slice(begin, output.lastIndexOf('\n}') + 2));
	}
	function assertNoCredentialLeak(output) {
		for (const token of [
			'synthetic-writer',
			'synthetic-viewer',
			'synthetic-revoked',
			'synthetic-model-key',
		])
			assert(!output.includes(token), 'Native execution output must not expose credentials');
	}
	const records = () =>
		readFileSync(`${dir}/requests.jsonl`, 'utf8')
			.trim()
			.split('\n')
			.filter(Boolean)
			.map((line) => JSON.parse(line));
	run('docker', ['network', 'create', '--internal', network]);
	networkCreated = true;
	run('docker', [
		'run',
		'-d',
		'--name',
		peer,
		'--label',
		`com.blackscale.swarm-n8n.fixture=${network}`,
		'--network',
		network,
		'--network-alias',
		'api.swarm.services',
		'--mount',
		`type=bind,src=${dir},dst=/fixture`,
		'--mount',
		`type=bind,src=${root},dst=/candidate,readonly`,
		'--entrypoint',
		'node',
		image,
		'/candidate/test/fixture.mjs',
	]);
	const hostContract = run('docker', [
		'run',
		...common,
		'--mount',
		`type=bind,src=${root},dst=/candidate,readonly`,
		'--entrypoint',
		'node',
		image,
		'/candidate/test/host-contract.mjs',
		`/fixture/${pack.filename}`,
	]);
	save('host-contract.log', hostContract);
	n8n('import:credentials', '--input=/fixture/credentials.json');
	const matrix = execute(
		workflow(
			'swarmLocalMatrix01',
			operations.map((op) => node(op.id, parameters(op))),
		),
	);
	assert(!matrix.data.resultData.error, JSON.stringify(matrix.data.resultData.error));
	const logged = records().filter((row) => row.operation);
	assert.deepEqual(
		logged.map((row) => row.operation),
		operations.map((op) => op.id),
	);
	for (const op of operations)
		assert(
			matrix.data.resultData.runData[op.id]?.[0].data.main[0].length >= 1,
			`${op.id} produced no native output`,
		);
	const listOp = operations.find((op) => op.id === 'listSpaces');
	const paging = execute(
		workflow('swarmLocalPages01', [
			node('First page', { ...parameters(listOp), limit: 1, additionalFields: {} }),
			node('Next page', {
				...parameters(listOp),
				limit: 1,
				additionalFields: { cursor: '={{ $json.nextCursor }}' },
			}),
		]),
	);
	assert.equal(paging.data.resultData.runData['Next page'][0].data.main[0][0].json.hasMore, false);
	const dependencies = parameters(operations.find((op) => op.id === 'listTaskDependencies'));
	const dependencyPages = execute(
		workflow('swarmLocalDependencyPages01', [
			node('Dependencies', { ...dependencies, limit: 1, additionalFields: {} }),
			node('Remaining dependencies', {
				...dependencies,
				limit: 1,
				additionalFields: { cursor: '={{ $json.nextCursor }}' },
			}),
		]),
	);
	assert(
		!dependencyPages.data.resultData.error,
		JSON.stringify(dependencyPages.data.resultData.error),
	);
	assert.deepEqual(
		['Dependencies', 'Remaining dependencies'].map((name) => {
			const page = dependencyPages.data.resultData.runData[name][0].data.main[0][0].json;
			return [page.items[0].id, page.hasMore];
		}),
		[
			['synthetic_dependency', true],
			['synthetic_dependency_next', false],
		],
	);
	const getSpace = parameters(operations.find((op) => op.id === 'getSpace'));
	const projection = execute(
		workflow('swarmLocalOutput01', [
			node('Summary', { ...getSpace, responseFields: 'simplified' }),
			node('Selected', { ...getSpace, responseFields: 'selected', fieldsToInclude: 'name' }),
		]),
	);
	assert(!projection.data.resultData.error, JSON.stringify(projection.data.resultData.error));
	const summary = projection.data.resultData.runData.Summary[0].data.main[0][0].json;
	assert.equal(summary.name, 'Customer Support');
	assert.equal(summary.body, undefined);
	assert.deepEqual(projection.data.resultData.runData.Selected[0].data.main[0][0].json, {
		id: 'synthetic_space',
		space_id: 'sp_synthetic',
		name: 'Customer Support',
	});
	const empty = execute(
		workflow('swarmLocalEmpty01', [
			node('Empty page', {
				...parameters(listOp),
				additionalFields: { cursor: 'synthetic-empty' },
			}),
		]),
	);
	assert(!empty.data.resultData.error, JSON.stringify(empty.data.resultData.error));
	assert.deepEqual(
		empty.data.resultData.runData['Empty page'][0].data.main[0].map((item) => item.json),
		[{ items: [], nextCursor: null, hasMore: false }],
	);
	const multi = execute(
		workflow('swarmLocalMulti01', [
			node('Input Spaces', {
				...parameters(listOp),
				outputMode: 'records',
				responseFields: 'selected',
				fieldsToInclude: 'name',
				additionalFields: { cursor: 'synthetic-multiple' },
			}),
			node('Read each Space', {
				...getSpace,
				spaceId: { mode: 'id', value: '={{ $json.id }}' },
				responseFields: 'selected',
				fieldsToInclude: 'name',
			}),
			node('Mixed pages', {
				...parameters(listOp),
				outputMode: 'records',
				responseFields: 'selected',
				fieldsToInclude: 'name',
				additionalFields: {
					cursor:
						"={{ $('Input Spaces').item.json.id === 'sp_first' ? 'synthetic-empty' : 'synthetic-multiple' }}",
				},
			}),
			{
				id: 'linked',
				name: 'Linked source',
				type: 'n8n-nodes-base.set',
				typeVersion: 3.4,
				position: [720, 0],
				parameters: {
					assignments: {
						assignments: [
							{
								id: 'source',
								name: 'sourceSpace',
								type: 'string',
								value: "={{ $('Input Spaces').item.json.id }}",
							},
						],
					},
					options: {},
				},
			},
		]),
	);
	assert(!multi.data.resultData.error, JSON.stringify(multi.data.resultData.error));
	assert.deepEqual(
		multi.data.resultData.runData['Linked source'][0].data.main[0].map(
			(item) => item.json.sourceSpace,
		),
		['sp_second', 'sp_second'],
	);
	for (const [index, name] of ['prepare-brief', 'save-report'].entries()) {
		const example = JSON.parse(readFileSync(`${root}/examples/${name}.json`, 'utf8'));
		example.id = `swarmLocalExample${index}`;
		for (const item of example.nodes) {
			if (item.type === '@blackscaletech/n8n-nodes-swarm.swarm')
				item.credentials = {
					swarmApi: {
						id: index === 0 ? 'swarmSynthetic02' : 'swarmSynthetic01',
						name: 'Synthetic connection',
					},
				};
		}
		const result = execute(example);
		assert(!result.data.resultData.error, JSON.stringify(result.data.resultData.error));
	}
	const read = parameters(operations.find((op) => op.id === 'getSpace'));
	const write = parameters(operations.find((op) => op.id === 'createArtifact'));
	const search = parameters(operations.find((op) => op.id === 'searchRecords'));
	const errors = [];
	const requestAttempts = {};
	for (const [name, params, credential, expected] of [
		['writeBlocked', write, 'swarmSynthetic02', /Allow Writes/],
		[
			'emptyContext',
			{
				...parameters(operations.find((op) => op.id === 'buildSpaceContextPack')),
				additionalFields: {},
			},
			'swarmSynthetic02',
			/Query or Objective/,
		],
		[
			'invalidOutputShape',
			{
				...parameters(operations.find((op) => op.id === 'askSpace')),
				additionalFields: { desiredOutputShape: 'custom report' },
			},
			'swarmSynthetic01',
			/not an allowed choice|not supported|not valid/i,
		],
		['serverDenied', write, 'swarmSynthetic03', /read-only|403/],
		['revoked', read, 'swarmSynthetic04', /401|authorized/],
		[
			'redirect',
			{ ...search, q: 'simulate-redirect' },
			'swarmSynthetic02',
			/302|redirect|status code/,
		],
		[
			'rateLimit',
			{ ...search, q: 'simulate-rate-limit' },
			'swarmSynthetic02',
			/429|Slow down|Too many/,
		],
		[
			'oversize',
			{ ...search, q: 'simulate-oversize' },
			'swarmSynthetic02',
			/maxContentLength|8388608|8 MiB|maximum allowed size/,
		],
		[
			'deadline',
			{ ...search, q: 'simulate-slow' },
			'swarmSynthetic02',
			/cancel|abort|timed out|timeout/i,
		],
		[
			'compressedOversize',
			{ ...search, q: 'simulate-compressed-oversize' },
			'swarmSynthetic02',
			/maxContentLength|8388608|8 MiB|maximum allowed size/,
		],
	]) {
		const flow = workflow(`swarmLocal${name}`, [node(name, params, credential)]);
		const beforeRequests = records().filter((row) => row.request).length;
		let result,
			failed = false;
		try {
			result = execute(flow);
		} catch {
			failed = true;
		}
		assert(failed || result?.data.resultData.error, `Expected failure: ${name}`);
		const failureLog = readFileSync(`${dir}/${flow.id}.log`, 'utf8');
		assertNoCredentialLeak(failureLog);
		assert.match(failed ? failureLog : JSON.stringify(result.data.resultData.error), expected);
		const attempts = records().filter((row) => row.request).length - beforeRequests;
		// The native credential helper makes one bounded reauthentication retry on 401.
		assert.equal(
			attempts,
			['writeBlocked', 'emptyContext', 'invalidOutputShape'].includes(name)
				? 0
				: name === 'revoked'
					? 2
					: 1,
			`${name}: unexpected request attempts`,
		);
		requestAttempts[name] = attempts;
		errors.push(name);
	}
	const agentFlow = workflow('swarmLocalAgent01', [
		{
			id: 'agent',
			name: 'AI Agent',
			type: '@n8n/n8n-nodes-langchain.agent',
			typeVersion: 2.2,
			position: [240, 0],
			parameters: {
				promptType: 'define',
				text: 'Find the approved customer rollout checklist using Swarm.',
				options: { maxIterations: 3 },
			},
		},
	]);
	agentFlow.nodes.push(
		{
			id: 'model',
			name: 'Offline Chat Model',
			type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
			typeVersion: 1.2,
			position: [120, 220],
			parameters: {
				model: { mode: 'id', value: 'synthetic-model' },
				options: { baseURL: 'https://api.swarm.services/llm/v1', maxRetries: 0 },
			},
			credentials: { openAiApi: { id: 'modelSynthetic01', name: 'Offline synthetic chat model' } },
		},
		node(
			'Swarm Context',
			{
				resource: 'space',
				operation: 'buildSpaceContextPack',
				spaceId: { mode: 'id', value: 'sp_synthetic' },
				tokenBudget: 2000,
				additionalFields: {
					mode: 'extractive',
					query: "={{ $fromAI('query', 'The support question', 'string') }}",
				},
			},
			'swarmSynthetic02',
			true,
		),
	);
	agentFlow.connections['Offline Chat Model'] = {
		ai_languageModel: [[{ node: 'AI Agent', type: 'ai_languageModel', index: 0 }]],
	};
	agentFlow.connections['Swarm Context'] = {
		ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]],
	};
	const agent = execute(agentFlow);
	assert(!agent.data.resultData.error, JSON.stringify(agent.data.resultData.error));
	assert(
		records().some((row) => row.modelStub && row.followup),
		'Native AI Agent must consume the tool result',
	);
	receipt = {
		package: pkg.name,
		version: pkg.version,
		time: new Date().toISOString(),
		image,
		packageSha256: createHash('sha256')
			.update(readFileSync(`${dir}/${pack.filename}`))
			.digest('hex'),
		operations: operations.length,
		nativePages: true,
		nativeDependencyPages: true,
		nativeFieldSelection: true,
		nativeEmptyPage: true,
		nativeItemLinking: true,
		boundedRequestAttempts: true,
		requestAttempts,
		failClosedChecks: errors,
		exampleWorkflows: 2,
		nativeAiTool: true,
		productionAccess: false,
		hostContract: JSON.parse(readFileSync(`${dir}/host-contract.json`, 'utf8')),
	};
} catch (error) {
	failure = error;
} finally {
	if (networkCreated) {
		try {
			const remaining = run('docker', [
				'ps',
				'-aq',
				'--filter',
				`label=com.blackscale.swarm-n8n.fixture=${network}`,
			]).trim();
			if (remaining) run('docker', ['rm', '-f', ...remaining.split('\n')]);
		} catch (error) {
			cleanupErrors.push(error);
		}
		try {
			run('docker', ['network', 'rm', network]);
		} catch (error) {
			cleanupErrors.push(error);
		}
	}
	for (const path of ['state', 'credentials.json', 'server.key', 'server.crt', 'openssl.conf'])
		try {
			rmSync(`${dir}/${path}`, { recursive: true, force: true });
		} catch (error) {
			cleanupErrors.push(error);
		}
}
if (failure || cleanupErrors.length)
	throw new AggregateError(
		[...(failure ? [failure] : []), ...cleanupErrors],
		'Native acceptance or cleanup did not complete',
	);
copyFileSync(`${dir}/${pack.filename}`, exportPath);
writeFileSync(`${exportPath}.sha256`, `${receipt.packageSha256}  ${pack.filename}\n`);
save('receipt.json', receipt);
console.log(JSON.stringify({ ...receipt, receiptDirectory: dir }, null, 2));
