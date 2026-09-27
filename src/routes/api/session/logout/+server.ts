import type { RequestHandler } from '@sveltejs/kit';
import { invalidateSession } from '$lib/api/session.server';
import { deleteSessionTokenCookie } from '$lib/api/session.cookie';
import { users } from '$lib/db/convex.server';
import { createLogger } from '$lib/utils/logger.server';

const log = createLogger('logout-server');

export const POST: RequestHandler = async ({ cookies, locals }) => {
	let success = true;
	if (locals.session) {
		try {
			await invalidateSession(locals.session.id);
		} catch (err) {
			success = false;
			log.error('Session invalidation failed', {
				error: err instanceof Error ? err.message : 'Unknown error'
			});
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
	return new Response(JSON.stringify({ success }), {
		status: success ? 200 : 500,
		headers: { 'Content-Type': 'application/json' }
	});
};
