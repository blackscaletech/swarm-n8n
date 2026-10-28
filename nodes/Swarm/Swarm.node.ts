import {
	NodeConnectionTypes,
	NodeOperationError,
	type INodeType,
	type INodeTypeDescription,
	type ILoadOptionsFunctions,
	type IN8nHttpFullResponse,
} from 'n8n-workflow';
import { properties } from './properties';
import { origin, requestBounds, responseRecords, responseCursor } from './request';
import { identifier } from './validation';

export class Swarm implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Swarm',
		name: 'swarm',
		icon: { light: 'file:swarm.svg', dark: 'file:swarm.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Use shared knowledge, context and work in Swarm Spaces',
		defaults: {
			name: 'Swarm',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'swarmApi', required: true }],
		requestDefaults: {
			baseURL: origin,
			...requestBounds,
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
		},
		properties,
	};
	methods = {
		listSearch: {
			async searchSpaces(this: ILoadOptionsFunctions, filter = '', paginationToken?: string) {
				if (filter.length > 255 || (paginationToken?.length ?? 0) > 2048)
					throw new NodeOperationError(this.getNode(), 'Space search is too long');
				const response = (await this.helpers.httpRequestWithAuthentication.call(this, 'swarmApi', {
					url: `${origin}/v1/spaces`,
					qs: { limit: 50, ...(paginationToken ? { cursor: paginationToken } : {}) },
					json: true,
					returnFullResponse: true,
					...requestBounds,
				})) as IN8nHttpFullResponse;
				const spaces = responseRecords(response, 50, this.getNode()).map((space) => {
					if (typeof space.name !== 'string' || !space.name.trim() || space.name.length > 1024)
						throw new NodeOperationError(this.getNode(), 'Swarm returned an unexpected Space name');
					return { name: space.name, value: identifier(space.id, 'Space ID', this.getNode()) };
				});
				return {
					results: spaces.filter((space) =>
						space.name.toLowerCase().includes(filter.toLowerCase()),
					),
					paginationToken: responseCursor(response, this.getNode()),
				};
			},
		},
	};
}
