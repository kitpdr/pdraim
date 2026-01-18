import { error, json } from '@sveltejs/kit';
import { users } from '$lib/db/convex.server';
import type { RequestHandler } from './$types';
import { createSafeUser } from '$lib/types/chat';
import { createLogger } from '$lib/utils/logger.server';

const log = createLogger('users-server');

export const GET: RequestHandler = async ({ params }) => {
	const maskedUserId = `${params.userId.slice(0, 4)}...${params.userId.slice(-4)}`;
	log.debug('Fetching user data', { userId: maskedUserId });

	try {
		const user = await users.getById(params.userId);

		if (!user) {
			log.warn('User not found', { userId: maskedUserId });
			throw error(404, 'User not found');
		}

		const safeUser = createSafeUser({
			id: user._id,
			nickname: user.nickname,
			status: user.status,
			avatarUrl: user.avatarUrl,
			lastSeen: user.lastSeen
		});

		log.debug('User data retrieved', {
			userId: maskedUserId,
			status: safeUser.status,
			lastSeen: safeUser.lastSeen ? new Date(safeUser.lastSeen).toISOString() : null
		});

		return json({
			success: true,
			user: safeUser
		});
	} catch (err) {
		log.error('Error fetching user data', {
			userId: maskedUserId,
			error: err instanceof Error ? err.message : 'Unknown error'
		});
		throw error(500, 'Failed to fetch user information');
	}
};
