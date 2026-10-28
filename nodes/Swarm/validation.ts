import { NodeOperationError, type GenericValue, type INode } from 'n8n-workflow';
import type { Field } from './fields';

const idPattern = /^[A-Za-z0-9][A-Za-z0-9_:-]{0,127}$/;
const utf8 = new TextEncoder();
const exceedsBytes = (value: string, limit: number) =>
	value.length > limit || utf8.encode(value).length > limit;
function validTimestamp(value: string): boolean {
	const parts =
		/^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
			value,
		);
	if (!parts) return false;
	const year = Number(parts[1]),
		month = Number(parts[2]),
		day = Number(parts[3]);
	const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	return day <= days[month - 1] && Number.isFinite(Date.parse(value));
}
export function identifier(value: unknown, label: string, node: INode): string {
	if (typeof value !== 'string' || !idPattern.test(value))
		throw new NodeOperationError(node, `${label} must be a valid Swarm ID`);
	return value;
}
export function fieldValue(field: Field, value: unknown, node: INode): GenericValue {
	if (value === undefined || value === null || value === '') {
		if (field.required) throw new NodeOperationError(node, `${field.label} is required`);
		return undefined;
	}
	if (field.kind === 'id') return identifier(value, field.label, node);
	if (field.kind === 'number') {
		if (
			typeof value !== 'number' ||
			!Number.isSafeInteger(value) ||
			value < (field.min ?? 0) ||
			value > (field.max ?? 100)
		)
			throw new NodeOperationError(node, `${field.label} is outside its allowed range`);
		return value;
	}
	if (field.kind === 'boolean') {
		if (typeof value !== 'boolean')
			throw new NodeOperationError(node, `${field.label} must be a boolean`);
		return value;
	}
	if (['ids', 'strings', 'scores', 'csv'].includes(field.kind)) {
		if (field.kind === 'csv' && typeof value !== 'string')
			throw new NodeOperationError(node, `${field.label} must be comma-separated text`);
		if (typeof value === 'string' && exceedsBytes(value, 65536))
			throw new NodeOperationError(node, `${field.label} exceeds its size limit`);
		let parsed: unknown;
		try {
			parsed =
				field.kind === 'csv' && typeof value === 'string'
					? value.split(',').map((v) => v.trim())
					: typeof value === 'string'
						? JSON.parse(value)
						: value;
		} catch {
			throw new NodeOperationError(node, `${field.label} must contain valid JSON`);
		}
		if (field.kind === 'scores') {
			if (
				!parsed ||
				typeof parsed !== 'object' ||
				Array.isArray(parsed) ||
				Object.keys(parsed).length === 0 ||
				Object.keys(parsed).length > (field.max ?? 32) ||
				Object.entries(parsed).some(
					([k, v]) =>
						!/^[a-z][a-z0-9_]{0,63}$/.test(k) ||
						['constructor', 'prototype', '__proto__'].includes(k) ||
						typeof v !== 'number' ||
						!Number.isInteger(v) ||
						v < 0 ||
						v > 100,
				)
			)
				throw new NodeOperationError(
					node,
					'Dimension Scores must map rubric names to integer scores from 0 to 100',
				);
			return parsed;
		}
		if (!Array.isArray(parsed) || parsed.length > (field.max ?? 32))
			throw new NodeOperationError(node, `${field.label} has too many entries`);
		const values = parsed.map((v) =>
			field.kind === 'strings'
				? fieldValue({ ...field, kind: 'text', max: 240, required: true }, v, node)
				: identifier(v, field.label, node),
		);
		if (field.required && !values.length)
			throw new NodeOperationError(node, `${field.label} is required`);
		return field.kind === 'csv' ? values.join(',') : values;
	}
	if (
		typeof value !== 'string' ||
		exceedsBytes(value, field.max ?? 65536) ||
		(field.required && !value.trim())
	)
		throw new NodeOperationError(
			node,
			`${field.label} must be nonempty text within its size limit of ${field.max ?? 65536} UTF-8 bytes`,
		);
	if (field.choices && !field.choices.includes(value))
		throw new NodeOperationError(node, `${field.label} is not an allowed choice`);
	if (field.wire === 'resource_type' && !/^[a-z][a-z0-9_]{0,63}$/.test(value))
		throw new NodeOperationError(node, 'Resource Type is invalid');
	if (['expected_updated_at', 'start_at', 'end_at'].includes(field.wire) && !validTimestamp(value))
		throw new NodeOperationError(
			node,
			`${field.label} must be a complete timestamp with a time zone`,
		);
	return value;
}
