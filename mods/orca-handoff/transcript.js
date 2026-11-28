const MAX_FORK_CONTEXT_CHARS = 36e3;
const MAX_FORK_CAPTURE_SANITIZE_CHARS = MAX_FORK_CONTEXT_CHARS * 4;
const ESCAPE_CODE = 27;
const BELL_CODE = 7;
const CARRIAGE_RETURN_CODE = 13;
const LINE_FEED_CODE = 10;
const RIGHT_BRACKET_CODE = 93;
const LEFT_BRACKET_CODE = 91;
const LETTER_C_CODE = 99;
const BACKSPACE_CODE = 8;
const VERTICAL_TAB_CODE = 11;
const FORM_FEED_CODE = 12;
const SHIFT_OUT_CODE = 14;
const UNIT_SEPARATOR_CODE = 31;
const DELETE_CODE = 127;
const CSI_PARAMETER_MIN = 48;
const CSI_PARAMETER_MAX = 63;
const CSI_INTERMEDIATE_MIN = 32;
const CSI_INTERMEDIATE_MAX = 47;
const CSI_FINAL_MIN = 64;
const CSI_FINAL_MAX = 126;
const C1_FINAL_UPPER_MIN = 64;
const C1_FINAL_UPPER_MAX = 90;
const C1_FINAL_LOWER_MIN = 92;
const C1_FINAL_LOWER_MAX = 95;
const MAX_NEWLINE_RUN = 3;
const MIN_FENCE_LENGTH = 3;
const BACKTICK = "`";
const FENCE_LANGUAGE = "text";
const ORIGINAL_AGENT_LABEL = "Original agent";
const ORIGINAL_WORKING_DIRECTORY_LABEL = "Original working directory";
const CHARSET_SELECTORS = "()*+-./";
function inRange(code, min, max) {
	return code >= min && code <= max;
}
function tailBoundForkCapture(value) {
	if (value.length <= MAX_FORK_CAPTURE_SANITIZE_CHARS) return value;
	return value.slice(-144e3);
}
function findOscSequenceEnd(value, index) {
	for (let cursor = index; cursor < value.length; cursor++) {
		const code = value.charCodeAt(cursor);
		if (code === BELL_CODE) return cursor;
		if (code === ESCAPE_CODE && value[cursor + 1] === "\\") return cursor + 1;
	}
	return null;
}
function findCsiSequenceEnd(value, index) {
	let cursor = index;
	while (cursor < value.length && inRange(value.charCodeAt(cursor), CSI_PARAMETER_MIN, CSI_PARAMETER_MAX)) cursor++;
	while (cursor < value.length && inRange(value.charCodeAt(cursor), CSI_INTERMEDIATE_MIN, CSI_INTERMEDIATE_MAX)) cursor++;
	return cursor < value.length && inRange(value.charCodeAt(cursor), CSI_FINAL_MIN, CSI_FINAL_MAX) ? cursor : null;
}
function isC1FinalCode(code) {
	return inRange(code, C1_FINAL_UPPER_MIN, C1_FINAL_UPPER_MAX) || inRange(code, C1_FINAL_LOWER_MIN, C1_FINAL_LOWER_MAX) || code === LETTER_C_CODE;
}
function findTerminalEscapeEnd(value, escapeIndex) {
	const nextCode = value.charCodeAt(escapeIndex + 1);
	if (nextCode === RIGHT_BRACKET_CODE) return findOscSequenceEnd(value, escapeIndex + 2) ?? escapeIndex + 1;
	if (nextCode === LEFT_BRACKET_CODE) return findCsiSequenceEnd(value, escapeIndex + 2);
	if (isC1FinalCode(nextCode)) return escapeIndex + 1;
	if (CHARSET_SELECTORS.includes(value[escapeIndex + 1] ?? "") && escapeIndex + 2 < value.length) return escapeIndex + 2;
	return null;
}
function isUnsupportedTranscriptControl(code) {
	return code <= BACKSPACE_CODE || code === VERTICAL_TAB_CODE || code === FORM_FEED_CODE || inRange(code, SHIFT_OUT_CODE, UNIT_SEPARATOR_CODE) || code === DELETE_CODE;
}
function cleanAgentSessionForkTranscript(value) {
	if (!value || typeof value !== "string") return "";
	let result = "";
	let newlineRun = 0;
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code === ESCAPE_CODE) {
			const skippedIndex = findTerminalEscapeEnd(value, index);
			if (skippedIndex !== null) {
				index = skippedIndex;
				continue;
			}
		}
		if (code === CARRIAGE_RETURN_CODE || code === LINE_FEED_CODE) {
			if (code === CARRIAGE_RETURN_CODE && value.charCodeAt(index + 1) === LINE_FEED_CODE) index++;
			if (newlineRun < MAX_NEWLINE_RUN) result += "\n";
			newlineRun++;
			continue;
		}
		if (isUnsupportedTranscriptControl(code)) continue;
		result += value[index];
		newlineRun = 0;
	}
	return result.trim();
}
function buildBoundedSessionTranscript(capturedText) {
	if (!capturedText) return null;
	const cleaned = cleanAgentSessionForkTranscript(tailBoundForkCapture(capturedText));
	if (!cleaned) return null;
	return cleaned.length <= MAX_FORK_CONTEXT_CHARS ? cleaned : cleaned.slice(-36e3);
}
function getMarkdownFence(value) {
	let longestFence = 0;
	let currentFence = 0;
	for (let index = 0; index < value.length; index++) if (value[index] === BACKTICK) {
		currentFence++;
		longestFence = Math.max(longestFence, currentFence);
	} else currentFence = 0;
	return BACKTICK.repeat(Math.max(MIN_FENCE_LENGTH, longestFence + 1));
}
function buildAgentSessionForkPrompt({ capturedText, sourceLabel, agentLabel }) {
	const transcript = buildBoundedSessionTranscript(capturedText);
	if (!transcript) return null;
	const fence = getMarkdownFence(transcript);
	return [
		...[
			"This is a fork of an existing Orca agent session.",
			"",
			"Use the captured transcript as background context for this new, independent session. Keep file edits and decisions independent from the original terminal unless I explicitly ask you to coordinate with it.",
			"",
			sourceLabel ? `Source: ${sourceLabel}` : null,
			agentLabel ? `${ORIGINAL_AGENT_LABEL}: ${agentLabel}` : null,
			"",
			"Captured terminal transcript:",
			`${fence}${FENCE_LANGUAGE}`
		].filter(Boolean),
		transcript,
		fence,
		"",
		"Acknowledge that you have the forked context, then wait for my next instruction."
	].join("\n");
}
function buildAgentSessionContinuationPrompt({ sourceAgent, sourceWorkingDirectory, capturedText }) {
	const transcript = buildBoundedSessionTranscript(capturedText);
	if (!transcript) return null;
	const fence = getMarkdownFence(transcript);
	const sourceLines = [sourceAgent ? `${ORIGINAL_AGENT_LABEL}: ${sourceAgent}` : null, sourceWorkingDirectory ? `${ORIGINAL_WORKING_DIRECTORY_LABEL}: ${sourceWorkingDirectory}` : null].filter(Boolean);
	return [
		"Continue work from the prior Orca session using the context below.",
		"The prior provider session is read-only context; do not resume or modify it.",
		"",
		...sourceLines,
		...sourceLines.length > 0 ? [""] : [],
		"Captured transcript:",
		`${fence}${FENCE_LANGUAGE}`,
		transcript,
		fence,
		"",
		"Acknowledge that you have the context and tell me what the next step is."
	].join("\n");
}

export { buildAgentSessionContinuationPrompt, buildAgentSessionForkPrompt, buildBoundedSessionTranscript, cleanAgentSessionForkTranscript };
