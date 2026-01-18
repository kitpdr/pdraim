import { describe, it, expect, beforeEach } from 'vitest';
import {
	MENTION_USERNAME_MAX_LENGTH,
	USERNAME_PATTERN,
	MAX_MENTION_SUGGESTIONS,
	MENTION_PICKER,
	MENTION_REGEX_PLAIN,
	MENTION_REGEX_HTML,
	isWordStart,
	findMentionContext,
	highlightMentionsPlain,
	highlightMentionsHtml,
	highlightMentionsInput,
	containsMention,
	calculatePickerHeight,
	calculatePickerWidth
} from './mention';

describe('mention constants', () => {
	it('has correct username max length', () => {
		expect(MENTION_USERNAME_MAX_LENGTH).toBe(32);
	});

	it('has correct max suggestions', () => {
		expect(MAX_MENTION_SUGGESTIONS).toBe(6);
	});

	it('has correct picker dimensions', () => {
		expect(MENTION_PICKER.ITEM_HEIGHT).toBe(32);
		expect(MENTION_PICKER.PADDING).toBe(12);
		expect(MENTION_PICKER.EMPTY_STATE_HEIGHT).toBe(44);
		expect(MENTION_PICKER.MIN_WIDTH).toBe(220);
	});
});

describe('USERNAME_PATTERN', () => {
	it('matches valid usernames', () => {
		expect(USERNAME_PATTERN.test('alice')).toBe(true);
		expect(USERNAME_PATTERN.test('Bob123')).toBe(true);
		expect(USERNAME_PATTERN.test('user_name')).toBe(true);
		expect(USERNAME_PATTERN.test('user-name')).toBe(true);
		expect(USERNAME_PATTERN.test('A')).toBe(true);
		expect(USERNAME_PATTERN.test('a'.repeat(32))).toBe(true);
	});

	it('rejects invalid usernames', () => {
		expect(USERNAME_PATTERN.test('')).toBe(false);
		expect(USERNAME_PATTERN.test('a'.repeat(33))).toBe(false);
		expect(USERNAME_PATTERN.test('user name')).toBe(false);
		expect(USERNAME_PATTERN.test('user.name')).toBe(false);
		expect(USERNAME_PATTERN.test('@alice')).toBe(false);
		expect(USERNAME_PATTERN.test('alice!')).toBe(false);
	});
});

describe('isWordStart', () => {
	it('returns true at position 0', () => {
		expect(isWordStart('hello', 0)).toBe(true);
		expect(isWordStart('@alice', 0)).toBe(true);
	});

	it('returns true after whitespace', () => {
		expect(isWordStart('hello @alice', 6)).toBe(true);
		expect(isWordStart('hi\t@bob', 3)).toBe(true);
		expect(isWordStart('hi\n@bob', 3)).toBe(true);
	});

	it('returns false mid-word', () => {
		expect(isWordStart('hello', 2)).toBe(false);
		expect(isWordStart('test@alice', 4)).toBe(false);
	});
});

describe('findMentionContext', () => {
	it('finds mention at start of input', () => {
		const result = findMentionContext('@alice', 6);
		expect(result).toEqual({ atIndex: 0, query: 'alice' });
	});

	it('finds mention after space', () => {
		const result = findMentionContext('hello @bob', 10);
		expect(result).toEqual({ atIndex: 6, query: 'bob' });
	});

	it('finds partial mention (typing in progress)', () => {
		const result = findMentionContext('hello @al', 9);
		expect(result).toEqual({ atIndex: 6, query: 'al' });
	});

	it('finds empty query (just @)', () => {
		const result = findMentionContext('hello @', 7);
		expect(result).toEqual({ atIndex: 6, query: '' });
	});

	it('returns null when no @', () => {
		expect(findMentionContext('hello world', 11)).toBeNull();
	});

	it('returns null when @ is mid-word', () => {
		expect(findMentionContext('test@alice', 10)).toBeNull();
	});

	it('returns null when query contains space', () => {
		expect(findMentionContext('@alice bob', 10)).toBeNull();
	});

	it('returns null when query exceeds max length', () => {
		const longName = 'a'.repeat(33);
		expect(findMentionContext(`@${longName}`, longName.length + 1)).toBeNull();
	});

	it('returns null when query has invalid characters', () => {
		expect(findMentionContext('@alice!', 7)).toBeNull();
		expect(findMentionContext('@alice.bob', 10)).toBeNull();
	});

	it('handles cursor in middle of mention', () => {
		const result = findMentionContext('@alice hello', 4);
		expect(result).toEqual({ atIndex: 0, query: 'ali' });
	});
});

describe('MENTION_REGEX_PLAIN', () => {
	beforeEach(() => {
		// Reset regex lastIndex for global regex
		MENTION_REGEX_PLAIN.lastIndex = 0;
	});

	it('matches mention at start', () => {
		const matches = '@alice hello'.match(MENTION_REGEX_PLAIN);
		expect(matches).toContain('@alice');
	});

	it('matches mention after space', () => {
		const matches = 'hello @bob there'.match(MENTION_REGEX_PLAIN);
		expect(matches).toContain(' @bob');
	});

	it('matches multiple mentions', () => {
		const text = '@alice and @bob are here';
		const matches = text.match(MENTION_REGEX_PLAIN);
		expect(matches).toHaveLength(2);
	});

	it('does not match mid-word @', () => {
		const matches = 'email@test.com'.match(MENTION_REGEX_PLAIN);
		expect(matches).toBeNull();
	});
});

describe('MENTION_REGEX_HTML', () => {
	beforeEach(() => {
		MENTION_REGEX_HTML.lastIndex = 0;
	});

	it('matches mention after HTML tag', () => {
		const matches = '<p>@alice</p>'.match(MENTION_REGEX_HTML);
		expect(matches).toContain('>@alice');
	});

	it('matches mention at start', () => {
		const matches = '@bob said'.match(MENTION_REGEX_HTML);
		expect(matches).toContain('@bob');
	});
});

describe('highlightMentionsPlain', () => {
	it('wraps mention in span', () => {
		const result = highlightMentionsPlain('@alice');
		expect(result).toBe('<span class="mention-token">@alice</span>');
	});

	it('preserves text around mention', () => {
		const result = highlightMentionsPlain('hello @bob there');
		expect(result).toBe('hello <span class="mention-token">@bob</span> there');
	});

	it('handles multiple mentions', () => {
		const result = highlightMentionsPlain('@alice and @bob');
		expect(result).toContain('<span class="mention-token">@alice</span>');
		expect(result).toContain('<span class="mention-token">@bob</span>');
	});

	it('does not highlight mid-word @', () => {
		const result = highlightMentionsPlain('email@test.com');
		expect(result).toBe('email@test.com');
	});
});

describe('highlightMentionsHtml', () => {
	it('wraps mention after HTML tag', () => {
		const result = highlightMentionsHtml('<p>@alice</p>');
		expect(result).toBe('<p><span class="mention-token">@alice</span></p>');
	});

	it('handles mention at start', () => {
		const result = highlightMentionsHtml('@bob said');
		expect(result).toBe('<span class="mention-token">@bob</span> said');
	});
});

describe('highlightMentionsInput', () => {
	it('uses input-mention class', () => {
		const result = highlightMentionsInput('@alice');
		expect(result).toBe('<span class="input-mention">@alice</span>');
	});
});

describe('containsMention', () => {
	it('detects mention (case-insensitive by default)', () => {
		expect(containsMention('hello @Alice', 'alice')).toBe(true);
		expect(containsMention('hello @ALICE', 'alice')).toBe(true);
		expect(containsMention('hello @alice', 'ALICE')).toBe(true);
	});

	it('respects case sensitivity when enabled', () => {
		expect(containsMention('hello @Alice', 'alice', true)).toBe(false);
		expect(containsMention('hello @alice', 'alice', true)).toBe(true);
	});

	it('returns false when no mention', () => {
		expect(containsMention('hello world', 'alice')).toBe(false);
	});

	it('returns false for partial match', () => {
		expect(containsMention('hello @alicexyz', 'alice')).toBe(false);
	});

	it('handles special regex characters in username', () => {
		expect(containsMention('hello @user-name', 'user-name')).toBe(true);
		expect(containsMention('hello @user_name', 'user_name')).toBe(true);
	});

	it('requires word boundary before @', () => {
		expect(containsMention('test@alice', 'alice')).toBe(false);
	});
});

describe('calculatePickerHeight', () => {
	it('returns empty state height for 0 suggestions', () => {
		expect(calculatePickerHeight(0)).toBe(MENTION_PICKER.EMPTY_STATE_HEIGHT);
	});

	it('calculates height for single suggestion', () => {
		expect(calculatePickerHeight(1)).toBe(MENTION_PICKER.ITEM_HEIGHT + MENTION_PICKER.PADDING);
	});

	it('calculates height for multiple suggestions', () => {
		expect(calculatePickerHeight(3)).toBe(3 * MENTION_PICKER.ITEM_HEIGHT + MENTION_PICKER.PADDING);
	});

	it('caps at max suggestions', () => {
		const maxHeight = MAX_MENTION_SUGGESTIONS * MENTION_PICKER.ITEM_HEIGHT + MENTION_PICKER.PADDING;
		expect(calculatePickerHeight(10)).toBe(maxHeight);
		expect(calculatePickerHeight(100)).toBe(maxHeight);
	});
});

describe('calculatePickerWidth', () => {
	it('returns minimum width for small content', () => {
		expect(calculatePickerWidth(50, 30)).toBe(MENTION_PICKER.MIN_WIDTH);
	});

	it('calculates width for larger content', () => {
		const nameWidth = 150;
		const statusWidth = 50;
		const expected = nameWidth + statusWidth + MENTION_PICKER.HORIZONTAL_PADDING;
		expect(calculatePickerWidth(nameWidth, statusWidth)).toBe(expected);
	});

	it('rounds up to nearest integer', () => {
		const result = calculatePickerWidth(150.5, 50.3);
		expect(Number.isInteger(result)).toBe(true);
	});
});
