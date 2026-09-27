import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
	users: defineTable({
		password: v.string(),
		nickname: v.string(),
		status: v.string(), // 'offline' | 'online' | 'away' | 'busy' | 'idle'
		avatarUrl: v.optional(v.string()),
		createdAt: v.number(),
		lastSeen: v.optional(v.number()),
		lastReadMentionTimestamp: v.optional(v.number()), // Timestamp of last read mention
		// AIM profile
		awayMessage: v.optional(v.string()), // Shown while status === 'away'
		profile: v.optional(v.string()) // Free text "Get Info" profile
	})
		.index('by_nickname', ['nickname'])
		.index('by_status', ['status']),

	sessions: defineTable({
		tokenHash: v.string(), // SHA-256 hash of the session token
		userId: v.id('users'),
		expiresAt: v.number(),
		createdAt: v.number()
	})
		.index('by_tokenHash', ['tokenHash'])
		.index('by_userId', ['userId']),

	chatRooms: defineTable({
		name: v.optional(v.string()),
		type: v.string(), // 'direct' | 'group'
		createdAt: v.number(),
		createdBy: v.optional(v.id('users')),
		topic: v.optional(v.string()),
		// Direct rooms: exactly two members. Group rooms: undefined (open to all).
		memberIds: v.optional(v.array(v.id('users'))),
		// Stable key for direct rooms: sorted user ids joined by ':'
		directKey: v.optional(v.string())
	}).index('by_directKey', ['directKey']),

	messages: defineTable({
		chatRoomId: v.id('chatRooms'),
		senderId: v.id('users'),
		content: v.string(),
		type: v.string(), // 'chat' | 'emote' | 'system' | 'auto-response'
		timestamp: v.number(),
		styleData: v.optional(v.string()),
		hasFormatting: v.optional(v.boolean())
	})
		.index('by_chatRoom', ['chatRoomId'])
		.index('by_timestamp', ['timestamp']),

	// AIM buddy list: one row per (owner, buddy)
	buddies: defineTable({
		userId: v.id('users'),
		buddyId: v.id('users'),
		group: v.string(), // 'Buddies' | 'Family' | 'Co-Workers' | custom
		createdAt: v.number()
	})
		.index('by_user', ['userId'])
		.index('by_user_buddy', ['userId', 'buddyId']),

	// Per-user read cursor per room (unread badges)
	roomReads: defineTable({
		userId: v.id('users'),
		roomId: v.id('chatRooms'),
		lastReadTimestamp: v.number()
	})
		.index('by_user', ['userId'])
		.index('by_user_room', ['userId', 'roomId']),

	// Typing indicators (short-lived, filtered by timestamp at read time)
	typing: defineTable({
		userId: v.id('users'),
		roomId: v.id('chatRooms'),
		updatedAt: v.number()
	})
		.index('by_room', ['roomId'])
		.index('by_user_room', ['userId', 'roomId']),

	userTextPreferences: defineTable({
		userId: v.id('users'),
		defaultStyle: v.object({
			fontFamily: v.string(),
			fontSize: v.number(),
			color: v.optional(v.string()),
			gradient: v.optional(v.array(v.string())),
			bold: v.boolean(),
			italic: v.boolean(),
			underline: v.boolean(),
			strikethrough: v.boolean()
		}),
		allowFormatting: v.boolean(),
		maxMessageLength: v.number(),
		createdAt: v.number(),
		updatedAt: v.number()
	}).index('by_userId', ['userId'])
});
