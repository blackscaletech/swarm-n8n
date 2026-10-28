// Synthetic HTTPS peer for offline n8n acceptance. Never a production transport.
import https from 'node:https';
import { appendFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const { operations } = require('/candidate/dist/nodes/Swarm/catalog.js');
const receipts = new Map();
https
	.createServer(
		{ key: readFileSync('/fixture/server.key'), cert: readFileSync('/fixture/server.crt') },
		async (req, res) => {
			let raw = '';
			for await (const chunk of req) raw += chunk;
			const body = raw ? JSON.parse(raw) : {};
			const url = new URL(req.url, 'https://api.swarm.services');
			appendFileSync(
				'/fixture/requests.jsonl',
				JSON.stringify({ request: true, method: req.method, path: url.pathname }) + '\n',
			);
			const reply = (status, value, headers = {}) => {
				res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
				res.end(JSON.stringify(value));
			};
			if (url.pathname === '/llm/v1/chat/completions') {
				const followup = body.messages.some((message) => message.role === 'tool');
				appendFileSync(
					'/fixture/requests.jsonl',
					JSON.stringify({ modelStub: true, followup }) + '\n',
				);
				const message = followup
					? { role: 'assistant', content: 'The approved support context is available.' }
					: {
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: 'call_synthetic',
									type: 'function',
									function: {
										name: body.tools[0].function.name,
										arguments: JSON.stringify({ query: 'Customer rollout checklist' }),
									},
								},
							],
						};
				return reply(200, {
					id: 'chatcmpl-synthetic',
					object: 'chat.completion',
					created: 1,
					model: 'synthetic-model',
					choices: [{ index: 0, message, finish_reason: followup ? 'stop' : 'tool_calls' }],
					usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
				});
			}
			const op = operations.find(
				(op) =>
					op.method === req.method &&
					new RegExp(
						`^${op.path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[A-Za-z]+\}/g, '[A-Za-z0-9_:-]+')}$`,
					).test(url.pathname),
			);
			if (!op) return reply(404, { error: 'Unknown synthetic route' });
			const token = req.headers.authorization;
			if (!['Bearer synthetic-viewer', 'Bearer synthetic-writer'].includes(token))
				return reply(401, { error: 'Connection is no longer authorized' });
			if (op.writes && token !== 'Bearer synthetic-writer')
				return reply(403, { error: 'This connection is read-only' });
			if (op.writes && !req.headers['idempotency-key'])
				return reply(400, { error: 'Missing Request Key' });
			if (
				op.id === 'buildSpaceContextPack' &&
				![body.query, body.objective].some((value) => typeof value === 'string' && value.trim())
			)
				return reply(400, { error: 'Query or objective is required' });
			if (
				op.id === 'askSpace' &&
				body.desired_output_shape &&
				!['brief_with_rationale', 'answer_with_lineage', 'gaps_and_next_steps'].includes(
					body.desired_output_shape,
				)
			)
				return reply(400, { error: 'Invalid output shape' });
			const key = op.writes ? `${op.id}:${req.headers['idempotency-key']}` : undefined;
			if (key && receipts.has(key) && receipts.get(key) !== raw)
				return reply(409, { error: 'Request Key input conflict' });
			if (key) receipts.set(key, raw);
			appendFileSync(
				'/fixture/requests.jsonl',
				JSON.stringify({
					operation: op.id,
					method: req.method,
					path: url.pathname,
					query: Object.fromEntries(url.searchParams),
					body,
					requestKey: req.headers['idempotency-key'] ?? null,
				}) + '\n',
			);
			if (url.searchParams.get('q') === 'simulate-redirect')
				return reply(302, {}, { Location: 'https://example.com/should-not-receive-a-token' });
			if (url.searchParams.get('q') === 'simulate-rate-limit')
				return reply(429, { error: 'Slow down' }, { 'Retry-After': '1' });
			if (url.searchParams.get('q') === 'simulate-oversize')
				return reply(200, [{ body: 'x'.repeat(9 * 1024 * 1024) }]);
			if (url.searchParams.get('q') === 'simulate-compressed-oversize') {
				res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' });
				res.end(gzipSync(JSON.stringify([{ body: 'x'.repeat(9 * 1024 * 1024) }])));
				return;
			}
			if (url.searchParams.get('q') === 'simulate-slow') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.write('[');
				const timer = setInterval(() => res.write(' '), 1000);
				res.on('close', () => clearInterval(timer));
				return;
			}
			const result = {
				id: `synthetic_${op.resource}${url.searchParams.get('cursor') === 'synthetic-next-page' ? '_next' : ''}`,
				name: 'Customer Support',
				space_id: 'sp_synthetic',
				updated_at: '2026-10-27T12:00:00Z',
				body: 'Approved customer rollout checklist',
				status: 'succeeded',
			};
			if (op.page) {
				if (url.searchParams.get('cursor') === 'synthetic-empty') return reply(200, []);
				if (url.searchParams.get('cursor') === 'synthetic-multiple')
					return reply(200, [
						{ id: 'sp_first', name: 'First' },
						{ id: 'sp_second', name: 'Second' },
					]);
				const paginated = op.fields.some((field) => field.wire === 'cursor');
				return reply(
					200,
					[result],
					paginated && !url.searchParams.has('cursor')
						? { 'X-Next-Cursor': 'synthetic-next-page' }
						: {},
				);
			}
			return reply(op.method === 'POST' && op.writes ? 201 : 200, result);
		},
	)
	.listen(443, '0.0.0.0', () => console.log('Synthetic HTTPS fixture ready'));
