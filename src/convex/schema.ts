import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
	users: defineTable({
		password: v.string(),
		nickname: v.string(),
		status: v.string(), // 'offline' | 'online' | 'away' | 'busy'
		avatarUrl: v.optional(v.string()),
		createdAt: v.number(),
		lastSeen: v.optional(v.number())
	}).index('by_nickname', ['nickname']),

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
		defaultFontFamily: v.optional(v.string()),
		defaultFontSize: v.optional(v.number()),
		defaultColor: v.optional(v.string()),
		allowFormatting: v.optional(v.boolean()),
		maxMessageLength: v.optional(v.number()),
		stylePresets: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number()
	}).index('by_userId', ['userId'])
});
