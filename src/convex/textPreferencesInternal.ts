import { internalQuery, internalMutation } from './_generated/server';
import { v } from 'convex/values';

// Get user text preferences by userId
export const getByUserId = internalQuery({
	args: { userId: v.id('users') },
	handler: async (ctx, { userId }) => {
		const preferences = await ctx.db
			.query('userTextPreferences')
			.withIndex('by_userId', (q) => q.eq('userId', userId))
			.first();

		return preferences;
	}
});

// Upsert user text preferences (create or update)
export const upsert = internalMutation({
	args: {
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
		maxMessageLength: v.number()
	},
	handler: async (ctx, args) => {
		const now = Date.now();

		// Check if preferences already exist
		const existing = await ctx.db
			.query('userTextPreferences')
			.withIndex('by_userId', (q) => q.eq('userId', args.userId))
			.first();

		if (existing) {
			// Update existing preferences
			return await ctx.db.patch(existing._id, {
				defaultStyle: args.defaultStyle,
				allowFormatting: args.allowFormatting,
				maxMessageLength: args.maxMessageLength,
				updatedAt: now
			});
		} else {
			// Create new preferences
			return await ctx.db.insert('userTextPreferences', {
				userId: args.userId,
				defaultStyle: args.defaultStyle,
				allowFormatting: args.allowFormatting,
				maxMessageLength: args.maxMessageLength,
				createdAt: now,
				updatedAt: now
			});
		}
	}
});
