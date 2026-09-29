/**
 * AIM features: buddy list, direct (IM) rooms, away messages, profiles,
 * typing indicators and read cursors.
 *
 * Client-side access uses authQuery/authMutation with the session token hash
 * (already exposed to the client as `session.id`).
 */
import { query } from './_generated/server';
import { authQuery, authMutation } from './auth';
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';

const ONLINE_TIMEOUT_MS = 2 * 60 * 1000;
const TYPING_TTL_MS = 6 * 1000;
const MAX_AWAY_LENGTH = 300;
const MAX_PROFILE_LENGTH = 1000;
const MAX_ROOM_NAME_LENGTH = 40;
const MAX_TOPIC_LENGTH = 120;
const DEFAULT_GROUP = 'Buddies';
// Unread badges stop counting here (shown as "99+")
export const MAX_UNREAD_COUNT = 100;

export type EffectiveStatus = 'online' | 'away' | 'busy' | 'idle' | 'offline';

export function computeEffectiveStatus(
	status: string,
	lastSeen: number | undefined
): EffectiveStatus {
	if (status === 'offline') return 'offline';
	if ((lastSeen ?? 0) < Date.now() - ONLINE_TIMEOUT_MS) return 'offline';
	return status as EffectiveStatus;
}

export function toPublicUser(user: Doc<'users'>) {
	const status = computeEffectiveStatus(user.status, user.lastSeen);
	return {
		id: user._id,
		nickname: user.nickname,
		status,
		avatarUrl: user.avatarUrl,
		lastSeen: user.lastSeen,
		awayMessage: status === 'away' ? user.awayMessage : undefined,
		createdAt: user.createdAt
	};
}

export function directKeyFor(a: Id<'users'>, b: Id<'users'>) {
	return [a, b].sort().join(':');
}

export async function assertRoomAccess(ctx: QueryCtx, room: Doc<'chatRooms'>, userId: Id<'users'>) {
	if (room.type === 'direct' && !(room.memberIds ?? []).includes(userId)) {
		throw new Error('Not a member of this conversation');
	}
}

// ============ PUBLIC ============

export const getUserProfile = query({
	args: { userId: v.id('users') },
	handler: async (ctx, args) => {
		const user = await ctx.db.get(args.userId);
		if (!user) return null;
		return { ...toPublicUser(user), profile: user.profile };
	}
});

export const getGroupRooms = query({
	args: {},
	handler: async (ctx) => {
		const rooms = await ctx.db.query('chatRooms').collect();
		return rooms
			.filter((r) => r.type === 'group')
			.sort((a, b) => a.createdAt - b.createdAt)
			.map((r) => ({
				id: r._id,
				name: r.name ?? 'Sans nom',
				topic: r.topic,
				createdAt: r.createdAt,
				isDefault: r.name === 'General'
			}));
	}
});

// ============ AUTHENTICATED QUERIES ============

export const getMyBuddies = authQuery({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db
			.query('buddies')
			.withIndex('by_user', (q) => q.eq('userId', ctx.user._id))
			.collect();
		const buddies = await Promise.all(
			rows.map(async (row) => {
				const user = await ctx.db.get(row.buddyId);
				if (!user) return null;
				return { ...toPublicUser(user), group: row.group, addedAt: row.createdAt };
			})
		);
		return buddies.filter((b) => b !== null);
	}
});

export const getMyDirectRooms = authQuery({
	args: {},
	handler: async (ctx) => {
		const me = ctx.user._id;
		const rooms = (await ctx.db.query('chatRooms').collect()).filter(
			(r) => r.type === 'direct' && (r.memberIds ?? []).includes(me)
		);
		const reads = await ctx.db
			.query('roomReads')
			.withIndex('by_user', (q) => q.eq('userId', me))
			.collect();
		const readMap = new Map(reads.map((r) => [r.roomId, r.lastReadTimestamp]));

		const result = await Promise.all(
			rooms.map(async (room) => {
				const otherId = (room.memberIds ?? []).find((id) => id !== me);
				const other = otherId ? await ctx.db.get(otherId) : null;
				const lastRead = readMap.get(room._id) ?? 0;
				const lastMessage = await ctx.db
					.query('messages')
					.withIndex('by_chatRoom', (q) => q.eq('chatRoomId', room._id))
					.order('desc')
					.first();
				// Incoming messages after the read cursor, capped for the "99+" badge. Every index
				// ends with _creationTime, so the range scan stops at the cursor.
				const unreadCount = (
					await ctx.db
						.query('messages')
						.withIndex('by_chatRoom', (q) =>
							q.eq('chatRoomId', room._id).gt('_creationTime', lastRead)
						)
						.filter((q) => q.neq(q.field('senderId'), me))
						.take(MAX_UNREAD_COUNT)
				).length;
				return {
					id: room._id,
					other: other ? toPublicUser(other) : null,
					lastMessage: lastMessage
						? {
								content: lastMessage.content,
								timestamp: lastMessage.timestamp,
								senderId: lastMessage.senderId
							}
						: null,
					unreadCount
				};
			})
		);
		return result.sort((a, b) => (b.lastMessage?.timestamp ?? 0) - (a.lastMessage?.timestamp ?? 0));
	}
});

export const getRoomMessages = authQuery({
	args: { roomId: v.id('chatRooms'), limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const room = await ctx.db.get(args.roomId);
		if (!room) return [];
		await assertRoomAccess(ctx, room, ctx.user._id);
		const limit = Math.max(1, Math.min(200, Math.floor(args.limit ?? 100)));
		const messages = await ctx.db
			.query('messages')
			.withIndex('by_chatRoom', (q) => q.eq('chatRoomId', args.roomId))
			.order('desc')
			.take(limit);
		const enriched = await Promise.all(
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
		return enriched.reverse();
	}
});

export const getRoomTyping = authQuery({
	args: { roomId: v.id('chatRooms') },
	handler: async (ctx, args) => {
		const room = await ctx.db.get(args.roomId);
		if (!room) return [];
		await assertRoomAccess(ctx, room, ctx.user._id);
		const since = Date.now() - TYPING_TTL_MS;
		const rows = await ctx.db
			.query('typing')
			.withIndex('by_room', (q) => q.eq('roomId', args.roomId))
			.collect();
		const active = rows.filter((r) => r.updatedAt > since && r.userId !== ctx.user._id);
		const users = await Promise.all(active.map((r) => ctx.db.get(r.userId)));
		return users.filter((u) => u !== null).map((u) => ({ id: u._id, nickname: u.nickname }));
	}
});

export const getMe = authQuery({
	args: {},
	handler: async (ctx) => {
		const u = ctx.user;
		return {
			id: u._id,
			nickname: u.nickname,
			status: u.status,
			awayMessage: u.awayMessage,
			profile: u.profile,
			createdAt: u.createdAt
		};
	}
});

// ============ AUTHENTICATED MUTATIONS ============

export const setAwayMessage = authMutation({
	args: { awayMessage: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const text = args.awayMessage?.trim().slice(0, MAX_AWAY_LENGTH);
		if (text) {
			await ctx.db.patch(ctx.user._id, { awayMessage: text, status: 'away', lastSeen: Date.now() });
		} else {
			await ctx.db.patch(ctx.user._id, {
				awayMessage: undefined,
				status: 'online',
				lastSeen: Date.now()
			});
		}
		return { success: true };
	}
});

export const updateProfile = authMutation({
	args: { profile: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const patch: Partial<Doc<'users'>> = {};
		if (args.profile !== undefined)
			patch.profile = args.profile.trim().slice(0, MAX_PROFILE_LENGTH);
		await ctx.db.patch(ctx.user._id, patch);
		return { success: true };
	}
});

export const addBuddy = authMutation({
	args: { buddyId: v.id('users'), group: v.optional(v.string()) },
	handler: async (ctx, args) => {
		if (args.buddyId === ctx.user._id) throw new Error('Impossible de s’ajouter soi-même');
		const buddy = await ctx.db.get(args.buddyId);
		if (!buddy) throw new Error('User not found');
		const group = (args.group?.trim() || DEFAULT_GROUP).slice(0, 30);
		const existing = await ctx.db
			.query('buddies')
			.withIndex('by_user_buddy', (q) => q.eq('userId', ctx.user._id).eq('buddyId', args.buddyId))
			.first();
		if (existing) {
			await ctx.db.patch(existing._id, { group });
			return { success: true, id: existing._id };
		}
		const id = await ctx.db.insert('buddies', {
			userId: ctx.user._id,
			buddyId: args.buddyId,
			group,
			createdAt: Date.now()
		});
		return { success: true, id };
	}
});

export const removeBuddy = authMutation({
	args: { buddyId: v.id('users') },
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('buddies')
			.withIndex('by_user_buddy', (q) => q.eq('userId', ctx.user._id).eq('buddyId', args.buddyId))
			.first();
		if (existing) await ctx.db.delete(existing._id);
		return { success: true };
	}
});

export const getOrCreateDirectRoom = authMutation({
	args: { otherUserId: v.id('users') },
	handler: async (ctx, args) => {
		if (args.otherUserId === ctx.user._id) throw new Error('Cannot IM yourself');
		const other = await ctx.db.get(args.otherUserId);
		if (!other) throw new Error('User not found');
		const key = directKeyFor(ctx.user._id, args.otherUserId);
		const existing = await ctx.db
			.query('chatRooms')
			.withIndex('by_directKey', (q) => q.eq('directKey', key))
			.first();
		if (existing) return { id: existing._id };
		const id = await ctx.db.insert('chatRooms', {
			type: 'direct',
			createdAt: Date.now(),
			createdBy: ctx.user._id,
			memberIds: [ctx.user._id, args.otherUserId],
			directKey: key
		});
		return { id };
	}
});

export const createGroupRoom = authMutation({
	args: { name: v.string(), topic: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const name = args.name.trim().slice(0, MAX_ROOM_NAME_LENGTH);
		if (name.length < 2) throw new Error('Nom de salon trop court');
		const rooms = await ctx.db.query('chatRooms').collect();
		const clash = rooms.find(
			(r) => r.type === 'group' && (r.name ?? '').toLowerCase() === name.toLowerCase()
		);
		if (clash) return { id: clash._id, existed: true };
		const id = await ctx.db.insert('chatRooms', {
			name,
			type: 'group',
			topic: args.topic?.trim().slice(0, MAX_TOPIC_LENGTH) || undefined,
			createdAt: Date.now(),
			createdBy: ctx.user._id
		});
		return { id, existed: false };
	}
});

export const markRoomRead = authMutation({
	args: { roomId: v.id('chatRooms') },
	handler: async (ctx, args) => {
		const room = await ctx.db.get(args.roomId);
		if (!room) throw new Error('Chat room not found');
		await assertRoomAccess(ctx, room, ctx.user._id);
		const now = Date.now();
		const existing = await ctx.db
			.query('roomReads')
			.withIndex('by_user_room', (q) => q.eq('userId', ctx.user._id).eq('roomId', args.roomId))
			.first();
		if (existing) {
			if (existing.lastReadTimestamp < now) {
				await ctx.db.patch(existing._id, { lastReadTimestamp: now });
			}
		} else {
			await ctx.db.insert('roomReads', {
				userId: ctx.user._id,
				roomId: args.roomId,
				lastReadTimestamp: now
			});
		}
		return { success: true };
	}
});

export const setTyping = authMutation({
	args: { roomId: v.id('chatRooms'), typing: v.boolean() },
	handler: async (ctx, args) => {
		const room = await ctx.db.get(args.roomId);
		if (!room) throw new Error('Chat room not found');
		await assertRoomAccess(ctx, room, ctx.user._id);
		const existing = await ctx.db
			.query('typing')
			.withIndex('by_user_room', (q) => q.eq('userId', ctx.user._id).eq('roomId', args.roomId))
			.first();
		if (!args.typing) {
			if (existing) await ctx.db.delete(existing._id);
			return { success: true };
		}
		if (existing) {
			await ctx.db.patch(existing._id, { updatedAt: Date.now() });
		} else {
			await ctx.db.insert('typing', {
				userId: ctx.user._id,
				roomId: args.roomId,
				updatedAt: Date.now()
			});
		}
		return { success: true };
	}
});
