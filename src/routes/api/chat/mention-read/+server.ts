import type { RequestHandler } from '@sveltejs/kit';
import { users } from '$lib/db/convex.server';
import { validateSessionToken } from '$lib/api/session.server';

export const POST: RequestHandler = async ({ request, cookies }) => {
	const token = cookies.get('session');

	if (!token) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	try {
		const { user } = await validateSessionToken(token);

		if (!user) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		const body = await request.json();
		const { timestamp } = body as { timestamp: number };

		if (typeof timestamp !== 'number' || timestamp <= 0) {
			return new Response(JSON.stringify({ error: 'Invalid timestamp' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Prevent far-future timestamps that could suppress notifications permanently
		const now = Date.now();
		const maxSkewMs = 5 * 60 * 1000; // 5 minutes clock skew tolerance
		if (timestamp > now + maxSkewMs) {
			return new Response(JSON.stringify({ error: 'Timestamp too far in the future' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		await users.updateLastReadMentionTimestamp(user.id, timestamp);

		return new Response(JSON.stringify({ success: true }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		console.error('Error updating mention read timestamp:', error);
		return new Response(JSON.stringify({ error: 'Internal server error' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
