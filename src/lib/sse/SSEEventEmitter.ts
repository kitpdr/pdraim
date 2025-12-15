/**
 * Type-safe SSE Event Emitter
 *
 * Provides typed event emission for SSE broadcasts with automatic
 * listener cleanup and memory leak prevention.
 */

import type { Message, SafeUser, UserStatus } from '../types/chat';

/**
 * SSE Event Type Map - defines the payload for each event type
 */
export interface SSEEventMap {
	chatMessage: Message;
	userStatusUpdate: {
		userId: string;
		status: UserStatus;
		lastSeen: number;
	};
	buddyListUpdate: SafeUser[];
	heartbeat: {
		connectionId: string;
		timestamp: number;
		serverTime: string;
	};
}

/**
 * Generic SSE event structure sent over the wire
 */
export interface SSEEvent<T extends keyof SSEEventMap = keyof SSEEventMap> {
	type: T;
	data: SSEEventMap[T];
	id?: string; // Event ID for Last-Event-ID support
}

/**
 * Listener function type for SSE events
 */
type SSEListener = (event: SSEEvent) => void;

/**
 * Type-safe SSE Event Emitter with automatic cleanup
 */
class SSEEventEmitter {
	private listeners: Map<string, Set<SSEListener>> = new Map();
	private maxListeners: number = 100;
	private listenerCount: number = 0;

	constructor() {
		console.log('[SSE-Emitter] Initialized');
	}

	/**
	 * Emit an SSE event to all listeners
	 */
	emit<T extends keyof SSEEventMap>(type: T, data: SSEEventMap[T], id?: string): void {
		const event: SSEEvent<T> = { type, data, id };

		// Get listeners for the 'sse' channel (main broadcast channel)
		const eventListeners = this.listeners.get('sse');
		if (eventListeners && eventListeners.size > 0) {
			// Only log non-frequent event types
			if (!['userStatusUpdate', 'chatMessage', 'heartbeat'].includes(type)) {
				console.log('[SSE-Emitter] Broadcasting event:', {
					type,
					listenersCount: eventListeners.size
				});
			}

			// Iterate over a copy to allow removal during iteration
			for (const listener of [...eventListeners]) {
				try {
					listener(event as SSEEvent);
				} catch (error) {
					console.error('[SSE-Emitter] Error in listener:', error);
					// Remove broken listener
					this.removeListener('sse', listener);
				}
			}
		}
	}

	/**
	 * Add a listener for SSE events
	 * Returns a cleanup function for easy removal
	 */
	addListener(channel: string, listener: SSEListener): () => void {
		if (!this.listeners.has(channel)) {
			this.listeners.set(channel, new Set());
		}

		const channelListeners = this.listeners.get(channel)!;

		if (channelListeners.size >= this.maxListeners) {
			console.warn(
				`[SSE-Emitter] Warning: Channel '${channel}' has reached max listeners (${this.maxListeners})`
			);
		}

		channelListeners.add(listener);
		this.listenerCount++;

		console.log('[SSE-Emitter] Listener added:', {
			channel,
			totalListeners: channelListeners.size,
			globalTotal: this.listenerCount
		});

		// Return cleanup function
		return () => this.removeListener(channel, listener);
	}

	/**
	 * Remove a specific listener
	 */
	removeListener(channel: string, listener: SSEListener): boolean {
		const channelListeners = this.listeners.get(channel);
		if (channelListeners) {
			const removed = channelListeners.delete(listener);
			if (removed) {
				this.listenerCount--;
				console.log('[SSE-Emitter] Listener removed:', {
					channel,
					remainingListeners: channelListeners.size,
					globalTotal: this.listenerCount
				});

				// Clean up empty channels
				if (channelListeners.size === 0) {
					this.listeners.delete(channel);
				}
				return true;
			}
		}
		return false;
	}

	/**
	 * Remove all listeners for a channel
	 */
	removeAllListeners(channel?: string): void {
		if (channel) {
			const channelListeners = this.listeners.get(channel);
			if (channelListeners) {
				this.listenerCount -= channelListeners.size;
				this.listeners.delete(channel);
				console.log('[SSE-Emitter] All listeners removed for channel:', channel);
			}
		} else {
			this.listeners.clear();
			this.listenerCount = 0;
			console.log('[SSE-Emitter] All listeners removed');
		}
	}

	/**
	 * Get the count of listeners for a channel
	 */
	getListenerCount(channel?: string): number {
		if (channel) {
			return this.listeners.get(channel)?.size ?? 0;
		}
		return this.listenerCount;
	}

	/**
	 * Set the maximum number of listeners per channel
	 */
	setMaxListeners(n: number): void {
		this.maxListeners = n;
		console.log('[SSE-Emitter] Max listeners updated:', { newLimit: n });
	}

	/**
	 * Check if a channel has any listeners
	 */
	hasListeners(channel: string): boolean {
		const channelListeners = this.listeners.get(channel);
		return channelListeners !== undefined && channelListeners.size > 0;
	}
}

// Singleton instance
export const sseEmitter = new SSEEventEmitter();

// Export type for use in other modules
export type { SSEListener };
