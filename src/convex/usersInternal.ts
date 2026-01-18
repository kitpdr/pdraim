import { internalQuery, internalMutation } from './_generated/server';
import { v } from 'convex/values';

// Get user by nickname (internal)
export const getByNickname = internalQuery({
	args: { nickname: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('users')
			.withIndex('by_nickname', (q) => q.eq('nickname', args.nickname))
			.first();
	}
});

// Get user by ID (internal)
export const getById = internalQuery({
	args: { id: v.id('users') },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.id);
	}
});

// Get all users (internal)
export const list = internalQuery({
	args: {},
	handler: async (ctx) => {
		return await ctx.db.query('users').collect();
	}
});

// Create a new user (internal)
export const create = internalMutation({
	args: {
		nickname: v.string(),
		password: v.string()
	},
	handler: async (ctx, args) => {
		// Check if nickname already exists
		const existing = await ctx.db
			.query('users')
			.withIndex('by_nickname', (q) => q.eq('nickname', args.nickname))
			.first();

		if (existing) {
			throw new Error('Username already taken');
		}

		const userId = await ctx.db.insert('users', {
			nickname: args.nickname,
			password: args.password,
			status: 'offline',
			createdAt: Date.now()
		});

		return userId;
	}
});

// Update user status by ID (internal)
export const updateStatus = internalMutation({
	args: {
		id: v.id('users'),
		status: v.string()
	},
	handler: async (ctx, args) => {
		const validStatuses = ['online', 'away', 'busy', 'offline', 'idle'];
		if (!validStatuses.includes(args.status)) {
			throw new Error('Invalid status');
		}

		const user = await ctx.db.get(args.id);
		if (!user) {
			throw new Error('User not found');
		}

		await ctx.db.patch(args.id, {
			status: args.status,
			lastSeen: Date.now()
		});

		return await ctx.db.get(args.id);
	}
});

// Set all users offline (internal) - used on server startup
export const setAllOffline = internalMutation({
	args: {},
	handler: async (ctx) => {
		const users = await ctx.db.query('users').collect();
		for (const user of users) {
			await ctx.db.patch(user._id, { status: 'offline' });
		}
		return { updated: users.length };
	}
});
