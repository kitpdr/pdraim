import { query } from './_generated/server';
import { authQuery } from './auth';
import { v } from 'convex/values';

// Timeout threshold for marking users as offline (2 minutes)
const ONLINE_TIMEOUT_MS = 2 * 60 * 1000;

// Helper to compute effective status based on lastSeen timeout.
// Returns 'online', 'away', 'busy', 'idle', or 'offline'.
// Note: This is a read-time computation - the database stores the last known status
// and lastSeen timestamp. The client heartbeat (via /api/status) updates these values.
// This function computes what to display when a user stops sending heartbeats.
function computeEffectiveStatus(
	status: string,
	lastSeen: number | undefined
): 'online' | 'away' | 'busy' | 'idle' | 'offline' {
	if (status === 'offline') return 'offline';
	const timeoutThreshold = Date.now() - ONLINE_TIMEOUT_MS;
	const effectiveLastSeen = lastSeen ?? 0;
	if (effectiveLastSeen < timeoutThreshold) {
		return 'offline';
	}
	return status as 'online' | 'away' | 'busy' | 'idle';
}

// ============ PUBLIC QUERIES (no auth required) ============

// Public query: Get messages for a chat room (real-time subscription)
// Max 100 messages for public/unauthenticated users
const PUBLIC_MESSAGE_LIMIT = 100;

export const getMessagesPublic = query({
	args: {
		roomId: v.id('chatRooms'),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		// Enforce max limit and clamp to a safe positive integer
		const rawLimit = args.limit ?? PUBLIC_MESSAGE_LIMIT;
		const limit = Math.max(1, Math.min(PUBLIC_MESSAGE_LIMIT, Math.floor(rawLimit)));

		const messages = await ctx.db
			.query('messages')
			.withIndex('by_chatRoom', (q) => q.eq('chatRoomId', args.roomId))
			.order('desc')
			.take(limit);

		// Enrich messages with sender info
		const enrichedMessages = await Promise.all(
			messages.map(async (msg) => {
				const sender = await ctx.db.get(msg.senderId);
				return {
					id: msg._id,
					chatRoomId: msg.chatRoomId,
					senderId: msg.senderId,
					content: msg.content,
					type: msg.type,
					timestamp: msg.timestamp,
					styleData: msg.styleData,
					hasFormatting: msg.hasFormatting,
					sender: sender
						? {
								id: sender._id,
								nickname: sender.nickname,
								status: computeEffectiveStatus(sender.status, sender.lastSeen),
								avatarUrl: sender.avatarUrl
							}
						: null
				};
			})
		);

		// Return in chronological order (oldest first)
		return enrichedMessages.reverse();
	}
});

// Public query: Get paginated messages for a chat room (older history)
export const getMessagesPublicPage = query({
	args: {
		roomId: v.id('chatRooms'),
		limit: v.optional(v.number()),
		beforeTimestamp: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const rawLimit = args.limit ?? 50;
		const limit = Math.max(1, Math.min(PUBLIC_MESSAGE_LIMIT, Math.floor(rawLimit)));

		let query = ctx.db
			.query('messages')
			.withIndex('by_chatRoom', (q) => q.eq('chatRoomId', args.roomId))
			.order('desc');

		const beforeTimestamp = args.beforeTimestamp;
		if (beforeTimestamp !== undefined) {
			query = query.filter((q) => q.lt(q.field('timestamp'), beforeTimestamp));
		}

		const messages = await query.take(limit + 1);
		const page = messages.slice(0, limit);

		return {
			messages: page.map((msg) => ({
				id: msg._id,
				chatRoomId: msg.chatRoomId,
				senderId: msg.senderId,
				content: msg.content,
				type: msg.type,
				timestamp: msg.timestamp,
				styleData: msg.styleData,
				hasFormatting: msg.hasFormatting
			})),
			hasMore: messages.length > limit
		};
	}
});

// Public query: Get all users (real-time subscription for buddy list)
export const getUsersPublic = query({
	args: {},
	handler: async (ctx) => {
		const users = await ctx.db.query('users').collect();

		// Return safe user data (no passwords) with computed status
		return users.map((user) => ({
			id: user._id,
			nickname: user.nickname,
			status: computeEffectiveStatus(user.status, user.lastSeen),
			avatarUrl: user.avatarUrl,
			lastSeen: user.lastSeen
		}));
	}
});

// Public query: Get default room
export const getDefaultRoomPublic = query({
	args: {},
	handler: async (ctx) => {
		const rooms = await ctx.db.query('chatRooms').collect();
		const defaultRoom = rooms.find((r) => r.name === 'General' && r.type === 'group');

		if (defaultRoom) {
			return {
				id: defaultRoom._id,
				name: defaultRoom.name,
				type: defaultRoom.type,
				createdAt: defaultRoom.createdAt
			};
		}

		// Return first group room if General doesn't exist
		const firstGroup = rooms.find((r) => r.type === 'group');
		if (firstGroup) {
			return {
				id: firstGroup._id,
				name: firstGroup.name,
				type: firstGroup.type,
				createdAt: firstGroup.createdAt
			};
		}

		return null;
	}
});

// ============ AUTHENTICATED QUERIES ============

// Authenticated query: Get messages for a chat room (real-time subscription)
export const getMessages = authQuery({
	args: {
		roomId: v.id('chatRooms'),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const MAX_AUTH_MESSAGE_LIMIT = 200;
		const rawLimit = args.limit ?? 100;
		const limit = Math.max(1, Math.min(MAX_AUTH_MESSAGE_LIMIT, Math.floor(rawLimit)));
		const query = ctx.db
			.query('messages')
			.withIndex('by_chatRoom', (q) => q.eq('chatRoomId', args.roomId))
			.order('desc');

		const messages = await query.take(limit);

		// Enrich messages with sender info
		const enrichedMessages = await Promise.all(
			messages.map(async (msg) => {
				const sender = await ctx.db.get(msg.senderId);
				return {
					id: msg._id,
					chatRoomId: msg.chatRoomId,
					senderId: msg.senderId,
					content: msg.content,
					type: msg.type,
					timestamp: msg.timestamp,
					styleData: msg.styleData,
					hasFormatting: msg.hasFormatting,
					sender: sender
						? {
								id: sender._id,
								nickname: sender.nickname,
								status: computeEffectiveStatus(sender.status, sender.lastSeen),
								avatarUrl: sender.avatarUrl
							}
						: null
				};
			})
		);

		// Return in chronological order (oldest first)
		return enrichedMessages.reverse();
	}
});

// Authenticated query: Get all users (real-time subscription for buddy list)
export const getUsers = authQuery({
	args: {},
	handler: async (ctx) => {
		const users = await ctx.db.query('users').collect();

		// Return safe user data (no passwords) with computed status
		return users.map((user) => ({
			id: user._id,
			nickname: user.nickname,
			status: computeEffectiveStatus(user.status, user.lastSeen),
			avatarUrl: user.avatarUrl,
			lastSeen: user.lastSeen
		}));
	}
});

// Authenticated query: Get chat rooms
export const getChatRooms = authQuery({
	args: {},
	handler: async (ctx) => {
		const rooms = await ctx.db.query('chatRooms').collect();
		return rooms.map((room) => ({
			id: room._id,
			name: room.name,
			type: room.type,
			createdAt: room.createdAt
		}));
	}
});

// Authenticated query: Get default room (or first group room)
export const getDefaultRoom = authQuery({
	args: {},
	handler: async (ctx) => {
		const rooms = await ctx.db.query('chatRooms').collect();
		const defaultRoom = rooms.find((r) => r.name === 'General' && r.type === 'group');

		if (defaultRoom) {
			return {
				id: defaultRoom._id,
				name: defaultRoom.name,
				type: defaultRoom.type,
				createdAt: defaultRoom.createdAt
			};
		}

		// Return first group room if General doesn't exist
		const firstGroup = rooms.find((r) => r.type === 'group');
		if (firstGroup) {
			return {
				id: firstGroup._id,
				name: firstGroup.name,
				type: firstGroup.type,
				createdAt: firstGroup.createdAt
			};
		}

		return null;
	}
});

// Authenticated query: Get current user info
export const getCurrentUser = authQuery({
	args: {},
	handler: async (ctx) => {
		// ctx.user is provided by authQuery
		return {
			id: ctx.user._id,
			nickname: ctx.user.nickname,
			status: ctx.user.status,
			avatarUrl: ctx.user.avatarUrl,
			lastSeen: ctx.user.lastSeen,
			lastReadMentionTimestamp: ctx.user.lastReadMentionTimestamp
		};
	}
});
