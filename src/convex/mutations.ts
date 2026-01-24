import { mutation } from './_generated/server';
import { authMutation } from './auth';
import { v } from 'convex/values';

// Authenticated mutation: Send a message
export const sendMessage = authMutation({
	args: {
		chatRoomId: v.id('chatRooms'),
		content: v.string(),
		type: v.optional(v.string()),
		styleData: v.optional(v.string()),
		hasFormatting: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		// ctx.user is provided by authMutation
		const user = ctx.user;

		// Verify room exists
		const room = await ctx.db.get(args.chatRoomId);
		if (!room) {
			throw new Error('Chat room not found');
		}

		const messageId = await ctx.db.insert('messages', {
			chatRoomId: args.chatRoomId,
			senderId: user._id,
			content: args.content,
			type: args.type ?? 'chat',
			timestamp: Date.now(),
			styleData: args.styleData,
			hasFormatting: args.hasFormatting ?? false
		});

		const message = await ctx.db.get(messageId);

		// Return enriched message
		return {
			id: message!._id,
			chatRoomId: message!.chatRoomId,
			senderId: message!.senderId,
			content: message!.content,
			type: message!.type,
			timestamp: message!.timestamp,
			styleData: message!.styleData,
			hasFormatting: message!.hasFormatting,
			sender: {
				id: user._id,
				nickname: user.nickname,
				status: user.status,
				avatarUrl: user.avatarUrl
			}
		};
	}
});

// Authenticated mutation: Update current user's status
export const updateMyStatus = authMutation({
	args: {
		status: v.string()
	},
	handler: async (ctx, args) => {
		const validStatuses = ['online', 'away', 'busy', 'offline', 'idle'];
		if (!validStatuses.includes(args.status)) {
			throw new Error('Invalid status');
		}

		await ctx.db.patch(ctx.user._id, {
			status: args.status,
			lastSeen: Date.now()
		});

		const updated = await ctx.db.get(ctx.user._id);
		return {
			id: updated!._id,
			nickname: updated!.nickname,
			status: updated!.status,
			avatarUrl: updated!.avatarUrl,
			lastSeen: updated!.lastSeen
		};
	}
});

// Public mutation: Create or get default room (can be called during init)
export const getOrCreateDefaultRoom = mutation({
	args: {},
	handler: async (ctx) => {
		// Look for existing General room
		const rooms = await ctx.db.query('chatRooms').collect();
		const generalRoom = rooms.find((r) => r.name === 'General' && r.type === 'group');

		if (generalRoom) {
			return {
				id: generalRoom._id,
				name: generalRoom.name,
				type: generalRoom.type,
				createdAt: generalRoom.createdAt
			};
		}

		// Create default room
		const roomId = await ctx.db.insert('chatRooms', {
			name: 'General',
			type: 'group',
			createdAt: Date.now()
		});

		const room = await ctx.db.get(roomId);
		return {
			id: room!._id,
			name: room!.name,
			type: room!.type,
			createdAt: room!.createdAt
		};
	}
});
