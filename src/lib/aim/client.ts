/**
 * Client-side helpers for authenticated Convex calls (AIM features).
 *
 * Every authQuery/authMutation needs `tokenHash`; this module reads it from
 * chatState so components only pass their own args.
 */
import { useConvexClient, useQuery } from 'convex-svelte';
import { api } from '../../convex/_generated/api';
import type { FunctionReference, FunctionArgs } from 'convex/server';
import type { Id } from '../../convex/_generated/dataModel';
import { chatState } from '$lib/states/chat.svelte';
import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';

export const convexAvailable = browser && Boolean(env.PUBLIC_CONVEX_URL);

/** Returns the current tokenHash or null when signed out. Reactive when read inside $derived. */
export function tokenHash() {
	return chatState.getSessionTokenHash();
}

/**
 * Subscribe to an authenticated query. Must be called at component init
 * (top level of <script>), like useQuery. The subscription is skipped while
 * signed out and resumes automatically after login (data is undefined meanwhile).
 *
 *   const buddies = authQuery(api.aim.getMyBuddies, () => ({}));
 *   buddies?.data
 */
export function authQuery<Q extends FunctionReference<'query'>>(
	fn: Q,
	args: () => Omit<FunctionArgs<Q>, 'tokenHash'> | 'skip' = () =>
		({}) as Omit<FunctionArgs<Q>, 'tokenHash'>
) {
	if (!convexAvailable) return null;
	return useQuery(fn, () => {
		const hash = tokenHash();
		const a = args();
		if (!hash || a === 'skip') return 'skip';
		return { tokenHash: hash, ...a } as FunctionArgs<Q>;
	});
}

export function useAimClient() {
	const client = convexAvailable ? useConvexClient() : null;

	function requireAuth() {
		const hash = tokenHash();
		if (!client || !hash) throw new Error('Non connecté');
		return { client, hash };
	}

	return {
		client,
		async addBuddy(buddyId: Id<'users'>, group?: string) {
			const { client, hash } = requireAuth();
			return client.mutation(api.aim.addBuddy, { tokenHash: hash, buddyId, group });
		},
		async removeBuddy(buddyId: Id<'users'>) {
			const { client, hash } = requireAuth();
			return client.mutation(api.aim.removeBuddy, { tokenHash: hash, buddyId });
		},
		async getOrCreateDirectRoom(otherUserId: Id<'users'>) {
			const { client, hash } = requireAuth();
			return client.mutation(api.aim.getOrCreateDirectRoom, { tokenHash: hash, otherUserId });
		},
		async createGroupRoom(name: string, topic?: string) {
			const { client, hash } = requireAuth();
			return client.mutation(api.aim.createGroupRoom, { tokenHash: hash, name, topic });
		},
		async setAwayMessage(awayMessage?: string) {
			const { client, hash } = requireAuth();
			return client.mutation(api.aim.setAwayMessage, { tokenHash: hash, awayMessage });
		},
		async updateProfile(patch: { profile?: string; buddyIcon?: string }) {
			const { client, hash } = requireAuth();
			return client.mutation(api.aim.updateProfile, { tokenHash: hash, ...patch });
		},
		async markRoomRead(roomId: Id<'chatRooms'>) {
			const { client, hash } = requireAuth();
			return client.mutation(api.aim.markRoomRead, { tokenHash: hash, roomId });
		},
		async setTyping(roomId: Id<'chatRooms'>, typing: boolean) {
			const { client, hash } = requireAuth();
			return client.mutation(api.aim.setTyping, { tokenHash: hash, roomId, typing });
		}
	};
}
