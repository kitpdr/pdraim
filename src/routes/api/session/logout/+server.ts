import type { RequestHandler } from '@sveltejs/kit';
import { invalidateSession } from '$lib/api/session.server';
import { deleteSessionTokenCookie } from '$lib/api/session.cookie';
import { users } from '$lib/db/convex.server';
import { createLogger } from '$lib/utils/logger.server';

const log = createLogger('logout-server');

export const POST: RequestHandler = async ({ cookies, locals }) => {
	if (locals.session) {
		try {
			await users.updateStatus(locals.session.userId, 'offline');
			await invalidateSession(locals.session.id);
		} catch (err) {
			log.error('Logout cleanup failed', {
				error: err instanceof Error ? err.message : 'Unknown error'
			});
		}
	}
	deleteSessionTokenCookie({ cookies });
	return new Response(JSON.stringify({ success: true }), {
		headers: { 'Content-Type': 'application/json' }
	});
};
