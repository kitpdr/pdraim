/**
 * SSE Server Endpoint
 *
 * Handles Server-Sent Events connections with:
 * - Event IDs for Last-Event-ID catch-up support
 * - Heartbeat mechanism for connection health
 * - Proper connection lifecycle management
 */

declare global {
	var __sseIntervalsStarted: boolean;
}

import type { RequestHandler } from './$types';
import { SSE_CONFIG } from '$lib/sse/config';
import { sseEmitter, type SSEEvent } from '$lib/sse/SSEEventEmitter';
import { sseManager } from '$lib/sse/SSEManager';
import { messageQueue } from '$lib/sse/MessageQueue';
import db from '$lib/db/db.server';
import { users } from '$lib/db/schema';
import { eq, and, lt, ne } from 'drizzle-orm';
import { createSafeUser } from '$lib/types/chat';
import { createLogger } from '$lib/utils/logger.server';
import { buddyListCache } from '$lib/buddyListCache';
import { env } from '$env/dynamic/public';

const log = createLogger('sse-server');

console.log('[SSE] Server initialized with new SSE modules');

// Default chat room ID
const DEFAULT_CHAT_ROOM_ID =
	env.PUBLIC_DEFAULT_CHAT_ROOM_ID || '00000000-0000-0000-0000-000000000001';

// Intervals for background tasks
let timeoutInterval: ReturnType<typeof setInterval>;
let buddyListInterval: ReturnType<typeof setInterval>;
let connectionCleanupInterval: ReturnType<typeof setInterval>;

// Timestamp tracker for buddy list updates
let lastBuddyListUpdate = 0;
let lastBuddyListHash = '';

/**
 * Start periodic check for timed out users
 */
function startTimeoutCheck() {
	if (timeoutInterval) {
		clearInterval(timeoutInterval);
	}

	timeoutInterval = setInterval(async () => {
		const timeoutThreshold = Date.now() - SSE_CONFIG.CONNECTION_TIMEOUT;
		log.debug('Checking for timed out users', {
			checkTime: new Date().toISOString(),
			timeoutThreshold: new Date(timeoutThreshold).toISOString()
		});

		try {
			const now = Date.now();
			const result = await db
				.update(users)
				.set({
					status: 'offline',
					lastSeen: now
				})
				.where(
					and(
						ne(users.status, 'offline'),
						lt(users.lastSeen, timeoutThreshold)
					)
				)
				.returning({
					id: users.id,
					nickname: users.nickname,
					lastSeen: users.lastSeen
				});

			if (result.length > 0) {
				log.info('User status updated to offline due to timeout', {
					usersUpdated: result.length,
					timeoutThreshold: new Date(timeoutThreshold).toISOString()
				});

				buddyListCache.invalidate();

				// Broadcast status updates for each timed out user
				for (const user of result) {
					sseEmitter.emit('userStatusUpdate', {
						userId: user.id,
						status: 'offline',
						lastSeen: now
					});
				}
			}
		} catch (error) {
			log.error('Error during timeout check', { error });
		}
	}, SSE_CONFIG.STALE_CHECK_INTERVAL);
}

/**
 * Start buddy list broadcast interval
 */
function startBuddyListUpdateInterval() {
	if (buddyListInterval) {
		clearInterval(buddyListInterval);
	}

	buddyListInterval = setInterval(async () => {
		try {
			const now = Date.now();
			if (now - lastBuddyListUpdate >= SSE_CONFIG.BUDDY_LIST_BROADCAST_INTERVAL) {
				if (buddyListCache.needsRefresh()) {
					log.debug('Fetching buddy list from database (cache miss)...');
					const buddyList = await db.select().from(users);
					const safeBuddyList = buddyList.map((user) => createSafeUser(user));

					const hasChanged = buddyListCache.update(safeBuddyList);

					if (hasChanged) {
						log.debug('Broadcasting buddy list update (data changed)...');
						sseEmitter.emit('buddyListUpdate', safeBuddyList);
					}
				} else {
					const cachedData = buddyListCache.get();
					if (cachedData) {
						const currentHash = JSON.stringify(cachedData);
						if (currentHash !== lastBuddyListHash) {
							log.debug('Broadcasting buddy list update from cache...');
							lastBuddyListHash = currentHash;
							sseEmitter.emit('buddyListUpdate', cachedData);
						}
					}
				}
				lastBuddyListUpdate = now;
			}
		} catch (error) {
			log.error('Error fetching buddy list for update', { error });
		}
	}, 1000);
}

/**
 * Start periodic cleanup for stale connections
 */
function startConnectionCleanup() {
	if (connectionCleanupInterval) {
		clearInterval(connectionCleanupInterval);
	}

	connectionCleanupInterval = setInterval(async () => {
		// Get stats and log them periodically
		const stats = sseManager.getStats();
		if (stats.totalConnections > 0) {
			log.debug('SSE connection stats', stats);
		}
	}, SSE_CONFIG.STALE_CHECK_INTERVAL);
}

// Start background tasks only once
if (!globalThis.__sseIntervalsStarted) {
	startTimeoutCheck();
	startBuddyListUpdateInterval();
	startConnectionCleanup();
	sseManager.startBackgroundTasks();
	globalThis.__sseIntervalsStarted = true;
	log.info('Started global intervals for SSE management');
} else {
	log.debug('Global intervals already started, skipping initialization');
}

// Cleanup on process exit
if (typeof process !== 'undefined') {
	const cleanup = () => {
		if (timeoutInterval) clearInterval(timeoutInterval);
		if (buddyListInterval) clearInterval(buddyListInterval);
		if (connectionCleanupInterval) clearInterval(connectionCleanupInterval);
		sseManager.stopBackgroundTasks();
	};

	process.on('beforeExit', cleanup);
	process.on('SIGTERM', () => {
		cleanup();
		process.exit(0);
	});
	process.on('SIGINT', () => {
		cleanup();
		process.exit(0);
	});
}

/**
 * Format an SSE event with ID and retry field
 */
function formatSSEEvent(event: SSEEvent, eventId: string): string {
	const lines = [
		`id: ${eventId}`,
		`event: ${event.type}`,
		`data: ${JSON.stringify(event.data)}`,
		`retry: ${SSE_CONFIG.RETRY_INTERVAL}`,
		'',
		''
	];
	return lines.join('\n');
}

/**
 * GET /api/sse
 *
 * Establishes an SSE connection for real-time updates.
 */
export const GET: RequestHandler = async ({ request, locals }) => {
	log.debug('Processing SSE request', {
		url: request.url,
		userId: locals.user?.id
	});

	if (!locals.user) {
		log.warn('Authentication failed - no user in locals');
		return new Response('Unauthorized', {
			status: 401,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const userId = locals.user.id;
	const roomId = DEFAULT_CHAT_ROOM_ID;
	const encoder = new TextEncoder();

	// Check for Last-Event-ID header for catch-up
	const lastEventId = request.headers.get('Last-Event-ID');
	if (lastEventId) {
		log.debug('Client reconnecting with Last-Event-ID', {
			userId: userId.slice(0, 8),
			lastEventId: lastEventId.slice(0, 8)
		});
	}

	let connectionId: string;
	let keepAliveInterval: ReturnType<typeof setInterval>;
	let cleanupListener: (() => void) | undefined;

	const stream = new ReadableStream({
		async start(controller) {
			// Add connection to manager
			const { connectionId: connId, isNewUser } = sseManager.addConnection(
				userId,
				roomId,
				controller
			);
			connectionId = connId;

			// Update user status if new connection
			if (isNewUser) {
				const now = Date.now();
				try {
					await db
						.update(users)
						.set({ status: 'online', lastSeen: now })
						.where(eq(users.id, userId));

					log.info('User status updated to online', {
						userId: userId.slice(0, 8),
						connectionId: connectionId.slice(0, 8)
					});

					buddyListCache.invalidate();

					sseEmitter.emit('userStatusUpdate', {
						userId,
						status: 'online',
						lastSeen: now
					});
				} catch (error) {
					log.error('Error updating user status', { error });
				}
			}

			// Send initial connection event
			const connectEvent = formatSSEEvent(
				{ type: 'userStatusUpdate', data: { userId, status: 'connected', lastSeen: Date.now() } },
				crypto.randomUUID()
			);
			controller.enqueue(encoder.encode(connectEvent));

			// Send catch-up messages if reconnecting with Last-Event-ID
			if (lastEventId) {
				const missedMessages = messageQueue.getMessagesSince(roomId, lastEventId);
				if (missedMessages.length > 0) {
					log.info('Sending catch-up messages', {
						userId: userId.slice(0, 8),
						count: missedMessages.length
					});
					for (const msg of missedMessages) {
						// Cast to SSEEvent - the data was already validated when queued
						const event = { type: msg.event, data: msg.data } as SSEEvent;
						const payload = formatSSEEvent(event, msg.id);
						controller.enqueue(encoder.encode(payload));
					}
				}
			}

			// Listen for SSE events
			const onSSE = (event: SSEEvent) => {
				try {
					const eventId = crypto.randomUUID();
					const payload = formatSSEEvent(event, eventId);
					controller.enqueue(encoder.encode(payload));

					// Queue message for catch-up (if not heartbeat)
					if (event.type !== 'heartbeat') {
						messageQueue.enqueue(roomId, event.type, event.data);
					}
				} catch (error) {
					log.error('Error sending event', { error });
				}
			};

			cleanupListener = sseEmitter.addListener('sse', onSSE);

			// Handle abort signal
			request.signal.addEventListener('abort', () => {
				if (cleanupListener) {
					cleanupListener();
					log.info('Removed listener due to abort signal');
				}
			});

			log.info('SSE connection established', {
				connectionId: connectionId.slice(0, 8),
				userId: userId.slice(0, 8)
			});

			// Keep-alive pings (in addition to heartbeats from manager)
			keepAliveInterval = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(':\n\n'));
				} catch {
					// Connection might be closed
				}
			}, SSE_CONFIG.HEARTBEAT_INTERVAL);
		},

		async cancel(reason) {
			if (keepAliveInterval) clearInterval(keepAliveInterval);
			if (cleanupListener) cleanupListener();

			const maskedUserId = userId.slice(0, 8);
			log.info('Connection closed', { userId: maskedUserId, connectionId: connectionId?.slice(0, 8), reason });

			// Remove connection from manager
			const { isLastConnection } = sseManager.removeConnection(connectionId);

			// Update database if last connection for this user
			if (isLastConnection) {
				const now = Date.now();
				try {
					await db
						.update(users)
						.set({ status: 'offline', lastSeen: now })
						.where(eq(users.id, userId));

					buddyListCache.invalidate();

					sseEmitter.emit('userStatusUpdate', {
						userId,
						status: 'offline',
						lastSeen: now
					});
				} catch (error) {
					log.error('Error updating user status on disconnect', { error });
				}
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
			'X-Accel-Buffering': 'no' // Disable nginx buffering
		}
	});
};
