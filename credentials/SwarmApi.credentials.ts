import type { ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';
import { authenticate, origin, requestBounds } from '../nodes/Swarm/request';

export class SwarmApi implements ICredentialType {
	name = 'swarmApi';

	displayName = 'Swarm API';
	icon = { light: 'file:../nodes/Swarm/swarm.svg', dark: 'file:../nodes/Swarm/swarm.svg' } as const;

	documentationUrl = 'https://swarm.services/guide/connect';
	supportedNodes = [
		'@blackscaletech/n8n-nodes-swarm.swarm',
		'@blackscaletech/n8n-nodes-swarm.swarmTool',
	];
	restrictToSupportedNodes = true as const;

	properties: INodeProperties[] = [
		{
			displayName: 'Access Token',
			name: 'accessToken',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
		},
		{
			displayName: 'Allow Writes',
			name: 'allowWrites',
			type: 'boolean',
			default: false,
			description:
				'Whether this credential may create or update work. The token must also have the corresponding permission in Swarm.',
		},
	];

	authenticate = authenticate;

	test: ICredentialTestRequest = {
		request: {
			baseURL: origin,
			url: '/v1/spaces',
			method: 'GET',
			qs: { limit: 1 },
			...requestBounds,
		},
	};
}
