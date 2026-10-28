import { NodeOperationError, type IDataObject, type IExecuteSingleFunctions } from 'n8n-workflow';
import type { Operation } from './fields';

const preserved = [
	'id',
	'answer_id',
	'artifact_id',
	'bundle_id',
	'resource_id',
	'resource_type',
	'space_id',
	'content_notice',
	'text_trust',
	'trust_boundary',
	'coverage',
	'read_context',
	'sensitivity_tags',
];
const summaries: Record<string, string> = {
	space: 'name,description,entity_id,created_at,updated_at',
	task: 'title,description,status,updated_at',
	run: 'task_id,status,queued_reason,latest_handoff_artifact,stop_requested_at,created_at,updated_at,finished_at',
	artifact: 'run_id,kind,media_type,sha256,size_bytes,moderation_status,created_at',
	memory: 'question,answer,confidence,supporting_artifacts,evidence,gaps,created_at',
	evaluation: 'run_id,outcome,score,confidence,summary,dimensions,created_at',
	conversation:
		'thread_id,body_text,author_identity_id,author_agent_id,reply_to_entry_id,created_at',
	dependency: 'predecessor_task_id,successor_task_id,created_at',
	searchRecords: 'title,snippet,score,metadata,updated_at',
	buildSpaceContextPack:
		'context_identity,query,context_text,items,omitted_item_count,source_count',
	getSpaceDecisionGraph: 'generated_at,memory_nodes,memory_edges,projections',
	getSpaceWorkContract:
		'schema,version,stack,basic_collaboration,capabilities,operation_contracts,agent_instructions,generated_at',
	getSpaceActionIntelligence:
		'window_start,window_end,trace_sample_count,trace_sample_truncated,status_counts,operation_counts,coverage_counts,recent_actions,recent_failures',
	getRunContext: 'run,run_group,task,context_refs',
	getArtifactContent: 'media_type,sha256,size_bytes,body',
	getArtifactSources: 'items',
	getSpaceConversationThread: 'title,created_at,updated_at,last_entry_at,last_activity_at,revision',
};

export function outputFields(
	this: IExecuteSingleFunctions,
	operation: Operation,
): string[] | undefined {
	const mode = this.getNodeParameter('responseFields', 'raw');
	if (mode === 'raw') return undefined;
	let fields: string[];
	if (mode === 'simplified')
		fields = (summaries[operation.id] ?? summaries[operation.resource]).split(',');
	else if (mode === 'selected') {
		const value = this.getNodeParameter('fieldsToInclude', '');
		if (typeof value !== 'string' || value.length > 2048)
			throw new NodeOperationError(
				this.getNode(),
				'Fields to Include must be comma-separated field names',
			);
		fields = value.split(',').map((field) => field.trim());
		if (
			fields.length > 32 ||
			fields.some(
				(field) =>
					!/^[a-z][a-z0-9_]{0,63}$/.test(field) ||
					['constructor', 'prototype', '__proto__'].includes(field),
			)
		)
			throw new NodeOperationError(this.getNode(), 'Choose 1 to 32 top-level response fields');
	} else throw new NodeOperationError(this.getNode(), 'Select a supported Response Fields mode');
	return [...new Set([...preserved, ...fields])];
}

export function selectFields(data: IDataObject, fields?: string[]): IDataObject {
	if (!fields) return data;
	return Object.fromEntries(
		fields.filter((field) => Object.hasOwn(data, field)).map((field) => [field, data[field]]),
	);
}
