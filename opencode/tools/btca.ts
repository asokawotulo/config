import { tool } from "@opencode-ai/plugin";
import * as Bun from "bun";

// Check if btca is installed at module load time (cached for performance)
const btcaPath = Bun.which("btca");

// Recursion guard
const RECURSION_GUARD_ENV = "OPENCODE_BTCA_RECURSION_GUARD";

function guard() {
	if (!btcaPath) {
		throw new Error("btca is not installed or not in PATH. Install it first to use this tool.");
	}

	if (process.env[RECURSION_GUARD_ENV]) {
		throw new Error("btca recursion guard detected. Aborting command execution.");
	}
}

function processShellOutput(output: Bun.$.ShellOutput) {
	const stderr = output.stderr.toString();
	const stdout = output.text().trim();

	if (output.exitCode !== 0) {
		throw new Error(`btca command execution failed (exit ${output.exitCode}): ${stderr || stdout}`);
	}

	return stdout;
}

export const list = tool({
	description: btcaPath
		? "List available btca resources"
		: "btca CLI is not installed. Install btca first to use this tool.",
	args: {},
	async execute() {
		guard();

		const result = await Bun.$`${RECURSION_GUARD_ENV}=1 btca config resources list`.quiet().nothrow();

		return processShellOutput(result);
	}
})

export const add = tool({
	description: btcaPath
		? "Add a new btca resource from a git URL or local path."
		: "btca CLI is not installed. Install btca first to use this tool.",
	args: {
		url: tool.schema.string().describe("Git repository URL or local path to add as a resource."),
	},
	async execute({ url }) {
		guard();

		const result = await Bun.$`${RECURSION_GUARD_ENV}=1 btca config resources add ${url}`.quiet().nothrow();

		return processShellOutput(result);
	}
})

export const ask = tool({
	description: btcaPath
		? "Query btca (better context tool CLI) to ask questions about resources."
		: "btca CLI is not installed. Install btca first to use this tool.",
	args: {
		resource: tool.schema.string().describe("Resource name to query."),
		question: tool.schema.string().describe("Question to ask the resource."),
	},
	async execute({ resource, question }) {
		guard();

		const result = await Bun.$`${RECURSION_GUARD_ENV}=1 btca ask --resource ${resource} --question ${question}`
			.quiet()
			.nothrow();

		const output = processShellOutput(result)
			// Remove thinking from the output
			.replace(/<thinking>(.|\n)*<\/thinking>/g, '')
			// Remove tool calls from the output
			.replace(/\[(read|grep|glob|list-files|search-files)\]/g, '')
			// Remove loading resources from the output
			.replace('loading resources...\n', '')
			// Remove creating collection from the output
			.replace('creating collection...\n\n', '')
			// Remove question from the output
			.replace(`${question}\n\n`, '')
			.trim();

		return output || "No response from btca.";
	}
})