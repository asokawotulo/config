import { tool } from '@opencode-ai/plugin'
import { $ } from 'bun'

export const ask = tool({
	description: 'Use this tool to get answers directly from the real source code of libraries and frameworks.',
	args: {
		question: tool.schema.string().describe('The question to answer.'),
		resource: tool.schema.enum([
			'tailwindcss',
			'opencode',
		]),
	},
	async execute(args, _context) {
		if (process.env.OPENCODE_BTCA_RECURSION_GUARD) {
			return 'Error: Recursive call detected. btca tool cannot be called from within a btca-initiated session.'
		}

		const { resource, question } = args

		const rawResponse = await $`OPENCODE_BTCA_RECURSION_GUARD=1 btca ask --resource "${resource}" --question "${question}"`.text()

		// Remove thinking content and other noise
		const response = rawResponse.replace(/<thinking>(.|\n)*<\/thinking>/g, '')
			.replace(/\[(read|grep|glob)\]/g, '')
			.replace('loading resources...\n', '')
			.replace('creating collection...\n\n', '')
			.replace(`${question}\n\n`, '')

		return response
	}
})