import type { INodeProperties } from 'n8n-workflow';
import { operations, resources } from './catalog';
import { fieldName, type Field } from './fields';
import { prepareRequest, receiveResponse } from './request';

function property(field: Field): INodeProperties {
	const name = fieldName(field),
		isSpace = name === 'spaceId';
	if (isSpace)
		return {
			displayName: 'Space',
			name,
			type: 'resourceLocator',
			default: { mode: 'list', value: '' },
			required: !!field.required,
			modes: [
				{
					displayName: 'From List',
					name: 'list',
					type: 'list',
					typeOptions: { searchListMethod: 'searchSpaces', searchable: true },
				},
				{ displayName: 'By ID', name: 'id', type: 'string' },
			],
		};
	const json = ['ids', 'strings', 'scores'].includes(field.kind);
	return {
		displayName: field.label,
		name,
		type: field.choices
			? 'options'
			: json
				? 'json'
				: field.kind === 'number'
					? 'number'
					: field.kind === 'boolean'
						? 'boolean'
						: 'string',
		default:
			field.initial ??
			(field.kind === 'boolean'
				? false
				: field.kind === 'number'
					? (field.min ?? 0)
					: json
						? field.kind === 'scores'
							? '{}'
							: '[]'
						: ''),
		required: !!field.required,
		...(field.choices
			? {
					options: field.choices.map((value) => ({
						name: value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
						value,
					})),
				}
			: {}),
		...(field.kind === 'number'
			? {
					typeOptions: { minValue: field.min ?? 0, maxValue: field.max ?? 100, numberPrecision: 0 },
				}
			: {}),
		...(field.max && field.max > 1000 && !json ? { typeOptions: { rows: 4 } } : {}),
		...(field.kind === 'csv'
			? { placeholder: 'task_first,task_second', description: 'Comma-separated Task IDs, up to 40' }
			: {}),
	};
}

export const properties: INodeProperties[] = [
	{
		displayName: 'Resource',
		name: 'resource',
		type: 'options',
		noDataExpression: true,
		options: resources,
		default: 'space',
	},
	...resources.flatMap((resource) => {
		const choices = operations
			.filter((op) => op.resource === resource.value)
			.sort((a, b) => a.name.localeCompare(b.name));
		const defaultOperation = choices.find((op) => !op.writes)?.id ?? choices[0].id;
		return [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: [resource.value] } },
				default: defaultOperation,
				options: choices.map((op) => ({
					name: op.name,
					value: op.id,
					description: op.description,
					action: op.description,
					routing: {
						request: { method: op.method, url: op.path },
						send: { preSend: [prepareRequest] },
						output: { postReceive: [receiveResponse] },
					},
				})),
			} as INodeProperties,
		];
	}),
	...operations.flatMap((op) => {
		const displayOptions = { show: { resource: [op.resource], operation: [op.id] } };
		return [
			...(op.id === 'buildSpaceContextPack'
				? [
						{
							displayName: 'Add a Query or Objective in Additional Fields.',
							name: 'contextNotice',
							type: 'notice',
							default: '',
							displayOptions,
						} as INodeProperties,
					]
				: []),
			...(op.id === 'createEvaluation'
				? [
						{
							displayName:
								'In Additional Fields, select a Run ID or Artifact ID and add Outcome and Score, or the Run Scoring Contract Hash and Dimension Scores. Existing follow-up policies may react to this feedback.',
							name: 'evaluationNotice',
							type: 'notice',
							default: '',
							displayOptions,
						} as INodeProperties,
					]
				: []),
			...op.fields.filter((f) => f.required).map((f) => ({ ...property(f), displayOptions })),
			...(op.writes
				? [
						{
							displayName: 'Request Key',
							name: 'requestKey',
							type: 'string',
							default: '',
							required: true,
							displayOptions,
							description:
								'Stable ID for this business action. Reuse for retries; use a new key for changed input.',
							placeholder: 'support-case:123:brief:v1',
						} as INodeProperties,
					]
				: []),
			...(op.page
				? [
						{
							displayName: 'Output',
							name: 'outputMode',
							type: 'options',
							default: 'records',
							displayOptions,
							options: [
								{ name: 'Records', value: 'records' },
								{ name: 'Page With Cursor', value: 'page' },
							],
							description:
								'Return individual records or one page with items and the next cursor. No automatic pagination.',
						} as INodeProperties,
					]
				: []),
			...(op.fields.some((f) => !f.required)
				? [
						{
							displayName: 'Additional Fields',
							name: 'additionalFields',
							type: 'collection',
							placeholder: 'Add Field',
							default: {},
							displayOptions,
							options: op.fields
								.filter((f) => !f.required)
								.map(property)
								.sort((a, b) => a.displayName.localeCompare(b.displayName)),
						} as INodeProperties,
					]
				: []),
		];
	}),
	{
		displayName: 'Response Fields',
		name: 'responseFields',
		type: 'options',
		noDataExpression: true,
		default: 'raw',
		options: [
			{ name: 'Raw', value: 'raw' },
			{ name: 'Simplified', value: 'simplified' },
			{ name: 'Selected Fields', value: 'selected' },
		],
		description:
			'Return all fields, a useful summary or chosen top-level fields. IDs and trust notices are retained.',
	},
	{
		displayName: 'Fields to Include',
		name: 'fieldsToInclude',
		type: 'string',
		default: '',
		displayOptions: { show: { responseFields: ['selected'] } },
		placeholder: 'e.g. title,status,updated_at',
		description:
			'Up to 32 comma-separated top-level response fields. IDs, trust notices and page cursors are retained.',
	},
];
