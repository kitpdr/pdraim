import { users } from '$lib/db/convex.server';
import type { SafeUser } from '$lib/types/chat';
import type { PublicRoomResponse } from '$lib/types/payloads';
import { createSafeUser } from '$lib/types/chat';
import { createLogger } from '$lib/utils/logger.server';
import type { RequestHandler } from './$types';

const log = createLogger('rooms-server');

const ONLINE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

export const GET: RequestHandler = async ({ params, url, locals }) => {
	const { roomId } = params;
	const isPublic = !locals.user || url.searchParams.get('public') === 'true';

	try {
		log.debug('Fetching room data', {
			roomId,
			isPublic,
			requestedBy: locals.user
				? `${locals.user.id.slice(0, 4)}...${locals.user.id.slice(-4)}`
				: 'public'
		});

		// Calculate timeout threshold
		const timeoutThreshold = Date.now() - ONLINE_TIMEOUT_MS;

		// Fetch all users from Convex
		const fetchedUsers = await users.list();

		// Process users to mark them as offline if they've timed out
		const processedUsers = fetchedUsers.map((user) => {
			const lastSeen = user.lastSeen ?? 0;
			const shouldBeOffline = user.status !== 'offline' && lastSeen < timeoutThreshold;
			return {
				id: user._id,
				nickname: user.nickname,
				status: shouldBeOffline ? 'offline' : user.status,
				avatarUrl: user.avatarUrl,
				lastSeen
			};
		});

		// Find users who should be marked offline and update them
		const usersToUpdate = processedUsers.filter((user, index) => {
			const original = fetchedUsers[index];
			return user.status === 'offline' && original.status !== 'offline';
		});

		// Update timed-out users in Convex
		if (usersToUpdate.length > 0) {
			await Promise.all(usersToUpdate.map((user) => users.updateStatus(user.id, 'offline')));

			log.debug('Updated offline status for users', {
				count: usersToUpdate.length,
				userIds: usersToUpdate.map((u) => u.id)
			});
		}

		// Sanitize user data
		const sanitizedUsers: SafeUser[] = processedUsers.map((user) =>
			createSafeUser({
				id: user.id,
				nickname: user.nickname,
				status: user.status,
				avatarUrl: user.avatarUrl,
				lastSeen: user.lastSeen
			})
		);

		const responseData: PublicRoomResponse = {
			success: true,
			buddyList: sanitizedUsers
		};

		log.debug('Successfully fetched room data', {
			roomId,
			userCount: sanitizedUsers.length,
			isPublic,
			offlineUpdates: usersToUpdate.length
		});

		return new Response(JSON.stringify(responseData), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		log.error('Error fetching room data', {
			roomId,
			error: error instanceof Error ? error.message : 'Unknown error'
		});
		const errorResponse: PublicRoomResponse = {
			success: false,
			error: 'Failed to fetch room data'
		};
		return new Response(JSON.stringify(errorResponse), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
