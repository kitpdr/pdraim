import { chatRooms } from '$lib/db/convex.server';
import { createLogger } from '$lib/utils/logger.server';
import type { RequestHandler } from './$types';

const log = createLogger('rooms-default-server');

export const GET: RequestHandler = async () => {
	try {
		log.debug('Fetching default room');

		const room = await chatRooms.getOrCreateDefault();

		log.debug('Successfully fetched default room', {
			roomId: room._id
		});

		return new Response(
			JSON.stringify({
				success: true,
				roomId: room._id
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			}
		);
	} catch (error) {
		log.error('Error fetching default room', {
			error: error instanceof Error ? error.message : 'Unknown error'
		});
		return new Response(
			JSON.stringify({
				success: false,
				error: 'Failed to fetch default room'
			}),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			}
		);
	}
};
