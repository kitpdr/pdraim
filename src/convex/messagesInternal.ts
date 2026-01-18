import { internalQuery, internalMutation } from './_generated/server';
import { v } from 'convex/values';

// Get messages by chat room ID (internal)
export const getByRoom = internalQuery({
	args: {
		roomId: v.id('chatRooms'),
		limit: v.optional(v.number()),
		beforeTimestamp: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const limit = args.limit ?? 100;

		const allMessages = await ctx.db
			.query('messages')
			.withIndex('by_chatRoom', (q) => q.eq('chatRoomId', args.roomId))
			.collect();

		// Filter by timestamp if provided
		let filtered = allMessages;
		if (args.beforeTimestamp) {
			filtered = allMessages.filter((m) => m.timestamp < args.beforeTimestamp!);
		}

		// Sort by timestamp descending and limit
		filtered.sort((a, b) => b.timestamp - a.timestamp);
		const messages = filtered.slice(0, limit);

		return {
			messages,
			hasMore: filtered.length > limit
		};
	}
});

// Send message (internal)
export const send = internalMutation({
	args: {
		chatRoomId: v.id('chatRooms'),
		senderId: v.id('users'),
		content: v.string(),
		type: v.optional(v.string()),
		styleData: v.optional(v.string()),
		hasFormatting: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		// Verify room exists
		const room = await ctx.db.get(args.chatRoomId);
		if (!room) {
			throw new Error('Chat room not found');
		}

		// Verify user exists
		const user = await ctx.db.get(args.senderId);
		if (!user) {
			throw new Error('User not found');
		}

		const messageId = await ctx.db.insert('messages', {
			chatRoomId: args.chatRoomId,
			senderId: args.senderId,
			content: args.content,
			type: args.type ?? 'chat',
			timestamp: Date.now(),
			styleData: args.styleData,
			hasFormatting: args.hasFormatting ?? false
		});

		return await ctx.db.get(messageId);
	}
});

// Get recent messages across all rooms (internal) - for SSE polling
export const getRecent = internalQuery({
	args: {
		sinceTimestamp: v.number(),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const limit = args.limit ?? 50;

		const messages = await ctx.db
			.query('messages')
			.withIndex('by_timestamp')
			.filter((q) => q.gt(q.field('timestamp'), args.sinceTimestamp))
			.take(limit);

		return messages;
	}
});
