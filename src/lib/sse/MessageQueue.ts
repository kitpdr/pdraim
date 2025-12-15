/**
 * Server-side Message Queue for SSE Catch-up
 *
 * Stores recent messages to allow clients to catch up after reconnection
 * using the Last-Event-ID mechanism.
 */

import { SSE_CONFIG } from './config';

/**
 * Queued message structure
 */
export interface QueuedMessage {
	/** Unique event ID for Last-Event-ID support */
	id: string;
	/** Event type (chatMessage, userStatusUpdate, etc.) */
	event: string;
	/** Event payload */
	data: unknown;
	/** Timestamp for TTL expiration */
	timestamp: number;
	/** Chat room ID for filtering */
	roomId: string;
}

/**
 * Message Queue for SSE catch-up support
 *
 * Maintains a queue of recent messages per room to allow clients
 * to catch up after reconnection using Last-Event-ID.
 */
class MessageQueue {
	private queues: Map<string, QueuedMessage[]> = new Map();
	private readonly ttl: number;
	private readonly maxSize: number;
	private cleanupInterval: ReturnType<typeof setInterval> | null = null;

	constructor(
		ttl: number = SSE_CONFIG.MESSAGE_QUEUE_TTL,
		maxSize: number = SSE_CONFIG.MESSAGE_QUEUE_MAX_SIZE
	) {
		this.ttl = ttl;
		this.maxSize = maxSize;

		// Start periodic cleanup
		this.startCleanup();
		console.log('[MessageQueue] Initialized:', { ttl, maxSize });
	}

	/**
	 * Add a message to the queue
	 * @returns The generated event ID
	 */
	enqueue(roomId: string, event: string, data: unknown): string {
		const id = crypto.randomUUID();
		const message: QueuedMessage = {
			id,
			event,
			data,
			timestamp: Date.now(),
			roomId
		};

		let queue = this.queues.get(roomId);
		if (!queue) {
			queue = [];
			this.queues.set(roomId, queue);
		}

		queue.push(message);

		// Trim if over max size (keep newest)
		if (queue.length > this.maxSize) {
			const trimmed = queue.length - this.maxSize;
			this.queues.set(roomId, queue.slice(-this.maxSize));
			console.log('[MessageQueue] Queue trimmed:', { roomId, trimmed });
		}

		return id;
	}

	/**
	 * Get messages since a given event ID
	 * If the ID is not found, returns the most recent messages
	 */
	getMessagesSince(roomId: string, lastEventId: string): QueuedMessage[] {
		const queue = this.queues.get(roomId);
		if (!queue || queue.length === 0) {
			return [];
		}

		const lastIndex = queue.findIndex((m) => m.id === lastEventId);

		if (lastIndex === -1) {
			// ID not found - return recent messages as fallback
			console.log('[MessageQueue] Last-Event-ID not found, returning recent:', {
				roomId,
				lastEventId,
				returning: Math.min(50, queue.length)
			});
			return queue.slice(-50);
		}

		// Return messages after the last seen ID
		const missed = queue.slice(lastIndex + 1);
		if (missed.length > 0) {
			console.log('[MessageQueue] Catch-up messages:', {
				roomId,
				lastEventId,
				missedCount: missed.length
			});
		}
		return missed;
	}

	/**
	 * Get all messages for a room (for initial load)
	 */
	getMessages(roomId: string, limit: number = 50): QueuedMessage[] {
		const queue = this.queues.get(roomId);
		if (!queue) {
			return [];
		}
		return queue.slice(-limit);
	}

	/**
	 * Get the latest event ID for a room
	 */
	getLatestEventId(roomId: string): string | null {
		const queue = this.queues.get(roomId);
		if (!queue || queue.length === 0) {
			return null;
		}
		return queue[queue.length - 1].id;
	}

	/**
	 * Check if an event ID exists in the queue
	 */
	hasEventId(roomId: string, eventId: string): boolean {
		const queue = this.queues.get(roomId);
		if (!queue) {
			return false;
		}
		return queue.some((m) => m.id === eventId);
	}

	/**
	 * Remove expired messages from all queues
	 */
	cleanup(): number {
		const now = Date.now();
		let totalRemoved = 0;

		for (const [roomId, queue] of this.queues.entries()) {
			const originalLength = queue.length;
			const filtered = queue.filter((m) => now - m.timestamp < this.ttl);

			if (filtered.length !== originalLength) {
				totalRemoved += originalLength - filtered.length;
				if (filtered.length === 0) {
					this.queues.delete(roomId);
				} else {
					this.queues.set(roomId, filtered);
				}
			}
		}

		if (totalRemoved > 0) {
			console.log('[MessageQueue] Cleanup completed:', {
				removed: totalRemoved,
				activeRooms: this.queues.size
			});
		}

		return totalRemoved;
	}

	/**
	 * Start periodic cleanup interval
	 */
	private startCleanup(): void {
		// Cleanup every minute
		this.cleanupInterval = setInterval(() => {
			this.cleanup();
		}, 60_000);
	}

	/**
	 * Stop cleanup interval (for shutdown)
	 */
	stopCleanup(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
	}

	/**
	 * Clear all queues (for testing or reset)
	 */
	clear(): void {
		this.queues.clear();
		console.log('[MessageQueue] All queues cleared');
	}

	/**
	 * Get statistics about the queue
	 */
	getStats(): { rooms: number; totalMessages: number } {
		let totalMessages = 0;
		for (const queue of this.queues.values()) {
			totalMessages += queue.length;
		}
		return {
			rooms: this.queues.size,
			totalMessages
		};
	}
}

// Singleton instance
export const messageQueue = new MessageQueue();

// Export class for testing
export { MessageQueue };
