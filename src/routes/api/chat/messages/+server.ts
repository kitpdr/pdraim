import { messages } from '$lib/db/convex.server';
import { getDefaultChatRoomId } from '$lib/utils/chat.server';
import type { Message } from '$lib/types/chat';
import type { SendMessageResponse, GetMessagesResponse } from '$lib/types/payloads';
import { error } from '@sveltejs/kit';
import { createLogger } from '$lib/utils/logger.server';
import { sanitizeStyleData } from '$lib/validation/text-formatting';
import { sendMessageSchema } from '$lib/validation/message';
import type { RequestHandler } from './$types';

const log = createLogger('chat-server');

// Rate limiting configuration
const INITIAL_COOLDOWN = 1000; // 1 second
const MAX_COOLDOWN = 30000; // 30 seconds
const userMessageTimestamps = new Map<
	string,
	{ lastMessageTime: number; currentCooldown: number }
>();

function updateUserCooldown(userId: string): { canSend: boolean; retryAfter?: number } {
	const now = Date.now();
	const userState = userMessageTimestamps.get(userId) || {
		lastMessageTime: 0,
		currentCooldown: INITIAL_COOLDOWN
	};

	const timeSinceLastMessage = now - userState.lastMessageTime;
	if (timeSinceLastMessage < userState.currentCooldown) {
		return {
			canSend: false,
			retryAfter: userState.currentCooldown - timeSinceLastMessage
		};
	}

	if (timeSinceLastMessage > userState.currentCooldown * 2) {
		userState.currentCooldown = INITIAL_COOLDOWN;
	} else {
		userState.currentCooldown = Math.min(userState.currentCooldown * 2, MAX_COOLDOWN);
	}

	userState.lastMessageTime = now;
	userMessageTimestamps.set(userId, userState);

	return { canSend: true };
}

// GET endpoint: fetch messages from Convex
export const GET: RequestHandler = async ({ url, locals }) => {
	const beforeTimestamp = url.searchParams.get('before');
	const roomIdParam = url.searchParams.get('roomId');
	const isPublic = url.searchParams.get('public') === 'true';

	// Use default room if not specified
	const roomId = roomIdParam || getDefaultChatRoomId();

	if (!roomId) {
		log.error('No room ID available');
		throw error(500, 'Chat room not configured');
	}

	try {
		log.debug('Fetching messages from Convex', {
			beforeTimestamp,
			roomId,
			isAuthenticated: !!locals.session,
			isPublic
		});

		const fetchLimit = isPublic || !locals.session ? 50 : 100;

		const result = await messages.getByRoom(
			roomId,
			fetchLimit,
			beforeTimestamp ? parseInt(beforeTimestamp) : undefined
		);

		// Map Convex messages to our Message type
		const fetchedMessages: Message[] = result.messages.map((msg) => ({
			id: msg._id,
			chatRoomId: msg.chatRoomId,
			senderId: msg.senderId,
			content: msg.content,
			type: msg.type as Message['type'],
			timestamp: msg.timestamp,
			styleData: msg.styleData,
			hasFormatting: msg.hasFormatting ?? false
		}));

		const response: GetMessagesResponse = {
			success: true,
			messages: fetchedMessages,
			hasMore: result.hasMore
		};

		return new Response(JSON.stringify(response), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		log.error('Error fetching messages:', { error: err });
		throw error(500, 'Failed to fetch messages');
	}
};

// POST endpoint: send a new message via Convex
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		log.warn('Authentication required');
		throw error(401, 'Authentication required');
	}

	log.debug('New message received');
	try {
		// Check rate limiting
		const { canSend, retryAfter } = updateUserCooldown(locals.user.id);
		if (!canSend) {
			const maskedUserId = `${locals.user.id.slice(0, 4)}...${locals.user.id.slice(-4)}`;
			log.warn('Rate limited', { userId: maskedUserId, retryAfter });
			const errorResponse: SendMessageResponse = {
				success: false,
				error: 'Please wait before sending another message',
				retryAfter,
				isRateLimited: true
			};
			return new Response(JSON.stringify(errorResponse), {
				status: 429,
				headers: {
					'Content-Type': 'application/json',
					'Retry-After': Math.ceil(retryAfter! / 1000).toString()
				}
			});
		}

		const rawData = await request.json();

		// Validate with Zod schema
		const parseResult = sendMessageSchema.safeParse(rawData);
		if (!parseResult.success) {
			const errorMessage = parseResult.error.issues[0]?.message || 'Invalid message payload';
			log.warn('Message validation failed', {
				error: errorMessage,
				issues: parseResult.error.issues
			});
			const errorResponse: SendMessageResponse = {
				success: false,
				error: errorMessage
			};
			return new Response(JSON.stringify(errorResponse), { status: 400 });
		}

		const data = parseResult.data;

		if (data.userId !== locals.user.id) {
			log.warn('Unauthorized message attempt', {
				requestedUserId: data.userId,
				actualUserId: `${locals.user.id.slice(0, 4)}...${locals.user.id.slice(-4)}`
			});
			throw error(403, 'Cannot post messages as another user');
		}

		// Use default room if not specified
		const chatRoomId = data.chatRoomId || getDefaultChatRoomId();

		if (!chatRoomId) {
			log.error('No chat room ID available');
			const errorResponse: SendMessageResponse = {
				success: false,
				error: 'Chat room not configured'
			};
			return new Response(JSON.stringify(errorResponse), { status: 500 });
		}

		const validatedStyleData = sanitizeStyleData(data.styleData);

		// Send message via Convex
		const convexMessage = await messages.send(
			chatRoomId,
			data.userId,
			data.content,
			data.type || 'chat',
			validatedStyleData ? JSON.stringify(validatedStyleData) : undefined,
			Boolean(validatedStyleData)
		);

		// Map to our Message type
		const newMessage: Message = {
			id: convexMessage._id,
			chatRoomId: convexMessage.chatRoomId,
			senderId: convexMessage.senderId,
			content: convexMessage.content,
			type: convexMessage.type as Message['type'],
			timestamp: convexMessage.timestamp,
			styleData: convexMessage.styleData,
			hasFormatting: convexMessage.hasFormatting ?? false
		};

		log.debug('Message processed successfully', {
			messageId: newMessage.id,
			userId: `${newMessage.senderId.slice(0, 4)}...${newMessage.senderId.slice(-4)}`,
			roomId: newMessage.chatRoomId
		});

		const successResponse: SendMessageResponse = {
			success: true,
			message: newMessage
		};

		return new Response(JSON.stringify(successResponse), {
			status: 201,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		log.error('Error processing message', {
			error: err instanceof Error ? err.message : 'Unknown error'
		});
		const errorResponse: SendMessageResponse = {
			success: false,
			error: 'Failed to save message'
		};
		return new Response(JSON.stringify(errorResponse), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
