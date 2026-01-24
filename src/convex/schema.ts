import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
	users: defineTable({
		password: v.string(),
		nickname: v.string(),
		status: v.string(), // 'offline' | 'online' | 'away' | 'busy'
		avatarUrl: v.optional(v.string()),
		createdAt: v.number(),
		lastSeen: v.optional(v.number()),
		lastReadMentionTimestamp: v.optional(v.number()) // Timestamp of last read mention
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
		createdAt: v.number()
	}),

	messages: defineTable({
		chatRoomId: v.id('chatRooms'),
		senderId: v.id('users'),
		content: v.string(),
		type: v.string(), // 'chat' | 'emote' | 'system'
		timestamp: v.number(),
		styleData: v.optional(v.string()),
		hasFormatting: v.optional(v.boolean())
	})
		.index('by_chatRoom', ['chatRoomId'])
		.index('by_timestamp', ['timestamp']),

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
