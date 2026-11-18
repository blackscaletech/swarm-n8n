import {
	NodeOperationError,
	type DeclarativeRestApiSettings,
	type IExecutePaginationFunctions,
	type IExecuteSingleFunctions,
	type INodeExecutionData,
} from 'n8n-workflow';

const pages = new WeakMap<INodeExecutionData[], { cursor?: string; bytes: number }>();
const maxPages = 1000;
const maxBytes = 64 * 1024 * 1024;

export function rememberPage(
	items: INodeExecutionData[],
	cursor: string | undefined,
	body: unknown,
) {
	pages.set(items, { cursor, bytes: Buffer.byteLength(JSON.stringify(body)) });
}

export function resultLimit(this: IExecuteSingleFunctions): number {
	const all = this.getNodeParameter('returnAll', false);
	if (typeof all !== 'boolean')
		throw new NodeOperationError(this.getNode(), 'Return All must be a boolean');
	if (all) return Infinity;
	const limit = this.getNodeParameter('limit', 50);
	if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 10000)
		throw new NodeOperationError(this.getNode(), 'Limit must be between 1 and 10000');
	return limit;
}

export async function paginate(
	this: IExecutePaginationFunctions,
	request: DeclarativeRestApiSettings.ResultOptions,
): Promise<INodeExecutionData[]> {
	// Saved version 1 workflows retain their explicit single-page contract.
	if (this.getNode().typeVersion === 1) return this.makeRoutingRequest(request);
	const limit = resultLimit.call(this);
	const cancellation = this.getExecutionCancelSignal();
	const existingSignal = request.options.abortSignal;
	if (existingSignal && !(existingSignal instanceof AbortSignal))
		throw new NodeOperationError(this.getNode(), 'Unsupported request cancellation signal');
	const signal = AbortSignal.any([
		AbortSignal.timeout(300000),
		...(cancellation ? [cancellation] : []),
		...(existingSignal ? [existingSignal] : []),
	]);
	request.options = { ...request.options, abortSignal: signal, qs: { ...request.options.qs } };
	const output: INodeExecutionData[] = [];
	const seen = new Set<string>();
	let bytes = 0;
	for (let count = 0; count < maxPages; count++) {
		signal.throwIfAborted();
		request.options.qs = { ...request.options.qs, limit: Math.min(100, limit - output.length) };
		const items = await this.makeRoutingRequest(request);
		const page = pages.get(items);
		if (!page)
			throw new NodeOperationError(this.getNode(), 'Swarm pagination response is unavailable');
		bytes += page.bytes;
		if (bytes > maxBytes)
			throw new NodeOperationError(
				this.getNode(),
				'Results exceed 64 MiB; use a Limit or narrower filters',
			);
		output.push(...items.slice(0, limit - output.length));
		if (output.length >= limit || !page.cursor) return output;
		if (seen.has(page.cursor))
			throw new NodeOperationError(this.getNode(), 'Swarm returned a repeated pagination cursor');
		seen.add(page.cursor);
		request.options.qs.cursor = page.cursor;
	}
	throw new NodeOperationError(
		this.getNode(),
		'Results exceed 1000 pages; use a Limit or narrower filters',
	);
}
