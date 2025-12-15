/**
 * Heartbeat Acknowledgment Endpoint
 *
 * Receives heartbeat acknowledgments from clients to track
 * active connections and detect stale ones.
 */

import type { RequestHandler } from './$types';
import { sseManager } from '$lib/sse/SSEManager';
import { createLogger } from '$lib/utils/logger.server';
import { json } from '@sveltejs/kit';

const log = createLogger('sse-heartbeat');

/**
 * POST /api/sse/heartbeat
 *
 * Acknowledges a heartbeat from a client, updating the connection's
 * last heartbeat timestamp.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	// Require authentication
	if (!locals.user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const body = await request.json();
		const { connectionId } = body;

		if (!connectionId || typeof connectionId !== 'string') {
			return json({ success: false, error: 'Invalid connectionId' }, { status: 400 });
		}

		// Verify the connection belongs to this user
		const connection = sseManager.getConnection(connectionId);
		if (!connection) {
			log.debug('Heartbeat for unknown connection', {
				connectionId: connectionId.slice(0, 8),
				userId: locals.user.id.slice(0, 8)
			});
			return json({ success: false, error: 'Connection not found' }, { status: 404 });
		}

		if (connection.userId !== locals.user.id) {
			log.warn('Heartbeat userId mismatch', {
				connectionId: connectionId.slice(0, 8),
				expectedUserId: connection.userId.slice(0, 8),
				actualUserId: locals.user.id.slice(0, 8)
			});
			return json({ success: false, error: 'Unauthorized' }, { status: 403 });
		}

		// Acknowledge the heartbeat
		const acknowledged = sseManager.acknowledgeHeartbeat(connectionId);

		if (acknowledged) {
			return json({ success: true });
		} else {
			return json({ success: false, error: 'Failed to acknowledge' }, { status: 500 });
		}
	} catch (error) {
		log.error('Heartbeat error', { error });
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	}
};
