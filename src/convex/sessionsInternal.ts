import { internalQuery, internalMutation } from './_generated/server';
import { v } from 'convex/values';

// Create a new session (internal)
export const create = internalMutation({
	args: {
		tokenHash: v.string(), // SHA-256 hash of the token
		userId: v.id('users'),
		expiresAt: v.number()
	},
	handler: async (ctx, args) => {
		const user = await ctx.db.get(args.userId);
		if (!user) {
			throw new Error('User not found');
		}

		const id = await ctx.db.insert('sessions', {
			tokenHash: args.tokenHash,
			userId: args.userId,
			expiresAt: args.expiresAt,
			createdAt: Date.now()
		});

		return { id, tokenHash: args.tokenHash };
	}
});

// Validate session and get user (internal)
export const validateAndGetUser = internalQuery({
	args: { tokenHash: v.string() },
	handler: async (ctx, args) => {
		// Find session by token hash
		const session = await ctx.db
			.query('sessions')
			.withIndex('by_tokenHash', (q) => q.eq('tokenHash', args.tokenHash))
			.first();

		if (!session) {
			return { session: null, user: null };
		}

		// Check if expired
		if (session.expiresAt < Date.now()) {
			return { session: null, user: null };
		}

		// Get the user
		const user = await ctx.db.get(session.userId);
		if (!user) {
			return { session: null, user: null };
		}

		return { session, user };
	}
});

// Delete a session by token hash (internal)
export const remove = internalMutation({
	args: { tokenHash: v.string() },
	handler: async (ctx, args) => {
		const session = await ctx.db
			.query('sessions')
			.withIndex('by_tokenHash', (q) => q.eq('tokenHash', args.tokenHash))
			.first();

		if (session) {
			await ctx.db.delete(session._id);
		}
	}
});

// Delete all sessions for a user (internal)
export const removeAllForUser = internalMutation({
	args: { userId: v.id('users') },
	handler: async (ctx, args) => {
		const sessions = await ctx.db
			.query('sessions')
			.withIndex('by_userId', (q) => q.eq('userId', args.userId))
			.collect();

		for (const session of sessions) {
			await ctx.db.delete(session._id);
		}

		return { deleted: sessions.length };
	}
});
