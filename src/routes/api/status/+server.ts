import { users } from '$lib/db/convex.server';
import { validateSessionToken, generateSessionToken, createSession } from '$lib/api/session.server';
import { setSessionTokenCookie } from '$lib/api/session.cookie';
import { createSafeUser } from '$lib/types/chat';
import { createLogger } from '$lib/utils/logger.server';
import type { RequestHandler } from './$types';

const log = createLogger('status-server');

export const POST: RequestHandler = async ({ request, cookies, locals }) => {
	if (!locals.user) {
		log.warn('Authentication required');
		return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	try {
		const { status } = await request.json();
		const validStatuses = ['online', 'away', 'busy', 'offline', 'idle'];
		if (!validStatuses.includes(status)) {
			log.warn('Invalid status received', { status });
			return new Response(JSON.stringify({ success: false, error: 'Invalid status' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		const userId = locals.user.id;
		const maskedUserId = `${userId.slice(0, 4)}...${userId.slice(-4)}`;
		log.debug('Updating user status', { userId: maskedUserId, status });

		const now = Date.now();

		// Update the user status in Convex
		const updatedUser = await users.updateStatus(userId, status);
		log.debug('Convex updated successfully', { userId: maskedUserId, status });

		// Renew session if status is online and session expires in less than 1 day
		if (status === 'online') {
			try {
				const token = cookies.get('session');
				if (token) {
					const result = await validateSessionToken(token);
					if (result.session) {
						const remaining = result.session.expiresAt - now;
						const threshold = 24 * 60 * 60 * 1000; // 1 day in milliseconds
						if (remaining < threshold) {
							const newToken = generateSessionToken();
							const newSession = await createSession(newToken, userId);
							setSessionTokenCookie({ cookies }, newToken, newSession.expiresAt);
							log.info('Session renewed', {
								userId: maskedUserId,
								expiresAt: new Date(newSession.expiresAt).toISOString()
							});
						}
					}
				}
			} catch (renewalError) {
				log.error('Session renewal failed', {
					error: renewalError instanceof Error ? renewalError.message : 'Unknown error',
					userId: maskedUserId
				});
				// Continue with status update even if renewal fails
			}
		}

		return new Response(
			JSON.stringify({
				success: true,
				user: createSafeUser({
					id: updatedUser._id,
					nickname: updatedUser.nickname,
					status: updatedUser.status,
					avatarUrl: updatedUser.avatarUrl,
					lastSeen: updatedUser.lastSeen
				})
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			}
		);
	} catch (error) {
		log.error('Error updating status', {
			error: error instanceof Error ? error.message : 'Unknown error',
			userId: locals.user?.id
		});
		return new Response(
			JSON.stringify({
				success: false,
				error: 'Failed to update status'
			}),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			}
		);
	}
};
