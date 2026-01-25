/**
 * notify
 * Native OS notifications for OpenCode
 *
 * Based on: https://github.com/kdcokenny/opencode-notify
 *
 * Features:
 * - Suppresses notifications when Ghostty is focused
 * - Click notification to focus Ghostty
 * - Parent session only by default (no spam from sub-tasks)
 *
 * Platform: macOS + Ghostty only
 * Uses node-notifier with terminal-notifier (native NSUserNotificationCenter)
 */

import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Plugin } from "@opencode-ai/plugin"
import type { createOpencodeClient, Event } from "@opencode-ai/sdk"
import notifier from "node-notifier"

type OpencodeClient = ReturnType<typeof createOpencodeClient>

interface NotifyConfig {
	/** Notify for child/sub-session events (default: false) */
	notifyChildSessions: boolean
	/** Sound configuration per event type */
	sounds: {
		idle: string
		error: string
		permission: string
		question?: string
	}
}

interface GhosttyInfo {
	bundleId: string | null
}

type NotifyKind = "idle" | "error" | "permission" | "question"

const CONFIG_PATH = join(homedir(), ".config", "opencode", "notify.json")
const DEFAULT_CONFIG: NotifyConfig = {
	notifyChildSessions: false,
	sounds: {
		idle: "Blow",
		error: "Basso",
		permission: "Submarine",
	},
}

// ==========================================
// UTILITIES
// ==========================================

function truncate(input: string, max: number): string {
	return input.length > max ? input.slice(0, max) : input
}

function toErrorString(error: unknown): string | undefined {
	if (typeof error === "string") return error
	if (error) return String(error)
	return undefined
}

function getSound(config: NotifyConfig, kind: NotifyKind): string {
	if (kind === "question") {
		return config.sounds.question ?? config.sounds.permission
	}
	return config.sounds[kind]
}

// ==========================================
// CONFIGURATION
// ==========================================

async function readFileOrNull(filePath: string): Promise<string | null> {
	try {
		return await readFile(filePath, "utf8")
	} catch {
		return null
	}
}

function parseJsonOrNull<T>(content: string): T | null {
	try {
		return JSON.parse(content) as T
	} catch {
		return null
	}
}

function mergeConfig(userConfig: Partial<NotifyConfig> | null): NotifyConfig {
	if (!userConfig) return DEFAULT_CONFIG

	return {
		...DEFAULT_CONFIG,
		...userConfig,
		sounds: {
			...DEFAULT_CONFIG.sounds,
			...userConfig.sounds,
		},
	}
}

async function loadConfig(): Promise<NotifyConfig> {
	const content = await readFileOrNull(CONFIG_PATH)
	if (!content) return DEFAULT_CONFIG

	const userConfig = parseJsonOrNull<Partial<NotifyConfig>>(content)
	return mergeConfig(userConfig)
}

// ==========================================
// GHOSTTY DETECTION (macOS)
// ==========================================

async function runOsascript(script: string): Promise<string | null> {
	try {
		const proc = Bun.spawn(["osascript", "-e", script], {
			stdout: "pipe",
			stderr: "pipe",
		})
		const output = await new Response(proc.stdout).text()
		return output.trim()
	} catch {
		return null
	}
}

async function getBundleId(appName: string): Promise<string | null> {
	return runOsascript(`id of application "${appName}"`)
}

async function getFrontmostApp(): Promise<string | null> {
	return runOsascript(
		'tell application "System Events" to get name of first application process whose frontmost is true',
	)
}

async function getGhosttyInfo(): Promise<GhosttyInfo> {
	const bundleId = await getBundleId("Ghostty")
	return { bundleId }
}

async function isGhosttyFocused(): Promise<boolean> {
	const frontmost = await getFrontmostApp()
	if (!frontmost) return false
	return frontmost.toLowerCase() === "ghostty"
}

// ==========================================
// PARENT SESSION DETECTION
// ==========================================

interface SessionInfo {
	title?: string
	parentID?: string | null
}

async function getSession(client: OpencodeClient, sessionID: string): Promise<SessionInfo | null> {
	try {
		const session = await client.session.get({ path: { id: sessionID } })
		return {
			title: session.data?.title,
			parentID: session.data?.parentID,
		}
	} catch {
		// If we can't fetch, return null (caller decides how to handle)
		return null
	}
}

function isParentSessionFromData(parentID: string | null | undefined): boolean {
	// No parentID means this IS the parent/root session
	return !parentID
}

async function isParentSession(client: OpencodeClient, sessionID: string): Promise<boolean> {
	const session = await getSession(client, sessionID)
	// If we can't fetch, assume it's a parent to be safe (notify rather than miss)
	if (!session) return true
	return isParentSessionFromData(session.parentID)
}

// ==========================================
// NOTIFICATION GATING
// ==========================================

interface ShouldNotifyOptions {
	client?: OpencodeClient
	sessionID?: string
	config: NotifyConfig
	requireParent: boolean
	suppressIfFocused: boolean
}

async function shouldNotify(opts: ShouldNotifyOptions): Promise<boolean> {
	const { client, sessionID, config, requireParent, suppressIfFocused } = opts

	// Check parent session requirement
	if (requireParent && !config.notifyChildSessions) {
		if (!client || !sessionID) return false
		const isParent = await isParentSession(client, sessionID)
		if (!isParent) return false
	}

	// Check if Ghostty is focused (suppress notification if user is already looking)
	if (suppressIfFocused && (await isGhosttyFocused())) {
		return false
	}

	return true
}

// ==========================================
// NOTIFICATION SENDER
// ==========================================

interface NotifierOptions {
	title: string
	message: string
	sound: string
	activate?: string
}

interface NotificationOptions {
	title: string
	message: string
	sound: string
	ghosttyInfo: GhosttyInfo
}

function buildNotifierOptions(options: NotificationOptions): NotifierOptions {
	const { title, message, sound, ghosttyInfo } = options

	const notifierOpts: NotifierOptions = {
		title,
		message,
		sound,
	}

	// Click notification to focus Ghostty
	if (ghosttyInfo.bundleId) {
		notifierOpts.activate = ghosttyInfo.bundleId
	}

	return notifierOpts
}

async function sendNotification(options: NotificationOptions): Promise<void> {
	const notifierOpts = buildNotifierOptions(options)

	notifier.notify(notifierOpts)
}

// ==========================================
// EVENT HANDLERS
// ==========================================

async function handleSessionIdle(
	client: OpencodeClient,
	sessionID: string,
	config: NotifyConfig,
	ghosttyInfo: GhosttyInfo,
): Promise<void> {
	// Check gating policy
	const allowed = await shouldNotify({
		client,
		sessionID,
		config,
		requireParent: true,
		suppressIfFocused: true,
	})
	if (!allowed) return

	// Get session info for context (fetch once)
	const session = await getSession(client, sessionID)
	const sessionTitle = session?.title ? truncate(session.title, 50) : "Task"

	sendNotification({
		title: "Ready for review",
		message: sessionTitle,
		sound: getSound(config, "idle"),
		ghosttyInfo,
	})
}

async function handleSessionError(
	client: OpencodeClient,
	sessionID: string,
	error: string | undefined,
	config: NotifyConfig,
	ghosttyInfo: GhosttyInfo,
): Promise<void> {
	// Check gating policy
	const allowed = await shouldNotify({
		client,
		sessionID,
		config,
		requireParent: true,
		suppressIfFocused: true,
	})
	if (!allowed) return

	const errorMessage = error ? truncate(error, 100) : "Something went wrong"

	sendNotification({
		title: "Something went wrong",
		message: errorMessage,
		sound: getSound(config, "error"),
		ghosttyInfo,
	})
}

async function handlePermissionUpdated(
	config: NotifyConfig,
	ghosttyInfo: GhosttyInfo,
): Promise<void> {
	// Always notify for permission events - AI is blocked waiting for human
	// No parent check needed: permissions always need human attention

	// Check gating policy (no parent requirement, but suppress if focused)
	const allowed = await shouldNotify({
		config,
		requireParent: false,
		suppressIfFocused: true,
	})
	if (!allowed) return

	sendNotification({
		title: "Waiting for you",
		message: "OpenCode needs your input",
		sound: getSound(config, "permission"),
		ghosttyInfo,
	})
}

async function handleQuestionAsked(
	config: NotifyConfig,
	ghosttyInfo: GhosttyInfo,
): Promise<void> {
	// Always notify for questions (no focus check - important for tmux workflow)
	sendNotification({
		title: "Question for you",
		message: "OpenCode needs your input",
		sound: getSound(config, "question"),
		ghosttyInfo,
	})
}

// ==========================================
// PLUGIN EXPORT
// ==========================================

export const NotifyPlugin: Plugin = async (ctx) => {
	// macOS-only: return no-op handlers on other platforms
	if (process.platform !== "darwin") {
		return {
			"tool.execute.before": async () => { },
			event: async () => { },
		}
	}

	const { client } = ctx

	// Load config once at startup
	const config = await loadConfig()

	// Detect Ghostty once at startup (cached for performance)
	const ghosttyInfo = await getGhosttyInfo()

	return {
		"tool.execute.before": async (input: { tool: string; sessionID: string; callID: string }) => {
			if (input.tool === "question") {
				await handleQuestionAsked(config, ghosttyInfo)
			}
		},
		event: async ({ event }: { event: Event }): Promise<void> => {
			switch (event.type) {
				case "session.idle": {
					const sessionID = event.properties.sessionID
					if (!sessionID) break
					await handleSessionIdle(client, sessionID, config, ghosttyInfo)
					break
				}
				case "session.error": {
					const sessionID = event.properties.sessionID
					if (!sessionID) break
					const errorMessage = toErrorString(event.properties.error)
					await handleSessionError(client, sessionID, errorMessage, config, ghosttyInfo)
					break
				}
				case "permission.updated": {
					await handlePermissionUpdated(config, ghosttyInfo)
					break
				}
			}
		},
	}
}

export default NotifyPlugin