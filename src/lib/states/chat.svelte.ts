/**
 * Chat State Management
 *
 * Minimal state manager for user session.
 * Real-time data (messages, users) comes from Convex subscriptions in components.
 */

import type { User, SafeUser } from '../types/chat';
import { createSafeUser } from '../types/chat';

class ChatState {
	// Current user state (from session)
	private _currentUser = $state<SafeUser | null>(null);
	private _currentRoomId = $state<string | null>(null);

	// Connection state for UI feedback
	private _connectionStatus = $state<'connected' | 'disconnected' | 'reconnecting'>('disconnected');

	// Mention notifications per room
	private _roomMentionCounts = $state<Record<string, number>>({});

	// Derived public state
	public connectionStatus = $derived(this._connectionStatus);
	public isConnected = $derived(this._connectionStatus === 'connected');
	public mentionTotal = $derived(
		Object.values(this._roomMentionCounts).reduce((sum, count) => sum + count, 0)
	);

	getMentionTotal() {
		return Object.values(this._roomMentionCounts).reduce((sum, count) => sum + count, 0);
	}

	/**
	 * Get the current user
	 */
	getCurrentUser() {
		return this._currentUser;
	}

	/**
	 * Set the current user (called from layout when session changes)
	 */
	setCurrentUser(user: User | SafeUser | null) {
		if (!user) {
			this._currentUser = null;
			this._connectionStatus = 'disconnected';
			this._roomMentionCounts = {};
			return;
		}

		const safeUser = 'password' in user ? createSafeUser(user) : user;
		this._currentUser = safeUser;
		this._connectionStatus = 'connected';
	}

	/**
	 * Get the current room ID
	 */
	getCurrentRoomId() {
		return this._currentRoomId;
	}

	/**
	 * Set the current room ID
	 */
	setCurrentRoomId(roomId: string | null) {
		this._currentRoomId = roomId;
	}

	/**
	 * Set connection status
	 */
	setConnectionStatus(status: 'connected' | 'disconnected' | 'reconnecting') {
		this._connectionStatus = status;
	}

	/**
	 * Update mention count for a room
	 */
	setRoomMentionCount(roomId: string | null, count: number) {
		if (!roomId) return;
		const next = Math.max(0, count);
		if (this._roomMentionCounts[roomId] === next) return;
		this._roomMentionCounts = { ...this._roomMentionCounts, [roomId]: next };
	}

	/**
	 * Get mention count for a room
	 */
	getRoomMentionCount(roomId: string | null) {
		if (!roomId) return 0;
		return this._roomMentionCounts[roomId] ?? 0;
	}
}

export const chatState = new ChatState();
