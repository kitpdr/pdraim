import { createLogger } from '$lib/utils/logger.server';
import { chatRooms } from '$lib/db/convex.server';

const log = createLogger('chat-utils');

// Default chat room ID - will be fetched/created on startup
let defaultChatRoomId: string | null = null;

// Function to get the default chat room ID
export function getDefaultChatRoomId(): string | null {
	return defaultChatRoomId;
}

// Function to ensure default chat room exists (using Convex)
export async function ensureDefaultChatRoom(): Promise<string> {
	log.debug('Ensuring default chat room exists...');
	try {
		const room = await chatRooms.getOrCreateDefault();
		defaultChatRoomId = room._id;
		log.debug('Default chat room ready', { id: defaultChatRoomId });
		return defaultChatRoomId;
	} catch (error: unknown) {
		log.error('Error ensuring default chat room:', {
			error: error instanceof Error ? error.message : 'Unknown error'
		});
		throw error;
	}
}
