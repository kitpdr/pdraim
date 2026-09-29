import type { RequestHandler } from '@sveltejs/kit';
import { invalidateSession } from '$lib/api/session.server';
import { deleteSessionTokenCookie } from '$lib/api/session.cookie';
import { users } from '$lib/db/convex.server';
import { createLogger } from '$lib/utils/logger.server';

const log = createLogger('logout-server');

const json = (body: object, status: number) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});

export const POST: RequestHandler = async ({ cookies, locals }) => {
	if (locals.session) {
		try {
			await invalidateSession(locals.session.id);
		} catch (err) {
			// Keep the cookie: the session is still valid, so the client must not think it is signed out.
			log.error('Session invalidation failed', {
				error: err instanceof Error ? err.message : 'Unknown error'
			});
			return json({ success: false }, 500);
		}
		try {
			await users.updateStatus(locals.session.userId, 'offline');
		} catch (err) {
			log.warn('Offline status update failed on logout', {
				error: err instanceof Error ? err.message : 'Unknown error'
			});
		}
	}
	deleteSessionTokenCookie({ cookies });
	return json({ success: true }, 200);
};
