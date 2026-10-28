import type { IHttpRequestMethods } from 'n8n-workflow';

export interface Field {
	wire: string;
	label: string;
	location: 'path' | 'query' | 'body';
	kind: 'text' | 'id' | 'ids' | 'strings' | 'scores' | 'number' | 'boolean' | 'csv';
	required?: boolean;
	max?: number;
	min?: number;
	choices?: string[];
	initial?: string | number | boolean;
}
export interface Operation {
	resource: string;
	id: string;
	name: string;
	description: string;
	method: IHttpRequestMethods;
	path: string;
	fields: Field[];
	writes?: boolean;
	page?: boolean;
}
export const fieldName = (field: Field) =>
	field.wire.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
export const pathId = (wire: string, label: string): Field => ({
	wire,
	label,
	location: 'path',
	kind: 'id',
	required: true,
});
export const spaceQuery: Field = {
	wire: 'space_id',
	label: 'Space ID',
	location: 'query',
	kind: 'id',
	required: true,
};
export const spaceBody: Field = { ...spaceQuery, location: 'body' };
export const bodyText = (wire: string, label: string, max = 65536, required = true): Field => ({
	wire,
	label,
	location: 'body',
	kind: 'text',
	required,
	max,
});
export const queryText = (wire: string, label: string, max = 255): Field => ({
	wire,
	label,
	location: 'query',
	kind: 'text',
	max,
});
export const bodyId = (wire: string, label: string, required = false): Field => ({
	wire,
	label,
	location: 'body',
	kind: 'id',
	required,
});
export const choices = (
	wire: string,
	label: string,
	values: string[],
	location: Field['location'] = 'query',
	required = false,
): Field => ({ wire, label, kind: 'text', location, choices: values, required });
export const pageFields: Field[] = [
	{
		wire: 'limit',
		label: 'Limit',
		location: 'query',
		kind: 'number',
		min: 1,
		max: 100,
		initial: 50,
		required: true,
	},
	queryText('cursor', 'Cursor', 2048),
];
export const orderedPage: Field[] = [...pageFields, choices('order', 'Order', ['asc', 'desc'])];
