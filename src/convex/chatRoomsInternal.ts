import { internalQuery, internalMutation } from './_generated/server';
import { v } from 'convex/values';

// Get chat room by ID (internal)
export const getById = internalQuery({
	args: { id: v.id('chatRooms') },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.id);
	}
});

// List all chat rooms (internal)
export const list = internalQuery({
	args: {},
	handler: async (ctx) => {
		return await ctx.db.query('chatRooms').collect();
	}
});

// Create a chat room (internal)
export const create = internalMutation({
	args: {
		name: v.optional(v.string()),
		type: v.string()
	},
	handler: async (ctx, args) => {
		const roomId = await ctx.db.insert('chatRooms', {
			name: args.name,
			type: args.type,
			createdAt: Date.now()
		});

		return await ctx.db.get(roomId);
	}
});

// Get or create the default "General" room (internal)
export const getOrCreateDefault = internalMutation({
	args: {},
	handler: async (ctx) => {
		// Look for existing General room
		const rooms = await ctx.db.query('chatRooms').collect();
		const generalRoom = rooms.find((r) => r.name === 'General' && r.type === 'group');

		if (generalRoom) {
			return generalRoom;
		}

		// Create default room
		const roomId = await ctx.db.insert('chatRooms', {
			name: 'General',
			type: 'group',
			createdAt: Date.now()
		});

		return await ctx.db.get(roomId);
	}
});
