import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { invalidateSession } from '$lib/api/session.server';
import { sha256 } from '$lib/api/session.server'; // re-use sha256 helper to compute session id
import { createLogger } from '$lib/utils/logger.server';

const log = createLogger('logout-server');

export const POST: RequestHandler = async ({ cookies }) => {
	const token = cookies.get('session');

	if (!token) {
		log.debug('No session token found in cookies');
		return json({ success: true, invalidated: false });
	}

	try {
		const sessionId = await sha256(token);
		await invalidateSession(sessionId);
		cookies.delete('session', { path: '/' });
		log.info('Session invalidated', {
			sessionId: `${sessionId.slice(0, 4)}...${sessionId.slice(-4)}`
		});
		return json({ success: true, invalidated: true });
	} catch (error) {
		log.error('Failed to invalidate session', {
			error: error instanceof Error ? error.message : 'Unknown error'
		});
		// Still delete cookie to ensure client is logged out
		cookies.delete('session', { path: '/' });
		return json({ success: false, error: 'Failed to invalidate session' }, { status: 500 });
	}
};
