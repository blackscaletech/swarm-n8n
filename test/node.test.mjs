import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { operations, resources } = require('../dist/nodes/Swarm/catalog.js');
const { fieldName } = require('../dist/nodes/Swarm/fields.js');
const { fieldValue } = require('../dist/nodes/Swarm/validation.js');
const {
	authenticate,
	origin,
	prepareRequest,
	receiveResponse,
	requestBounds,
} = require('../dist/nodes/Swarm/request.js');
const { Swarm } = require('../dist/nodes/Swarm/Swarm.node.js');
const { SwarmApi } = require('../dist/credentials/SwarmApi.credentials.js');
const node = {
	id: 'synthetic',
	name: 'Swarm',
	type: '@blackscaletech/n8n-nodes-swarm.swarm',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};
const credentials = { accessToken: 'synthetic-test-token-not-a-secret', allowWrites: true };
const example = (field) =>
	field.initial ??
	(field.choices
		? field.choices[0]
		: field.kind === 'id'
			? 'id_synthetic'
			: field.kind === 'csv'
				? 'task_a,task_b'
				: field.kind === 'ids'
					? ['art_source']
					: field.kind === 'strings'
						? ['Use approved sources']
						: field.kind === 'scores'
							? { accuracy: 80 }
							: field.kind === 'number'
								? 80
								: field.kind === 'boolean'
									? false
									: ['expected_updated_at', 'start_at', 'end_at'].includes(field.wire)
										? '2026-10-27T12:00:00Z'
										: field.wire === 'resource_type'
											? 'artifact'
											: 'Synthetic example');
function context(op, overrides = {}) {
	const params = {
		resource: op.resource,
		operation: op.id,
		requestKey: 'case:123:report:v1',
		additionalFields: {},
	};
	for (const field of op.fields) {
		if (['contract_hash', 'dimensions'].includes(field.wire)) continue;
		(field.required ? params : params.additionalFields)[fieldName(field)] = example(field);
	}
	Object.assign(params, overrides);
	return {
		getNode: () => node,
		getItemIndex: () => 0,
		getExecutionCancelSignal: () => undefined,
		getNodeParameter: (name, fallback) => params[name] ?? fallback,
	};
}

test('native node and credential expose only the reviewed surface', () => {
	assert.equal(operations.length, 31);
	assert.equal(new Set(operations.map((op) => op.id)).size, operations.length);
	assert.equal(resources.length, 8);
	assert(
		operations.every(
			(op) =>
				!/admin|billing|credential|invitation|approval|lease|dispatch|:launch|:cancel|\/process/.test(
					op.path,
				),
		),
	);
	const description = new Swarm().description;
	assert.equal(description.usableAsTool, true);
	assert.equal(new Swarm().execute, undefined, 'Use native declarative execution');
	const credential = new SwarmApi();
	assert.equal(credential.restrictToSupportedNodes, true);
	assert.equal(credential.properties.find((p) => p.name === 'allowWrites').default, false);
	assert.equal(
		credential.properties.find((p) => p.name === 'accessToken').typeOptions.password,
		true,
	);
	for (const resource of resources) {
		const ui = description.properties.find(
			(p) => p.name === 'operation' && p.displayOptions?.show.resource.includes(resource.value),
		);
		assert.deepEqual(
			ui.options.map((p) => p.value).sort(),
			operations
				.filter((op) => op.resource === resource.value)
				.map((op) => op.id)
				.sort(),
		);
		assert(
			operations.some((op) => op.id === ui.default && op.resource === resource.value && !op.writes),
		);
	}
});

for (const op of operations)
	test(`${op.id}: field mapping, native routing, authority and request bounds`, async () => {
		const ctx = context(op);
		const request = await prepareRequest.call(ctx, { url: op.path });
		const authenticated = await authenticate(credentials, request);
		assert.equal(authenticated.baseURL, origin);
		assert.equal(authenticated.method, op.method);
		assert.equal(authenticated.headers.Authorization, `Bearer ${credentials.accessToken}`);
		assert.equal(authenticated.allowedDomains, 'api.swarm.services');
		assert.equal(authenticated.skipSslCertificateValidation, false);
		for (const [key, value] of Object.entries(requestBounds))
			assert.equal(authenticated[key], value);
		for (const field of op.fields) {
			if (['contract_hash', 'dimensions'].includes(field.wire)) continue;
			const expected = fieldValue(field, example(field), node);
			if (field.location === 'path') assert(request.url.includes(String(expected)));
			else
				assert.deepEqual(request[field.location === 'body' ? 'body' : 'qs'][field.wire], expected);
		}
		if (op.writes) {
			await assert.rejects(
				authenticate({ ...credentials, allowWrites: false }, request),
				/Allow Writes/,
			);
			assert.equal(request.headers['Idempotency-Key'], 'case:123:report:v1');
			const replay = await prepareRequest.call(ctx, { url: op.path });
			assert.deepEqual(
				{ ...replay, abortSignal: undefined },
				{ ...request, abortSignal: undefined },
				'Replay keeps the request and key unchanged',
			);
			await assert.rejects(
				prepareRequest.call(context(op, { requestKey: 'short' }), { url: op.path }),
				/Request Key/,
			);
		} else {
			assert.equal(request.headers['Idempotency-Key'], undefined);
			await authenticate({ ...credentials, allowWrites: false }, request);
		}
	});

test('bearer authentication never follows an arbitrary or unsafe destination', async () => {
	const requests = [
		{ url: 'https://example.com/v1/spaces' },
		{ url: '//example.com/v1/spaces' },
		{ url: '/v1/spaces', baseURL: 'https://example.com' },
		{ url: 'http://api.swarm.services/v1/spaces' },
		{ url: 'https://owner:password@api.swarm.services/v1/spaces' },
		{ url: 'https://api.swarm.services:444/v1/spaces' },
		{ url: '/v1/spaces', skipSslCertificateValidation: true },
		{ url: '/v1/spaces', proxy: { host: 'example.com', port: 443 } },
		{ url: '/v1/spaces#fragment' },
		{ url: '/v1/spaces/sp_synthetic/credentials', method: 'POST' },
		{ url: '/v1/artifacts/art_a%2fb/content' },
		{ url: '/v1/spaces', method: 'DELETE' },
	];
	for (const request of requests) await assert.rejects(authenticate(credentials, request));
	await assert.rejects(
		authenticate({ accessToken: 'invalid\r\nvalue' }, { url: '/v1/spaces' }),
		/valid Swarm access token/,
	);
	await assert.rejects(authenticate({ accessToken: '' }, { url: '/v1/spaces' }));
	for (const accessToken of ['not a token', 'x'.repeat(8193), 'token\u0000value'])
		await assert.rejects(
			authenticate({ accessToken }, { url: '/v1/spaces' }),
			/valid Swarm access token/,
		);
	const trimmed = await authenticate(
		{ accessToken: `  ${credentials.accessToken}\n` },
		{ url: '/v1/spaces' },
	);
	assert.equal(trimmed.headers.Authorization, `Bearer ${credentials.accessToken}`);
	const bounded = await authenticate(credentials, {
		url: '/v1/spaces',
		maxRedirects: 5,
		disableFollowRedirect: false,
		timeout: 0,
	});
	assert.equal(bounded.maxRedirects, 0);
	assert.equal(bounded.disableFollowRedirect, true);
	const canonical = await authenticate(credentials, {
		url: '/v1/spaces',
		baseURL: `${origin}/unexpected-prefix?ignored=1`,
		headers: { Authorization: 'previous', authorization: 'stale', aUtHoRiZaTiOn: 'stale' },
	});
	assert.equal(canonical.url, `${origin}/v1/spaces`);
	assert.equal(canonical.baseURL, origin);
	assert.deepEqual(canonical.headers, { Authorization: `Bearer ${credentials.accessToken}` });
	await assert.rejects(
		authenticate(credentials, { url: 'https://[synthetic-invalid-url' }),
		(error) => !error.message.includes('synthetic-invalid-url'),
	);
});

test('invalid inputs fail before HTTP without echoing supplied content', async () => {
	for (const [field, value] of [
		[{ kind: 'id' }, '../../admin'],
		[{ kind: 'number', min: 1, max: 100 }, 101],
		[{ kind: 'number' }, NaN],
		[{ kind: 'boolean' }, 'true'],
		[{ kind: 'ids', max: 2 }, '["id_a","id_b","id_c"]'],
		[{ kind: 'ids' }, '["id_a",'],
		[{ kind: 'ids' }, ' '.repeat(65537)],
		[{ kind: 'csv' }, ['task_synthetic']],
		[{ kind: 'scores' }, '{"__proto__":100}'],
		[{ kind: 'scores' }, { quality: 101 }],
		[{ kind: 'text', max: 5 }, 'ééé'],
		[{ kind: 'text', choices: ['pass'] }, 'unknown'],
		[{ kind: 'text', wire: 'expected_updated_at' }, 'not-a-date'],
		[{ kind: 'text', wire: 'start_at' }, '2026-10-27'],
		[{ kind: 'text', wire: 'end_at' }, '2026-10-27T12:00:00'],
		[{ kind: 'text', wire: 'start_at' }, '2026-99-27T12:00:00Z'],
		[{ kind: 'text', wire: 'start_at' }, '2026-02-30T12:00:00Z'],
		[{ kind: 'text', wire: 'start_at' }, '2100-02-29T12:00:00Z'],
		[{ kind: 'text', wire: 'end_at' }, '2026-04-31T12:00:00Z'],
		[{ kind: 'text', wire: 'end_at' }, '2026-10-27T24:00:00Z'],
	]) {
		assert.throws(() =>
			fieldValue({ wire: 'input', label: 'Input', location: 'body', ...field }, value, node),
		);
	}
	const op = operations.find((op) => op.id === 'createArtifact');
	const ctx = context(op, { body: 'x'.repeat(262145) });
	await assert.rejects(prepareRequest.call(ctx, { url: op.path }), /size limit/);
	let coerced = false;
	assert.throws(
		() =>
			fieldValue(
				{ wire: 'task_ids', label: 'Task IDs', kind: 'csv', location: 'query', max: 40 },
				{
					toString() {
						coerced = true;
						return 'task_synthetic';
					},
				},
				node,
			),
		/comma-separated text/,
	);
	assert.equal(coerced, false, 'Reject non-string Task IDs before invoking conversion');
	for (const value of [
		'2000-02-29T12:00:00Z',
		'2400-02-29T12:00:00Z',
		'0000-02-29T12:00:00Z',
		'2026-10-27T12:00:00.123456789+05:30',
	])
		assert.equal(
			fieldValue(
				{ wire: 'start_at', label: 'Start Time', kind: 'text', location: 'query' },
				value,
				node,
			),
			value,
			'Valid timestamps retain their original precision and offset',
		);
});

test('optional fields are explicit objects and never inherited', async () => {
	const op = operations.find((op) => op.id === 'listSpaces');
	for (const additionalFields of ['unexpected', []])
		await assert.rejects(
			prepareRequest.call(context(op, { additionalFields }), { url: op.path }),
			/must be an object/,
		);
	const request = await prepareRequest.call(
		context(op, {
			additionalFields: Object.create({ cursor: 'inherited-cursor' }),
		}),
		{ url: op.path },
	);
	assert.equal(request.qs.cursor, undefined);
});

test('context packs require a query or objective and memory output shapes match the service', async () => {
	const contextOp = operations.find((op) => op.id === 'buildSpaceContextPack');
	for (const additionalFields of [{}, { query: '  ', objective: '\n' }])
		await assert.rejects(
			prepareRequest.call(context(contextOp, { additionalFields }), { url: contextOp.path }),
			/Query or Objective/,
		);
	for (const additionalFields of [
		{ query: 'Approved rollout' },
		{ objective: 'Prepare a brief' },
	]) {
		const request = await prepareRequest.call(context(contextOp, { additionalFields }), {
			url: contextOp.path,
		});
		assert(Object.entries(additionalFields).every(([key, value]) => request.body[key] === value));
	}
	const ask = operations.find((op) => op.id === 'askSpace');
	for (const desiredOutputShape of [
		'brief_with_rationale',
		'answer_with_lineage',
		'gaps_and_next_steps',
	]) {
		const request = await prepareRequest.call(
			context(ask, { additionalFields: { desiredOutputShape } }),
			{ url: ask.path },
		);
		assert.equal(request.body.desired_output_shape, desiredOutputShape);
	}
	await assert.rejects(
		prepareRequest.call(
			context(ask, { additionalFields: { desiredOutputShape: 'custom report' } }),
			{
				url: ask.path,
			},
		),
		/not an allowed choice/,
	);
});

test('evaluation supports both public scoring alternatives without ambiguity', async () => {
	const op = operations.find((op) => op.id === 'createEvaluation');
	const req = await prepareRequest.call(
		context(op, {
			additionalFields: {
				runId: 'run_synthetic',
				contractHash: 'a'.repeat(64),
				dimensions: { accuracy: 80 },
			},
		}),
		{ url: op.path },
	);
	assert.deepEqual(req.body.dimensions, { accuracy: 80 });
	await assert.rejects(
		prepareRequest.call(
			context(op, {
				additionalFields: {
					runId: 'run_synthetic',
					contractHash: 'a'.repeat(64),
					dimensions: { accuracy: 80 },
					score: 80,
				},
			}),
			{ url: op.path },
		),
		/not both/,
	);
	await assert.rejects(
		prepareRequest.call(context(op, { additionalFields: { artifactId: 'art_synthetic' } }), {
			url: op.path,
		}),
		/Outcome and Score/,
	);
	await assert.rejects(
		prepareRequest.call(context(op, { additionalFields: {} }), { url: op.path }),
		/Run ID or Artifact ID/,
	);
});

test('pagination preserves empty pages and cursors without fetching another page', async () => {
	const op = operations.find((op) => op.id === 'listSpaces');
	const ctx = context(op, { outputMode: 'page' });
	const data = [{ json: { id: 'sp_synthetic' } }];
	assert.deepEqual(
		await receiveResponse.call(ctx, data, {
			body: data.map((d) => d.json),
			headers: { 'x-next-cursor': 'opaque-cursor' },
		}),
		[
			{
				json: { items: [{ id: 'sp_synthetic' }], nextCursor: 'opaque-cursor', hasMore: true },
				pairedItem: { item: 0 },
			},
		],
	);
	assert.deepEqual(
		await receiveResponse.call(ctx, [], { body: [], headers: { 'x-next-cursor': '' } }),
		[{ json: { items: [], nextCursor: null, hasMore: false }, pairedItem: { item: 0 } }],
	);
	assert.deepEqual(
		await receiveResponse.call(context(op), data, { body: [data[0].json], headers: {} }),
		[{ json: data[0].json, pairedItem: { item: 0 } }],
	);
	assert.deepEqual(
		await receiveResponse.call(context(op), [{ json: [data[0].json] }], {
			body: [data[0].json],
			headers: {},
		}),
		[{ json: data[0].json, pairedItem: { item: 0 } }],
		'Native post-receive wraps arrays; Records must emit the actual body records',
	);
	assert.deepEqual(
		await receiveResponse.call(context(op), [{ json: [] }], { body: [], headers: {} }),
		[],
	);
	await assert.rejects(
		receiveResponse.call(ctx, [], { body: Array(101).fill({}), headers: {} }),
		/100/,
	);
	await assert.rejects(receiveResponse.call(ctx, [], { body: {}, headers: {} }), /unexpected list/);
	for (const body of [[null], ['not a record'], [[]]])
		await assert.rejects(receiveResponse.call(ctx, [], { body, headers: {} }), /unexpected list/);
	for (const cursor of [17, ['cursor'], 'x'.repeat(2049), 'cursor\n'])
		await assert.rejects(
			receiveResponse.call(ctx, [], { body: [], headers: { 'x-next-cursor': cursor } }),
			/invalid pagination cursor/,
		);
});

test('Space picker makes one bounded authenticated request', async () => {
	let calls = 0;
	const ctx = {
		getNode: () => node,
		helpers: {
			async httpRequestWithAuthentication(name, request) {
				calls++;
				assert.equal(name, 'swarmApi');
				assert.equal(request.qs.limit, 50);
				assert.equal(request.qs.cursor, 'second-page');
				return {
					body: [{ id: 'sp_a', name: 'Customer Support' }],
					headers: { 'x-next-cursor': 'next-page' },
				};
			},
		},
	};
	const result = await new Swarm().methods.listSearch.searchSpaces.call(
		ctx,
		'support',
		'second-page',
	);
	assert.equal(calls, 1);
	assert.deepEqual(result, {
		results: [{ name: 'Customer Support', value: 'sp_a' }],
		paginationToken: 'next-page',
	});
	for (const body of [
		[{ id: 'sp_a', name: null }],
		[{ id: '../admin', name: 'Invalid' }],
		[null],
		Array(51).fill({}),
	]) {
		ctx.helpers.httpRequestWithAuthentication = async () => ({ body, headers: {} });
		await assert.rejects(new Swarm().methods.listSearch.searchSpaces.call(ctx));
	}
});

test('response field selection preserves identity, trust, cursors and item links', async () => {
	const op = operations.find((op) => op.id === 'getTask');
	const data = [
		{
			json: {
				id: 'task_a',
				space_id: 'sp_a',
				title: 'Support brief',
				status: 'queued',
				text_trust: { source: 'untrusted' },
			},
			pairedItem: { item: 2 },
		},
	];
	const response = { body: data[0].json, headers: {} };
	const linkedContext = (overrides = {}) => ({ ...context(op, overrides), getItemIndex: () => 2 });
	assert.deepEqual(await receiveResponse.call(linkedContext(), data, response), data);
	const selected = await receiveResponse.call(
		linkedContext({ responseFields: 'selected', fieldsToInclude: 'title' }),
		data,
		response,
	);
	assert.deepEqual(selected, [
		{
			json: {
				id: 'task_a',
				space_id: 'sp_a',
				text_trust: data[0].json.text_trust,
				title: 'Support brief',
			},
			pairedItem: { item: 2 },
		},
	]);
	assert.equal(data[0].json.status, 'queued', 'Projection must not mutate the original output');
	const simple = await receiveResponse.call(
		linkedContext({ responseFields: 'simplified' }),
		data,
		response,
	);
	assert.equal(simple[0].json.status, 'queued');
	const list = operations.find((op) => op.id === 'listSpaces');
	const page = await receiveResponse.call(
		context(list, { responseFields: 'selected', fieldsToInclude: 'name', outputMode: 'page' }),
		[],
		{
			body: [{ id: 'sp_a', name: 'Support', description: 'Private context' }],
			headers: { 'x-next-cursor': 'next' },
		},
	);
	assert.deepEqual(page, [
		{
			json: { items: [{ id: 'sp_a', name: 'Support' }], nextCursor: 'next', hasMore: true },
			pairedItem: { item: 0 },
		},
	]);
	const write = operations.find((op) => op.id === 'createTask');
	await assert.rejects(
		prepareRequest.call(context(write, { responseFields: 'unsupported' }), { url: write.path }),
		/Response Fields/,
	);
	for (const fieldsToInclude of [
		'',
		'__proto__',
		'constructor',
		'a.b',
		'title,,status',
		['title'],
		'x'.repeat(2049),
		Array(33).fill('title').join(','),
	])
		await assert.rejects(
			prepareRequest.call(context(write, { responseFields: 'selected', fieldsToInclude }), {
				url: write.path,
			}),
		);
});

test('workflow cancellation is preserved by credential authentication', async () => {
	const op = operations.find((op) => op.id === 'getSpace');
	const controller = new AbortController();
	const request = await prepareRequest.call(context(op), { url: op.path });
	request.abortSignal = controller.signal;
	const authenticated = await authenticate(credentials, request);
	assert.equal(authenticated.abortSignal.aborted, false);
	controller.abort();
	assert.equal(authenticated.abortSignal.aborted, true);
});
