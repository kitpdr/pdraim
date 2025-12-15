/**
 * SSE Manager - Central server-side manager for SSE connections
 *
 * Coordinates connection tracking, message queuing, event broadcasting,
 * and heartbeat management.
 */

import { SSE_CONFIG } from './config';
import { sseEmitter, type SSEEventMap, type SSEEvent } from './SSEEventEmitter';
import { messageQueue } from './MessageQueue';
import { createLogger } from '../utils/logger.server';

const log = createLogger('sse-manager');

/**
 * Enhanced connection info with heartbeat tracking
 */
export interface SSEConnection {
	/** Unique connection ID */
	connectionId: string;
	/** User ID */
	userId: string;
	/** When the connection was established */
	connectedAt: number;
	/** Last activity timestamp */
	lastActivity: number;
	/** Last heartbeat acknowledgment */
	lastHeartbeat: number;
	/** Current room ID */
	roomId: string;
	/** Stream controller for sending events */
	controller: ReadableStreamDefaultController<Uint8Array> | null;
}

/**
 * SSE Manager singleton
 */
class SSEManager {
	/** Map of connectionId -> SSEConnection */
	private connections: Map<string, SSEConnection> = new Map();
	/** Map of userId -> Set of connectionIds (for multi-tab support) */
	private userConnections: Map<string, Set<string>> = new Map();
	/** Text encoder for SSE output */
	private encoder = new TextEncoder();
	/** Intervals for periodic tasks */
	private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
	private cleanupInterval: ReturnType<typeof setInterval> | null = null;

	constructor() {
		log.info('SSE Manager initialized');
	}

	/**
	 * Start background tasks (heartbeat, cleanup)
	 */
	startBackgroundTasks(): void {
		if (this.heartbeatInterval || this.cleanupInterval) {
			log.debug('Background tasks already running');
			return;
		}

		// Send heartbeats to all connections
		this.heartbeatInterval = setInterval(() => {
			this.sendHeartbeats();
		}, SSE_CONFIG.HEARTBEAT_INTERVAL);

		// Cleanup stale connections
		this.cleanupInterval = setInterval(() => {
			this.cleanupStaleConnections();
		}, SSE_CONFIG.STALE_CHECK_INTERVAL);

		log.info('Background tasks started');
	}

	/**
	 * Stop background tasks
	 */
	stopBackgroundTasks(): void {
		if (this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
			this.heartbeatInterval = null;
		}
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
		log.info('Background tasks stopped');
	}

	/**
	 * Add a new SSE connection
	 * @returns Connection ID and whether this is a new user connection
	 */
	addConnection(
		userId: string,
		roomId: string,
		controller: ReadableStreamDefaultController<Uint8Array>
	): { connectionId: string; isNewUser: boolean } {
		const connectionId = crypto.randomUUID();
		const now = Date.now();

		const connection: SSEConnection = {
			connectionId,
			userId,
			connectedAt: now,
			lastActivity: now,
			lastHeartbeat: now,
			roomId,
			controller
		};

		this.connections.set(connectionId, connection);

		// Track user -> connections mapping
		let userConns = this.userConnections.get(userId);
		const isNewUser = !userConns || userConns.size === 0;

		if (!userConns) {
			userConns = new Set();
			this.userConnections.set(userId, userConns);
		}
		userConns.add(connectionId);

		log.info('Connection added', {
			connectionId: connectionId.slice(0, 8),
			userId: userId.slice(0, 8),
			isNewUser,
			userConnectionCount: userConns.size,
			totalConnections: this.connections.size
		});

		return { connectionId, isNewUser };
	}

	/**
	 * Remove a connection
	 * @returns Whether this was the last connection for the user
	 */
	removeConnection(connectionId: string): {
		removed: boolean;
		isLastConnection: boolean;
		userId: string | null;
	} {
		const connection = this.connections.get(connectionId);
		if (!connection) {
			return { removed: false, isLastConnection: false, userId: null };
		}

		const { userId } = connection;
		this.connections.delete(connectionId);

		// Update user connections map
		const userConns = this.userConnections.get(userId);
		if (userConns) {
			userConns.delete(connectionId);
			if (userConns.size === 0) {
				this.userConnections.delete(userId);
			}
		}

		const isLastConnection = !userConns || userConns.size === 0;

		log.info('Connection removed', {
			connectionId: connectionId.slice(0, 8),
			userId: userId.slice(0, 8),
			isLastConnection,
			remainingConnections: this.connections.size
		});

		return { removed: true, isLastConnection, userId };
	}

	/**
	 * Get a connection by ID
	 */
	getConnection(connectionId: string): SSEConnection | undefined {
		return this.connections.get(connectionId);
	}

	/**
	 * Check if a user has any active connections
	 */
	hasUserConnection(userId: string): boolean {
		const userConns = this.userConnections.get(userId);
		return userConns !== undefined && userConns.size > 0;
	}

	/**
	 * Get all connection IDs for a user
	 */
	getUserConnectionIds(userId: string): string[] {
		const userConns = this.userConnections.get(userId);
		return userConns ? Array.from(userConns) : [];
	}

	/**
	 * Update activity timestamp for a connection
	 */
	updateActivity(connectionId: string): void {
		const connection = this.connections.get(connectionId);
		if (connection) {
			connection.lastActivity = Date.now();
		}
	}

	/**
	 * Acknowledge heartbeat for a connection
	 */
	acknowledgeHeartbeat(connectionId: string): boolean {
		const connection = this.connections.get(connectionId);
		if (connection) {
			connection.lastHeartbeat = Date.now();
			connection.lastActivity = Date.now();
			log.debug('Heartbeat acknowledged', { connectionId: connectionId.slice(0, 8) });
			return true;
		}
		return false;
	}

	/**
	 * Send an event to a specific connection
	 */
	sendToConnection(connectionId: string, event: SSEEvent, eventId?: string): boolean {
		const connection = this.connections.get(connectionId);
		if (!connection || !connection.controller) {
			return false;
		}

		try {
			const id = eventId ?? crypto.randomUUID();
			const payload = this.formatSSEEvent(event, id);
			connection.controller.enqueue(this.encoder.encode(payload));

			// Queue for catch-up
			messageQueue.enqueue(connection.roomId, event.type, event.data);

			return true;
		} catch (error) {
			log.error('Error sending to connection', { connectionId: connectionId.slice(0, 8), error });
			return false;
		}
	}

	/**
	 * Send an event to a specific user (all their connections)
	 */
	sendToUser(userId: string, event: SSEEvent): number {
		const connectionIds = this.getUserConnectionIds(userId);
		let sent = 0;
		for (const connId of connectionIds) {
			if (this.sendToConnection(connId, event)) {
				sent++;
			}
		}
		return sent;
	}

	/**
	 * Broadcast an event to all connections
	 * Uses the event emitter for distribution
	 */
	broadcast<T extends keyof SSEEventMap>(type: T, data: SSEEventMap[T], roomId?: string): void {
		const eventId = crypto.randomUUID();

		// Queue the message first
		if (roomId) {
			messageQueue.enqueue(roomId, type, data);
		}

		// Emit through the event emitter (listeners on SSE endpoint will pick this up)
		sseEmitter.emit(type, data, eventId);
	}

	/**
	 * Get messages since a specific event ID (for catch-up)
	 */
	getMessagesSince(roomId: string, lastEventId: string) {
		return messageQueue.getMessagesSince(roomId, lastEventId);
	}

	/**
	 * Format an SSE event for transmission
	 */
	formatSSEEvent(event: SSEEvent, eventId: string): string {
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
	 * Format a keep-alive comment
	 */
	formatKeepAlive(): string {
		return ':\n\n';
	}

	/**
	 * Send heartbeats to all connections
	 */
	private sendHeartbeats(): void {
		const now = Date.now();
		let sent = 0;

		for (const [connectionId, connection] of this.connections) {
			if (connection.controller) {
				try {
					const heartbeatEvent: SSEEvent<'heartbeat'> = {
						type: 'heartbeat',
						data: {
							connectionId,
							timestamp: now,
							serverTime: new Date(now).toISOString()
						}
					};
					const payload = this.formatSSEEvent(heartbeatEvent, crypto.randomUUID());
					connection.controller.enqueue(this.encoder.encode(payload));
					sent++;
				} catch {
					// Connection might be closed, will be cleaned up later
				}
			}
		}

		if (sent > 0) {
			log.debug('Heartbeats sent', { count: sent });
		}
	}

	/**
	 * Clean up stale connections
	 */
	private cleanupStaleConnections(): void {
		const now = Date.now();
		const staleConnections: string[] = [];

		for (const [connectionId, connection] of this.connections) {
			const timeSinceHeartbeat = now - connection.lastHeartbeat;
			if (timeSinceHeartbeat > SSE_CONFIG.HEARTBEAT_TIMEOUT) {
				staleConnections.push(connectionId);
			}
		}

		if (staleConnections.length > 0) {
			log.info('Cleaning up stale connections', { count: staleConnections.length });
			for (const connId of staleConnections) {
				this.removeConnection(connId);
			}
		}
	}

	/**
	 * Get all active user IDs
	 */
	getActiveUserIds(): string[] {
		return Array.from(this.userConnections.keys());
	}

	/**
	 * Get connection statistics
	 */
	getStats(): {
		totalConnections: number;
		uniqueUsers: number;
		queueStats: { rooms: number; totalMessages: number };
	} {
		return {
			totalConnections: this.connections.size,
			uniqueUsers: this.userConnections.size,
			queueStats: messageQueue.getStats()
		};
	}
}

// Singleton instance
export const sseManager = new SSEManager();
