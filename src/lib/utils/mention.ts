/**
 * Mention Utilities
 *
 * Consolidated constants, regex patterns, and pure functions for @mention handling.
 * Used by chat-room.svelte, text-formatter.ts, and formatted-message.svelte.
 */

// ============ CONSTANTS ============

export const MENTION_USERNAME_MAX_LENGTH = 32;

export const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{1,32}$/;

export const MAX_MENTION_SUGGESTIONS = 6;

export const MENTION_PICKER = {
	ITEM_HEIGHT: 32,
	PADDING: 12,
	EMPTY_STATE_HEIGHT: 44,
	HORIZONTAL_PADDING: 68,
	MIN_WIDTH: 220,
	OFFSET_GAP: 6,
	EDGE_MARGIN: 8
} as const;

// ============ REGEX PATTERNS ============

/**
 * Regex for matching @mentions in plain text.
 * Captures: $1 = prefix (space or start), $2 = username
 */
export const MENTION_REGEX_PLAIN = /(^|\s)@([a-zA-Z0-9_-]{1,32})(?=$|\s|[^a-zA-Z0-9_-])/g;

/**
 * Regex for matching @mentions in HTML context (after sanitization).
 * Handles cases where mentions appear after HTML tags like <br> or </p>.
 * Captures: $1 = prefix (space, start, or >), $2 = username
 */
export const MENTION_REGEX_HTML = /(^|[\s>])@([a-zA-Z0-9_-]{1,32})(?=$|[\s<]|[^a-zA-Z0-9_-])/g;

// ============ PURE UTILITY FUNCTIONS ============

/**
 * Checks if the given index is at the start of a word.
 * A word starts at position 0 or after whitespace.
 */
export function isWordStart(value: string, index: number): boolean {
	if (index <= 0) return true;
	return /\s/.test(value[index - 1]);
}

/**
 * Finds mention context at the cursor position.
 * Returns the @ index and the partial query string, or null if no valid mention context.
 */
export function findMentionContext(
	value: string,
	cursorIndex: number
): { atIndex: number; query: string } | null {
	const beforeCursor = value.slice(0, cursorIndex);
	const atIndex = beforeCursor.lastIndexOf('@');

	if (atIndex === -1) return null;
	if (!isWordStart(value, atIndex)) return null;

	const query = value.slice(atIndex + 1, cursorIndex);

	// Query cannot contain whitespace
	if (query.includes(' ') || query.includes('\n') || query.includes('\t')) return null;

	// Query cannot exceed max length
	if (query.length > MENTION_USERNAME_MAX_LENGTH) return null;

	// If there's a query, it must match the username pattern
	// Empty query is allowed (shows all users when just typing @)
	if (query && !USERNAME_PATTERN.test(query)) return null;

	return { atIndex, query };
}

/**
 * Highlights @mentions in plain text by wrapping them in spans.
 * Text must be HTML-escaped before calling this function.
 */
export function highlightMentionsPlain(escapedText: string): string {
	return escapedText.replace(MENTION_REGEX_PLAIN, '$1<span class="mention-token">@$2</span>');
}

/**
 * Highlights @mentions in HTML content (post-sanitization).
 * Used in text-formatter.ts after rehype processing.
 */
export function highlightMentionsHtml(html: string): string {
	return html.replace(MENTION_REGEX_HTML, '$1<span class="mention-token">@$2</span>');
}

/**
 * Highlights @mentions for input field display (with different class).
 */
export function highlightMentionsInput(escapedText: string): string {
	return escapedText.replace(MENTION_REGEX_PLAIN, '$1<span class="input-mention">@$2</span>');
}

/**
 * Checks if content contains a mention of the given username.
 * Case-insensitive by default.
 */
export function containsMention(
	content: string,
	username: string,
	caseSensitive: boolean = false
): boolean {
	const escapedUsername = username.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
	const flags = caseSensitive ? '' : 'i';
	const mentionRegex = new RegExp(`(?:^|\\s)@(${escapedUsername})(?=$|\\s|[^a-zA-Z0-9_-])`, flags);
	return mentionRegex.test(content);
}

/**
 * Calculates the height of the mention picker based on suggestion count.
 */
export function calculatePickerHeight(suggestionCount: number): number {
	if (suggestionCount === 0) {
		return MENTION_PICKER.EMPTY_STATE_HEIGHT;
	}
	return (
		Math.min(suggestionCount, MAX_MENTION_SUGGESTIONS) * MENTION_PICKER.ITEM_HEIGHT +
		MENTION_PICKER.PADDING
	);
}

/**
 * Calculates the width of the mention picker based on content.
 * @param maxNameWidth - Maximum width of username text in pixels
 * @param statusWidth - Width of status text in pixels
 */
export function calculatePickerWidth(maxNameWidth: number, statusWidth: number): number {
	return Math.max(
		MENTION_PICKER.MIN_WIDTH,
		Math.ceil(maxNameWidth + statusWidth + MENTION_PICKER.HORIZONTAL_PADDING)
	);
}
