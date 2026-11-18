import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { Swarm } = require('../dist/nodes/Swarm/Swarm.node.js');
const { operations } = require('../dist/nodes/Swarm/catalog.js');
const { paginate, resultLimit } = require('../dist/nodes/Swarm/pagination.js');
const { prepareRequest, receiveResponse } = require('../dist/nodes/Swarm/request.js');
const node = { id: 'synthetic', name: 'Swarm', typeVersion: 2, parameters: {} };
function context(parameters = {}, controller = new AbortController()) {
	const values = {
		resource: 'space',
		operation: 'listSpaces',
		additionalFields: {},
		...parameters,
	};
	return {
		getNode: () => node,
		getNodeParameter: (name, fallback) => values[name] ?? fallback,
		getItemIndex: () => 3,
		getExecutionCancelSignal: () => controller.signal,
	};
}
function request() {
	return { options: { url: '/v1/spaces', qs: { order: 'desc' } }, preSend: [], postReceive: [] };
}

test('new node version exposes standard pagination and no cursor controls or notices', () => {
	const properties = new Swarm().description.properties;
	assert.deepEqual(new Swarm().description.version, [1, 2]);
	assert(!properties.some((p) => p.type === 'notice'));
	for (const op of operations.filter((op) => op.fields.some((f) => f.wire === 'cursor'))) {
		const fields = properties.filter(
			(p) =>
				p.displayOptions?.show?.operation?.includes(op.id) &&
				p.displayOptions.show['@version']?.includes(2),
		);
		assert(fields.some((p) => p.name === 'returnAll' && p.default === false));
		assert(fields.some((p) => p.name === 'limit' && p.displayOptions.show.returnAll[0] === false));
		assert(!fields.some((p) => p.name === 'outputMode' || p.name === 'cursor'));
		assert(!fields.some((p) => p.options?.some((f) => f.name === 'cursor')));
	}
});

test('new lists validate total limits and do not accept user cursors; selected Tasks stay unpaginated', async () => {
	const ctx = context({ limit: 250, additionalFields: { order: 'desc', cursor: 'ignored' } });
	const prepared = await prepareRequest.call(ctx, { url: '/v1/spaces' });
	assert.deepEqual(prepared.qs, { order: 'desc', limit: 100 });
	for (const parameters of [{ returnAll: 'true' }, { limit: 0 }, { limit: 10001 }, { limit: 1.5 }])
		assert.throws(() => resultLimit.call(context(parameters)));
	const selected = await prepareRequest.call(
		context({
			resource: 'task',
			operation: 'listTasks',
			spaceId: 'sp_synthetic',
			taskIds: 'task_a,task_b',
		}),
		{ url: '/v1/tasks' },
	);
	assert.equal(selected.qs.limit, undefined);
	assert.equal(selected.qs.cursor, undefined);
});

test('native routing follows empty pages sequentially, preserves filters and item pairing, and honors total Limit', async () => {
	for (const [parameters, expected, expectedCalls] of [
		[{ returnAll: true }, 3, 3],
		[{ limit: 2 }, 2, 2],
	]) {
		const ctx = context(parameters);
		let calls = 0;
		ctx.makeRoutingRequest = async (data) => {
			assert.equal(data.options.qs.order, 'desc');
			assert.equal(data.options.qs.cursor, calls ? `page-${calls}` : undefined);
			assert(data.options.qs.limit > 0 && data.options.qs.limit <= 100);
			const page = [[], [{ id: 'sp_a' }, { id: 'sp_b' }], [{ id: 'sp_c' }]][calls++];
			return receiveResponse.call(ctx, [], {
				body: page,
				headers: calls < 3 ? { 'x-next-cursor': `page-${calls}` } : {},
			});
		};
		const output = await paginate.call(ctx, request());
		assert.equal(output.length, expected);
		assert.equal(calls, expectedCalls);
		assert(output.every((item) => item.pairedItem.item === 3));
		assert(!output.some((item) => 'nextCursor' in item.json));
	}
});

test('pagination rejects cycles and cancels before another request', async () => {
	const ctx = context({ returnAll: true });
	let calls = 0;
	ctx.makeRoutingRequest = async () => {
		calls++;
		return receiveResponse.call(ctx, [], { body: [], headers: { 'x-next-cursor': 'same' } });
	};
	await assert.rejects(paginate.call(ctx, request()), /repeated pagination cursor/);
	assert.equal(calls, 2);
	const controller = new AbortController();
	const canceled = context({ returnAll: true }, controller);
	calls = 0;
	canceled.makeRoutingRequest = async () => {
		calls++;
		controller.abort();
		return receiveResponse.call(canceled, [], {
			body: [{ id: 'sp_a' }],
			headers: { 'x-next-cursor': 'next' },
		});
	};
	await assert.rejects(paginate.call(canceled, request()), /abort/i);
	assert.equal(calls, 1);
});
