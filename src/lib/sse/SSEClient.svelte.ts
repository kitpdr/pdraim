/**
 * SSE Client - Client-side SSE connection manager
 *
 * Handles EventSource connections with:
 * - Unlimited reconnection with exponential backoff + jitter
 * - Heartbeat monitoring and acknowledgment
 * - Last-Event-ID tracking for catch-up
 * - Reactive state using Svelte 5 runes
 */

import { SSE_CONFIG, type ConnectionStatus } from './config';
import type { SSEEventMap } from './SSEEventEmitter';

/**
 * Configuration for SSE Client
 */
export interface SSEClientConfig {
	/** SSE endpoint URL */
	url: string;
	/** Callback for incoming messages */
	onMessage: <T extends keyof SSEEventMap>(type: T, data: SSEEventMap[T]) => void;
	/** Callback for connection status changes */
	onStatusChange?: (status: ConnectionStatus) => void;
	/** Callback for errors */
	onError?: (error: string) => void;
}

/**
 * SSE Client with Svelte 5 reactive state
 */
export class SSEClient {
	// Configuration
	private config: SSEClientConfig;

	// Connection state
	private eventSource: EventSource | null = null;
	private _connectionId: string | null = null;

	// Reactive state using Svelte 5 runes
	private _status = $state<ConnectionStatus>('disconnected');
	private _lastEventId = $state<string | null>(null);
	private _error = $state<string | null>(null);
	private _reconnectAttempts = $state(0);

	// Timers
	private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	// Derived state
	public status = $derived(this._status);
	public lastEventId = $derived(this._lastEventId);
	public error = $derived(this._error);
	public reconnectAttempts = $derived(this._reconnectAttempts);
	public isConnected = $derived(this._status === 'connected');
	public isReconnecting = $derived(this._status === 'reconnecting');

	constructor(config: SSEClientConfig) {
		this.config = config;
		console.debug('[SSEClient] Initialized');
	}

	/**
	 * Connect to the SSE endpoint
	 */
	connect(): void {
		if (this.eventSource && this.eventSource.readyState !== EventSource.CLOSED) {
			console.debug('[SSEClient] Already connected or connecting');
			return;
		}

		this.setStatus('connecting');
		this._error = null;

		try {
			// EventSource automatically sends Last-Event-ID header on reconnection
			this.eventSource = new EventSource(this.config.url, { withCredentials: true });

			this.eventSource.onopen = () => {
				console.debug('[SSEClient] Connection established');
				this.setStatus('connected');
				this._reconnectAttempts = 0;
				this._error = null;
				this.startHeartbeatMonitor();
			};

			this.eventSource.onerror = (event) => {
				console.debug('[SSEClient] Connection error:', event);

				if (this.eventSource?.readyState === EventSource.CLOSED) {
					this.handleDisconnection();
				} else if (this.eventSource?.readyState === EventSource.CONNECTING) {
					this.setStatus('reconnecting');
				}
			};

			// Set up event listeners
			this.setupEventListeners();
		} catch (error) {
			console.error('[SSEClient] Failed to create EventSource:', error);
			this._error = 'Failed to connect';
			this.handleDisconnection();
		}
	}

	/**
	 * Disconnect from SSE
	 */
	disconnect(): void {
		console.debug('[SSEClient] Disconnecting');
		this.cleanup();
		this.setStatus('disconnected');
		this._connectionId = null;
	}

	/**
	 * Get the current connection ID
	 */
	getConnectionId(): string | null {
		return this._connectionId;
	}

	/**
	 * Set up event listeners for SSE events
	 */
	private setupEventListeners(): void {
		if (!this.eventSource) return;

		// Track last event ID from all events
		const trackEventId = (event: MessageEvent) => {
			if (event.lastEventId) {
				this._lastEventId = event.lastEventId;
			}
		};

		// Chat message events
		this.eventSource.addEventListener('chatMessage', (event: MessageEvent) => {
			trackEventId(event);
			try {
				const data = JSON.parse(event.data);
				this.config.onMessage('chatMessage', data);
			} catch (error) {
				console.error('[SSEClient] Error parsing chatMessage:', error);
			}
		});

		// User status update events
		this.eventSource.addEventListener('userStatusUpdate', (event: MessageEvent) => {
			trackEventId(event);
			try {
				const data = JSON.parse(event.data);
				this.config.onMessage('userStatusUpdate', data);
			} catch (error) {
				console.error('[SSEClient] Error parsing userStatusUpdate:', error);
			}
		});

		// Buddy list update events
		this.eventSource.addEventListener('buddyListUpdate', (event: MessageEvent) => {
			trackEventId(event);
			try {
				const data = JSON.parse(event.data);
				this.config.onMessage('buddyListUpdate', data);
			} catch (error) {
				console.error('[SSEClient] Error parsing buddyListUpdate:', error);
			}
		});

		// Heartbeat events
		this.eventSource.addEventListener('heartbeat', (event: MessageEvent) => {
			trackEventId(event);
			try {
				const data = JSON.parse(event.data);
				this._connectionId = data.connectionId;
				this.acknowledgeHeartbeat(data.connectionId);
				this.resetHeartbeatMonitor();
			} catch (error) {
				console.error('[SSEClient] Error parsing heartbeat:', error);
			}
		});
	}

	/**
	 * Start monitoring for heartbeat timeout
	 */
	private startHeartbeatMonitor(): void {
		this.clearHeartbeatTimer();

		this.heartbeatTimer = setTimeout(() => {
			console.warn('[SSEClient] Heartbeat timeout - connection may be stale');
			// Force reconnection if no heartbeat received
			if (this.eventSource) {
				this.eventSource.close();
			}
			this.handleDisconnection();
		}, SSE_CONFIG.HEARTBEAT_TIMEOUT);
	}

	/**
	 * Reset the heartbeat monitor (called when heartbeat received)
	 */
	private resetHeartbeatMonitor(): void {
		this.startHeartbeatMonitor();
	}

	/**
	 * Clear heartbeat timer
	 */
	private clearHeartbeatTimer(): void {
		if (this.heartbeatTimer) {
			clearTimeout(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}

	/**
	 * Send heartbeat acknowledgment to server
	 */
	private async acknowledgeHeartbeat(connectionId: string): Promise<void> {
		try {
			const response = await fetch('/api/sse/heartbeat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ connectionId })
			});

			if (!response.ok) {
				console.warn('[SSEClient] Heartbeat acknowledgment failed:', response.status);
			}
		} catch (error) {
			console.warn('[SSEClient] Failed to acknowledge heartbeat:', error);
		}
	}

	/**
	 * Handle disconnection with reconnection logic
	 */
	private handleDisconnection(): void {
		this.cleanup();
		this.setStatus('reconnecting');
		this._reconnectAttempts++;

		const delay = this.calculateBackoff();
		console.debug(`[SSEClient] Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts})`);

		this.reconnectTimer = setTimeout(() => {
			this.connect();
		}, delay);
	}

	/**
	 * Calculate reconnection delay with exponential backoff and jitter
	 * Never gives up - always tries to reconnect
	 */
	private calculateBackoff(): number {
		const base = SSE_CONFIG.INITIAL_RECONNECT_DELAY;
		const max = SSE_CONFIG.MAX_RECONNECT_DELAY;

		// Exponential backoff: 2^attempts * base, capped at max
		const exponentialDelay = Math.min(base * Math.pow(2, this._reconnectAttempts), max);

		// Add random jitter (0-25% of delay) to prevent thundering herd
		const jitter = exponentialDelay * Math.random() * 0.25;

		return Math.floor(exponentialDelay + jitter);
	}

	/**
	 * Get the estimated next reconnect delay in seconds
	 * Returns null if not reconnecting
	 */
	getReconnectDelay(): number | null {
		if (this._status !== 'reconnecting') {
			return null;
		}
		// Calculate the expected delay for the current attempt
		const base = SSE_CONFIG.INITIAL_RECONNECT_DELAY;
		const max = SSE_CONFIG.MAX_RECONNECT_DELAY;
		const exponentialDelay = Math.min(base * Math.pow(2, this._reconnectAttempts - 1), max);
		return Math.ceil(exponentialDelay / 1000); // Convert to seconds
	}

	/**
	 * Clean up resources
	 */
	private cleanup(): void {
		this.clearHeartbeatTimer();

		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		if (this.eventSource) {
			this.eventSource.close();
			this.eventSource = null;
		}
	}

	/**
	 * Set connection status and notify listener
	 */
	private setStatus(status: ConnectionStatus): void {
		this._status = status;
		this.config.onStatusChange?.(status);
	}

	/**
	 * Destroy the client completely
	 */
	destroy(): void {
		console.debug('[SSEClient] Destroying');
		this.disconnect();
	}
}

/**
 * Factory function to create an SSE client
 */
export function createSSEClient(config: SSEClientConfig): SSEClient {
	return new SSEClient(config);
}
