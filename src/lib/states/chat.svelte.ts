/**
 * Chat State Management
 *
 * Central state manager for chat functionality using Svelte 5 runes.
 * Handles SSE connections, messages, and user state.
 */

import type { User, Message, EnrichedMessage, SafeUser } from '../types/chat';
import { createSafeUser } from '../types/chat';
import type {
	SendMessageRequest,
	SendMessageResponse,
	GetMessagesResponse
} from '../types/payloads';
import type { TextStyle } from '../types/text-formatting';
import { invalidate } from '$app/navigation';
import { env } from '$env/dynamic/public';
import { SSEClient, type SSEClientConfig } from '../sse/SSEClient.svelte';
import type { SSEEventMap } from '../sse/SSEEventEmitter';
import type { ConnectionStatus } from '../sse/config';

// Use the public environment variable with a fallback
const DEFAULT_CHAT_ROOM_ID =
	env.PUBLIC_DEFAULT_CHAT_ROOM_ID || '00000000-0000-0000-0000-000000000001';

class ChatState {
	// User and message state
	private users = $state<SafeUser[]>([]);
	private messages = $state<Message[]>([]);
	private currentUser = $state<SafeUser | null>(null);
	private currentRoomId = $state<string>(DEFAULT_CHAT_ROOM_ID);
	private userCache = $state<Record<string, SafeUser>>({});
	private hasMoreMessages = $state(false);

	// SSE Client
	private sseClient: SSEClient | null = null;

	// Connection state
	private _connectionStatus = $state<ConnectionStatus>('disconnected');
	private _sseError = $state<string | null>(null);

	// Internal state flags
	private isInitializing = $state(false);
	private isSettingUser = $state(false);

	// Memoization for enriched messages
	private _memoizedEnrichedMessages: EnrichedMessage[] | null = null;
	private _lastEnrichmentKey: string = '';

	// Buddy list tracking
	private lastBuddyListHash = '';

	// Public polling for unauthenticated users
	private publicPollingInterval: ReturnType<typeof setInterval> | null = null;

	// Derived state
	public connectionStatus = $derived(this._connectionStatus);
	public sseError = $derived(this._sseError);
	public isConnected = $derived(this._connectionStatus === 'connected');
	public isReconnecting = $derived(this._connectionStatus === 'reconnecting');

	/**
	 * Reinitialize the chat state (e.g., after login)
	 */
	public async reinitialize() {
		if (this.isInitializing) {
			console.debug('Reinitialize already in progress, skipping.');
			return;
		}
		this.isInitializing = true;
		console.debug('Reinitializing chat state...');

		// Disconnect existing SSE client
		if (this.sseClient) {
			this.sseClient.disconnect();
			this.sseClient = null;
		}

		this.messages = [];
		this.currentRoomId = DEFAULT_CHAT_ROOM_ID;

		if (this.currentUser) {
			console.debug('Waiting for session cookie update before setting up SSE...');
			await new Promise((resolve) => setTimeout(resolve, 1000));

			// Set up SSE connection
			this.setupSSE();

			// Initialize messages and room users
			await Promise.all([this.initializeMessages(), this.initializeRoomUsers()]);
		}

		this.isInitializing = false;
	}

	/**
	 * Get SSE error information
	 */
	getSSEError() {
		return {
			error: this._sseError,
			status: this._connectionStatus,
			retryAfter: this.sseClient?.getReconnectDelay() ?? null
		};
	}

	/**
	 * Get the current user
	 */
	getCurrentUser() {
		return this.currentUser;
	}

	/**
	 * Set the current user
	 */
	async setCurrentUser(user: User | SafeUser | null) {
		console.debug('setCurrentUser called with', user ? { ...user, password: '[REDACTED]' } : null);

		if (this.isSettingUser) {
			console.debug('Already setting user, skipping');
			return;
		}

		this.isSettingUser = true;

		try {
			if (!user && !this.currentUser) {
				console.debug('No user to set and no current user, skipping');
				return;
			}

			const safeUser = user ? ('password' in user ? createSafeUser(user) : user) : null;

			// Check if same user with active connection
			if (safeUser?.id === this.currentUser?.id) {
				if (!this.sseClient || !this.sseClient.isConnected) {
					console.debug('Same user being set but no active SSE connection, reinitializing.');
				} else {
					console.debug('Same user being set with active connection, skipping.');
					return;
				}
			}

			this.messages = [];
			this.currentUser = safeUser;

			if (safeUser) {
				this.userCache[safeUser.id] = safeUser;
				await this.reinitialize();
			} else {
				// Cleanup when user is removed
				if (this.sseClient) {
					this.sseClient.disconnect();
					this.sseClient = null;
				}
				this.messages = [];
				this.users = [];
				this.userCache = {};
				this._connectionStatus = 'disconnected';
			}
		} finally {
			this.isSettingUser = false;
		}
	}

	/**
	 * Initialize room users
	 */
	private async initializeRoomUsers() {
		console.debug('Initializing room users for room:', this.currentRoomId);
		try {
			const isPublic = !this.currentUser;
			const url = `/api/rooms/${this.currentRoomId}${isPublic ? '?public=true' : ''}`;
			console.debug('Fetching room users from:', url);

			const response = await fetch(url, { credentials: 'include' });

			if (!response.ok) {
				throw new Error('Failed to fetch room users');
			}

			const data = await response.json();
			if (!data.success) {
				throw new Error(data.error);
			}

			console.debug('Fetched room buddy list:', data.buddyList);

			// Merge fetched buddy list with existing cached users
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- temporary Map for merging
			const mergedUsers = new Map<string, SafeUser>();
			Object.values(this.userCache).forEach((user) => mergedUsers.set(user.id, user));
			data.buddyList.forEach((user: SafeUser) => mergedUsers.set(user.id, user));

			this.users = Array.from(mergedUsers.values());
			this.users.forEach((user) => {
				this.userCache[user.id] = user;
			});
		} catch (error) {
			console.debug('Error fetching room users:', error);
			this.users = [];
		}
	}

	/**
	 * Get online users sorted by status
	 */
	getOnlineUsers() {
		return [...this.users].sort((a: SafeUser, b: SafeUser) => {
			const statusOrder: Record<SafeUser['status'], number> = {
				online: 0,
				away: 1,
				busy: 2,
				offline: 3
			};
			return statusOrder[a.status] - statusOrder[b.status];
		});
	}

	/**
	 * Get user by ID
	 */
	getUserById(userId: string) {
		if (this.userCache[userId]) {
			return this.userCache[userId];
		}

		const fallback: SafeUser = {
			id: userId,
			nickname: 'Unknown User',
			status: 'offline',
			lastSeen: null,
			avatarUrl: null
		};
		this.userCache[userId] = fallback;
		console.debug('getUserById: returning fallback for missing user', { userId, fallback });
		return fallback;
	}

	/**
	 * Update user status
	 */
	updateUserStatus(userId: string, status: User['status'], lastSeen?: number) {
		console.debug('Updating user status with:', {
			userId,
			status,
			lastSeen,
			currentCache: this.userCache[userId],
			currentUsers: this.users.find((u) => u.id === userId)
		});

		const existingUser = this.userCache[userId];
		if (
			existingUser &&
			existingUser.status === status &&
			lastSeen &&
			Math.abs((existingUser.lastSeen ?? 0) - lastSeen) < 5000
		) {
			console.debug('Skipping redundant status update for user:', userId);
			return;
		}

		let user: SafeUser | undefined = this.userCache[userId];

		if (!user) {
			const foundUser = this.users.find((u: SafeUser) => u.id === userId);
			if (foundUser) {
				user = foundUser;
			}
		}

		const now = Date.now();
		if (user) {
			const updatedUser: SafeUser = {
				...user,
				status,
				lastSeen: lastSeen ?? (status === 'offline' ? now : user.lastSeen)
			};

			this.userCache[userId] = updatedUser;

			const index = this.users.findIndex((u: SafeUser) => u.id === userId);
			if (index !== -1) {
				this.users = [...this.users.slice(0, index), updatedUser, ...this.users.slice(index + 1)];
			} else {
				this.users = [...this.users, updatedUser];
			}

			console.debug('User status updated:', {
				userId,
				newStatus: status,
				newLastSeen: new Date(updatedUser.lastSeen || now).toISOString()
			});
		} else {
			console.debug('User not found in cache or list, fetching from API:', userId);
			fetch(`/api/users/${userId}`, { credentials: 'include' })
				.then((response) => response.json())
				.then((data) => {
					if (data.success && data.user) {
						const newUser: SafeUser = {
							...data.user,
							status,
							lastSeen: lastSeen ?? (status === 'offline' ? now : data.user.lastSeen)
						};
						this.userCache[userId] = newUser;
						this.users = [...this.users, newUser];

						console.debug('User fetched and status updated:', {
							userId,
							status: newUser.status
						});
					}
				})
				.catch((error) => console.error('Error fetching user data:', error));
		}
	}

	/**
	 * Get enriched messages with user data
	 */
	getMessages() {
		const key =
			this.messages.map((m) => m.id).join(',') + '|' + Object.keys(this.userCache).sort().join(',');
		if (key === this._lastEnrichmentKey && this._memoizedEnrichedMessages !== null) {
			return this._memoizedEnrichedMessages;
		}
		this._lastEnrichmentKey = key;
		console.debug('Enriching messages with user data', {
			messagesCount: this.messages.length,
			userCacheSize: Object.keys(this.userCache).length
		});
		this._memoizedEnrichedMessages = this.enrichMessages(this.messages);
		return this._memoizedEnrichedMessages;
	}

	/**
	 * Prepend messages (for loading older messages)
	 */
	public prependMessages(newMessages: Message[], hasMore?: boolean) {
		console.debug('Prepending messages:', { count: newMessages.length });

		const uniqueUserIds = new Set(newMessages.map((msg) => msg.senderId));
		const missingUserIds = Array.from(uniqueUserIds).filter((id) => !this.userCache[id]);

		if (missingUserIds.length > 0) {
			console.debug('Fetching missing user data for IDs:', missingUserIds);
			Promise.all(
				missingUserIds.map(async (userId) => {
					try {
						const userResponse = await fetch(`/api/users/${userId}`, {
							credentials: 'include'
						});
						if (userResponse.ok) {
							const userData = await userResponse.json();
							if (userData.success && userData.user) {
								this.userCache[userId] = userData.user;
								if (!this.users.some((u) => u.id === userId)) {
									this.users = [...this.users, userData.user];
								}
							}
						}
					} catch (error) {
						console.debug('Error fetching user data:', { userId, error });
					}
				})
			);
		}

		const sortedNewMessages = newMessages.slice().sort((a, b) => a.timestamp - b.timestamp);
		const uniqueNewMessages = sortedNewMessages.filter(
			(msg) => !this.messages.some((m) => m.id === msg.id)
		);
		this.messages = [...uniqueNewMessages, ...this.messages];

		if (hasMore !== undefined) {
			this.hasMoreMessages = hasMore;
		}
	}

	/**
	 * Update user cache
	 */
	updateUserCache(users: (User | SafeUser)[]) {
		console.debug(
			'Updating user cache with users:',
			users.map((u) => ({ ...u, password: '[REDACTED]' }))
		);
		users.forEach((user) => {
			const safeUser = 'password' in user ? createSafeUser(user) : user;
			if (!this.userCache[user.id] || safeUser.status !== this.userCache[user.id].status) {
				this.userCache[user.id] = safeUser;
				const existingIndex = this.users.findIndex((u) => u.id === user.id);
				if (existingIndex === -1) {
					this.users = [...this.users, safeUser];
				} else if (safeUser.status !== this.users[existingIndex].status) {
					this.users = [
						...this.users.slice(0, existingIndex),
						safeUser,
						...this.users.slice(existingIndex + 1)
					];
				}
			}
		});
	}

	/**
	 * Update online users (from buddy list updates)
	 */
	updateOnlineUsers(users: (User | SafeUser)[]) {
		const now = Date.now();
		const safeUsers = users.map((user) => ('password' in user ? createSafeUser(user) : user));
		const newHash = JSON.stringify(safeUsers);

		if (newHash !== this.lastBuddyListHash) {
			const statusCounts = safeUsers.reduce(
				(acc, user) => {
					acc[user.status] = (acc[user.status] || 0) + 1;
					return acc;
				},
				{} as Record<string, number>
			);

			console.debug('Updating online users (data changed):', {
				total: safeUsers.length,
				byStatus: statusCounts,
				timestamp: new Date(now).toISOString()
			});

			this.users = safeUsers;
			safeUsers.forEach((user) => {
				this.userCache[user.id] = user;
			});
			this.lastBuddyListHash = newHash;
		}
	}

	/**
	 * Update messages (for public/unauthenticated access)
	 */
	updateMessages(messages: Message[]) {
		const uniqueMessages = Array.from(new Map(messages.map((msg) => [msg.id, msg])).values());
		this.messages = uniqueMessages.sort((a, b) => a.timestamp - b.timestamp);
	}

	/**
	 * Initialize messages from the server
	 */
	async initializeMessages() {
		try {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- URLSearchParams for URL building
			const params = new URLSearchParams();
			if (!this.currentUser) {
				params.append('public', 'true');
			}
			params.append('roomId', this.currentRoomId);

			const response = await fetch(`/api/chat/messages?${params}`, {
				credentials: 'include'
			});
			if (!response.ok) throw new Error('Failed to fetch messages');

			const data = (await response.json()) as GetMessagesResponse;
			if (!data.success) {
				throw new Error(data.error);
			}

			const uniqueUserIds = new Set(data.messages.map((msg) => msg.senderId));
			const missingUserIds = Array.from(uniqueUserIds).filter((id) => !this.userCache[id]);

			if (missingUserIds.length > 0) {
				console.debug('Fetching missing user data for IDs:', missingUserIds);
				await Promise.all(
					missingUserIds.map(async (userId) => {
						try {
							const userResponse = await fetch(`/api/users/${userId}`, {
								credentials: 'include'
							});
							if (userResponse.ok) {
								const userData = await userResponse.json();
								if (userData.success && userData.user) {
									this.userCache[userId] = userData.user;
									if (!this.users.some((u) => u.id === userId)) {
										this.users = [...this.users, userData.user];
									}
								}
							}
						} catch (error) {
							console.debug('Error fetching user data:', { userId, error });
						}
					})
				);
			}

			this.messages = data.messages.slice().sort((a, b) => a.timestamp - b.timestamp);

			if ('hasMore' in data) {
				this.hasMoreMessages = data.hasMore;
			}

			console.debug('Messages initialized:', {
				count: data.messages.length,
				isAuthenticated: !!this.currentUser,
				hasMore: this.hasMoreMessages
			});
		} catch (error) {
			console.debug('Error fetching initial messages:', error);
			this.messages = [];
			this.hasMoreMessages = false;
		}
	}

	/**
	 * Send a message
	 */
	async sendMessage(
		content: string,
		type: Message['type'] = 'chat',
		textStyle?: TextStyle
	): Promise<SendMessageResponse> {
		const user = this.getCurrentUser();
		if (!user) {
			console.debug('Cannot send message: No current user');
			return {
				success: false,
				error: 'Not logged in'
			};
		}

		try {
			const payload: SendMessageRequest = {
				content,
				type,
				userId: user.id,
				chatRoomId: DEFAULT_CHAT_ROOM_ID,
				styleData: textStyle ? JSON.stringify(textStyle) : undefined
			};

			console.debug('Sending message with payload:', payload);

			const response = await fetch('/api/chat/messages', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				credentials: 'include',
				body: JSON.stringify(payload)
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error || 'Failed to save message');
			}

			const data = (await response.json()) as SendMessageResponse;
			if (!data.success) {
				throw new Error(data.error);
			}

			console.debug('Message sent successfully:', data.message);
			await invalidate('chat:messages');
			return data;
		} catch (error) {
			console.debug('Error sending message:', error);
			return {
				success: false,
				error: 'Failed to send message'
			};
		}
	}

	/**
	 * Set up SSE connection using the new SSEClient
	 */
	private setupSSE() {
		if (this.sseClient && this.sseClient.isConnected) {
			console.debug('setupSSE: Active SSE connection exists, skipping setup.');
			return;
		}

		if (!this.currentUser) {
			console.debug('No current user, skipping SSE connection');
			return;
		}

		console.debug('Setting up SSE connection...');

		const config: SSEClientConfig = {
			url: '/api/sse',
			onMessage: this.handleSSEMessage.bind(this),
			onStatusChange: this.handleConnectionStatusChange.bind(this),
			onError: (error) => {
				this._sseError = error;
				console.debug('SSE error:', error);
			}
		};

		this.sseClient = new SSEClient(config);
		this.sseClient.connect();
	}

	/**
	 * Handle incoming SSE messages
	 */
	private handleSSEMessage<T extends keyof SSEEventMap>(type: T, data: SSEEventMap[T]) {
		switch (type) {
			case 'chatMessage':
				this.handleChatMessage(data as SSEEventMap['chatMessage']);
				break;
			case 'buddyListUpdate':
				this.updateOnlineUsers(data as SSEEventMap['buddyListUpdate']);
				break;
			case 'userStatusUpdate': {
				const statusData = data as SSEEventMap['userStatusUpdate'];
				this.updateUserStatus(statusData.userId, statusData.status, statusData.lastSeen);
				break;
			}
			case 'heartbeat':
				// Heartbeat is handled by SSEClient, no action needed here
				break;
			default:
				console.debug('Unknown SSE event type:', type);
		}
	}

	/**
	 * Handle chat message from SSE
	 */
	private async handleChatMessage(messageData: Message) {
		console.debug('Received chat message via SSE:', messageData);

		// Deduplicate and update messages array
		this.messages = Array.from(
			new Map([...this.messages, messageData].map((m) => [m.id, m])).values()
		);
		this.messages.sort((a, b) => a.timestamp - b.timestamp);

		// Ensure the sender's data is available
		await this.ensureUserData(messageData.senderId);
	}

	/**
	 * Handle connection status changes
	 */
	private handleConnectionStatusChange(status: ConnectionStatus) {
		this._connectionStatus = status;
		console.debug('SSE connection status changed:', status);

		if (status === 'connected') {
			this._sseError = null;
		}
	}

	/**
	 * Ensure user data is loaded
	 */
	private async ensureUserData(userId: string) {
		if (this.userCache[userId]) return;

		console.debug('Fetching user data for:', userId);
		try {
			const response = await fetch(`/api/users/${userId}`, {
				credentials: 'include'
			});
			if (response.ok) {
				const userData = await response.json();
				if (userData.success && userData.user) {
					this.userCache[userId] = userData.user;
					if (!this.users.some((u) => u.id === userId)) {
						this.users = [...this.users, userData.user];
					}
				}
			}
		} catch (error) {
			console.debug('Error fetching user data:', error);
		}
	}

	/**
	 * Enrich messages with user data
	 */
	enrichMessages(messages: Message[]): EnrichedMessage[] {
		console.debug('Enriching messages with user data', {
			messagesCount: messages.length,
			userCacheSize: Object.keys(this.userCache).length
		});
		return messages.map((message) => ({
			...message,
			user: this.userCache[message.senderId] || {
				id: message.senderId,
				nickname: 'Unknown User',
				status: 'offline',
				avatarUrl: null,
				lastSeen: null
			}
		}));
	}

	/**
	 * Get the default chat room ID
	 */
	getDefaultChatRoomId() {
		return DEFAULT_CHAT_ROOM_ID;
	}

	/**
	 * Disconnect SSE (for cleanup)
	 */
	disconnect() {
		if (this.sseClient) {
			this.sseClient.disconnect();
			this.sseClient = null;
		}
		if (this.publicPollingInterval) {
			clearInterval(this.publicPollingInterval);
			this.publicPollingInterval = null;
		}
	}
}

export const chatState = new ChatState();
