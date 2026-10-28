import {
	NodeOperationError,
	type ICredentialDataDecryptedObject,
	type IDataObject,
	type IExecuteSingleFunctions,
	type IHttpRequestOptions,
	type IN8nHttpFullResponse,
	type INodeExecutionData,
	type INode,
} from 'n8n-workflow';
import { operations } from './catalog';
import { fieldName, type Operation } from './fields';
import { fieldValue } from './validation';
import { outputFields, selectFields } from './output';

export const origin = 'https://api.swarm.services';
export const requestBounds = {
	timeout: 30000,
	maxResponseBodyBytes: 8 * 1024 * 1024,
	disableFollowRedirect: true,
	maxRedirects: 0,
	sendCredentialsOnCrossOriginRedirect: false,
} satisfies Partial<IHttpRequestOptions>;
const routes = operations.map((operation) => ({
	operation,
	pattern: new RegExp(
		`^${operation.path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[A-Za-z]+\}/g, '[A-Za-z0-9][A-Za-z0-9_:-]{0,127}')}$`,
	),
}));

function resolveRequest(request: IHttpRequestOptions): { target: URL; operation: Operation } {
	const baseURL = request.baseURL || origin;
	if (!URL.canParse(baseURL) || !URL.canParse(request.url, baseURL))
		throw new Error('Swarm credentials can only be used with the verified Swarm API');
	const base = new URL(baseURL),
		target = new URL(request.url, base);
	if (
		base.origin !== origin ||
		base.username ||
		base.password ||
		base.hash ||
		target.origin !== origin ||
		target.username ||
		target.password ||
		target.hash ||
		request.skipSslCertificateValidation ||
		request.proxy
	)
		throw new Error('Swarm credentials can only be used with the verified Swarm API');
	const operation = routes.find(
		(route) =>
			route.operation.method === (request.method || 'GET').toUpperCase() &&
			route.pattern.test(target.pathname),
	)?.operation;
	if (!operation) throw new Error('This Swarm API action is not supported by this node');
	return { target, operation };
}

export async function authenticate(
	credentials: ICredentialDataDecryptedObject,
	request: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const { target, operation } = resolveRequest(request);
	if (operation.writes && credentials.allowWrites !== true)
		throw new Error(
			'Enable Allow Writes on this credential and grant the corresponding Swarm permission before using this action',
		);
	const token = typeof credentials.accessToken === 'string' ? credentials.accessToken.trim() : '';
	if (!token || token.length > 8192 || !/^[A-Za-z0-9._~+/-]+=*$/.test(token))
		throw new Error('A valid Swarm access token is required');
	const cancellation = request.abortSignal;
	if (cancellation && !(cancellation instanceof AbortSignal))
		throw new Error('Unsupported request cancellation signal');
	// n8n binds workflow cancellation before authentication; add the deadline here.
	return {
		...request,
		...requestBounds,
		url: target.href,
		baseURL: origin,
		method: operation.method,
		abortSignal: AbortSignal.any([
			AbortSignal.timeout(requestBounds.timeout),
			...(cancellation ? [cancellation] : []),
		]),
		skipSslCertificateValidation: false,
		allowedDomains: 'api.swarm.services',
		headers: {
			...Object.fromEntries(
				Object.entries(request.headers ?? {}).filter(
					([name]) => name.toLowerCase() !== 'authorization',
				),
			),
			Authorization: `Bearer ${token}`,
		},
	};
}

export async function prepareRequest(
	this: IExecuteSingleFunctions,
	request: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const resource = this.getNodeParameter('resource'),
		operation = operations.find(
			(op) => op.id === this.getNodeParameter('operation') && op.resource === resource,
		);
	if (!operation)
		throw new NodeOperationError(this.getNode(), 'Select a supported Swarm resource and action');
	outputFields.call(this, operation);
	const additional = this.getNodeParameter('additionalFields', {});
	if (!additional || typeof additional !== 'object' || Array.isArray(additional))
		throw new NodeOperationError(this.getNode(), 'Additional Fields must be an object');
	const body: IDataObject = {},
		qs: IDataObject = {};
	let path = operation.path;
	for (const field of operation.fields) {
		const name = fieldName(field);
		const raw = field.required
			? this.getNodeParameter(name, field.initial ?? '', { extractValue: true })
			: Object.hasOwn(additional, name)
				? (additional as Record<string, unknown>)[name]
				: field.initial;
		const value = fieldValue(field, raw, this.getNode());
		if (value === undefined) continue;
		if (field.location === 'path')
			path = path.replace(`{${field.wire}}`, encodeURIComponent(String(value)));
		else if (field.location === 'query') qs[field.wire] = value;
		else body[field.wire] = value;
	}
	if (
		operation.id === 'buildSpaceContextPack' &&
		![body.query, body.objective].some((value) => typeof value === 'string' && value.trim())
	)
		throw new NodeOperationError(this.getNode(), 'Add a Query or Objective in Additional Fields');
	if (operation.id === 'createEvaluation') {
		if (!body.run_id && !body.artifact_id)
			throw new NodeOperationError(
				this.getNode(),
				'Select a Run ID or Artifact ID in Additional Fields',
			);
		const contract =
			typeof body.contract_hash === 'string' &&
			/^[a-f0-9]{64}$/.test(body.contract_hash) &&
			body.dimensions !== undefined;
		if (
			contract
				? body.score !== undefined || body.outcome !== undefined
				: body.contract_hash !== undefined ||
					body.dimensions !== undefined ||
					body.score === undefined ||
					body.outcome === undefined
		)
			throw new NodeOperationError(
				this.getNode(),
				'Supply Outcome and Score, or the Run scoring contract hash and Dimension Scores, but not both',
			);
	}
	const headers = { Accept: 'application/json', 'Content-Type': 'application/json' } as Record<
		string,
		string
	>;
	if (operation.writes) {
		const key = this.getNodeParameter('requestKey', '');
		if (typeof key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key))
			throw new NodeOperationError(
				this.getNode(),
				'Request Key must be 8 to 128 safe characters and stay the same for retries',
			);
		headers['Idempotency-Key'] = key;
	}
	return {
		...request,
		...requestBounds,
		url: path,
		baseURL: origin,
		method: operation.method,
		qs,
		headers,
		...(operation.method !== 'GET' ? { body } : {}),
		json: true,
	};
}

export async function receiveResponse(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	const operation = operations.find((op) => op.id === this.getNodeParameter('operation'));
	if (!operation) throw new NodeOperationError(this.getNode(), 'Select a supported Swarm action');
	const fields = outputFields.call(this, operation);
	const pairedItem = { item: this.getItemIndex() };
	if (!operation.page)
		return items.map((item) => ({ ...item, json: selectFields(item.json, fields), pairedItem }));
	const records = responseRecords(response, 100, this.getNode());
	const nextCursor = responseCursor(response, this.getNode()) ?? null;
	if (this.getNodeParameter('outputMode', 'records') === 'page')
		return [
			{
				pairedItem,
				json: {
					items: records.map((record) => selectFields(record, fields)),
					nextCursor,
					hasMore: nextCursor !== null,
				},
			},
		];
	return records.map((record) => ({ json: selectFields(record, fields), pairedItem }));
}

export function responseRecords(
	response: IN8nHttpFullResponse,
	limit: number,
	node: INode,
): IDataObject[] {
	if (!Array.isArray(response.body))
		throw new NodeOperationError(node, 'Swarm returned an unexpected list response');
	if (response.body.length > limit)
		throw new NodeOperationError(
			node,
			`More than ${limit} results were returned; narrow the selection`,
		);
	const records: unknown[] = response.body;
	if (
		!records.every(
			(value): value is IDataObject =>
				!!value && typeof value === 'object' && !Array.isArray(value),
		)
	)
		throw new NodeOperationError(node, 'Swarm returned an unexpected list response');
	return records;
}

export function responseCursor(response: IN8nHttpFullResponse, node: INode): string | undefined {
	const cursor = response.headers['x-next-cursor'] ?? response.headers['X-Next-Cursor'];
	if (cursor === undefined || cursor === '') return undefined;
	if (typeof cursor !== 'string' || cursor.length > 2048 || /[^\x20-\x7e]/.test(cursor))
		throw new NodeOperationError(node, 'Swarm returned an invalid pagination cursor');
	return cursor;
}
