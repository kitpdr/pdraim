/**
 * Centralized SSE Configuration Constants
 *
 * All timing constants for SSE connection management are defined here
 * to ensure consistency between server and client implementations.
 */

export const SSE_CONFIG = {
	// Server-side timing
	/** Heartbeat interval - server sends ping every 30 seconds */
	HEARTBEAT_INTERVAL: 30_000,

	/** Connection timeout - mark user offline after 5 minutes of inactivity */
	CONNECTION_TIMEOUT: 5 * 60_000,

	/** Stale connection check interval - cleanup every 60 seconds */
	STALE_CHECK_INTERVAL: 60_000,

	/** Message queue TTL - keep messages for 5 minutes for catch-up */
	MESSAGE_QUEUE_TTL: 5 * 60_000,

	/** Maximum messages to queue per room */
	MESSAGE_QUEUE_MAX_SIZE: 1000,

	/** Buddy list broadcast interval */
	BUDDY_LIST_BROADCAST_INTERVAL: 10_000,

	// Client-side timing
	/** Initial reconnect delay - 1 second */
	INITIAL_RECONNECT_DELAY: 1_000,

	/** Maximum reconnect delay - 60 seconds cap */
	MAX_RECONNECT_DELAY: 60_000,

	/** Heartbeat timeout - 45 seconds (1.5x server interval) */
	HEARTBEAT_TIMEOUT: 45_000,

	// Shared timing
	/** Idle timeout - mark as idle after 2 minutes */
	IDLE_TIMEOUT: 2 * 60_000,

	/** Status update interval */
	STATUS_UPDATE_INTERVAL: 30_000,

	/** EventSource retry hint (ms) - sent to client */
	RETRY_INTERVAL: 3_000
} as const;

/** SSE Event Types */
export type SSEEventType = 'chatMessage' | 'userStatusUpdate' | 'buddyListUpdate' | 'heartbeat';

/** Connection status */
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
