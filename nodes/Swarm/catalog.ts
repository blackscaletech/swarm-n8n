import { collaboration } from './resources/collaboration';
import { knowledge } from './resources/knowledge';
import { work } from './resources/work';

export const operations = [...knowledge, ...work, ...collaboration];
export const resources = [
	{ name: 'Artifact', value: 'artifact' },
	{ name: 'Conversation', value: 'conversation' },
	{ name: 'Evaluation', value: 'evaluation' },
	{ name: 'Memory', value: 'memory' },
	{ name: 'Run', value: 'run' },
	{ name: 'Space', value: 'space' },
	{ name: 'Task', value: 'task' },
	{ name: 'Task Dependency', value: 'dependency' },
];
