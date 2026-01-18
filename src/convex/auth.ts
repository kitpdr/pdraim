import { query, mutation } from './_generated/server';
import { customQuery, customMutation } from 'convex-helpers/server/customFunctions';
import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import type { QueryCtx, MutationCtx } from './_generated/server';

// Helper to validate session and get user
async function validateSession(
	ctx: QueryCtx | MutationCtx,
	tokenHash: string
): Promise<{ session: Doc<'sessions'>; user: Doc<'users'> }> {
	const session = await ctx.db
		.query('sessions')
		.withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
		.first();

	if (!session) {
		throw new Error('Invalid session');
	}

	if (session.expiresAt < Date.now()) {
		throw new Error('Session expired');
	}

	const user = await ctx.db.get(session.userId);
	if (!user) {
		throw new Error('User not found');
	}

	return { session, user };
}

// Authenticated query - requires tokenHash, provides user in context
export const authQuery = customQuery(query, {
	args: { tokenHash: v.string() },
	input: async (ctx, { tokenHash }) => {
		const { session, user } = await validateSession(ctx, tokenHash);
		return { ctx: { session, user }, args: {} };
	}
});

// Authenticated mutation - requires tokenHash, provides user in context
export const authMutation = customMutation(mutation, {
	args: { tokenHash: v.string() },
	input: async (ctx, { tokenHash }) => {
		const { session, user } = await validateSession(ctx, tokenHash);
		return { ctx: { session, user }, args: {} };
	}
});

// Type helpers for use in handlers
export type AuthQueryCtx = QueryCtx & { session: Doc<'sessions'>; user: Doc<'users'> };
export type AuthMutationCtx = MutationCtx & { session: Doc<'sessions'>; user: Doc<'users'> };
