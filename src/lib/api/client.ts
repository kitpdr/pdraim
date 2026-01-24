/**
 * API Client for SvelteKit endpoints
 * Provides typed helper functions for all API calls
 */

import type { TextStyle, UserTextPreferences } from '$lib/types/text-formatting';

// ============ TYPES ============

export interface ApiResponse<T> {
	success: boolean;
	data?: T;
	error?: string;
}

export interface TextPreferencesResponse {
	success: boolean;
	preferences: UserTextPreferences | null;
}

// ============ BASE CLIENT ============

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
	try {
		const response = await fetch(endpoint, {
			credentials: 'include',
			headers: {
				'Content-Type': 'application/json',
				...options.headers
			},
			...options
		});

		const data = await response.json();

		if (!response.ok) {
			return {
				success: false,
				error: data.error || `Request failed with status ${response.status}`
			};
		}

		return { success: true, data };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error'
		};
	}
}

// ============ TEXT PREFERENCES ============

export const textPreferences = {
	/**
	 * Get current user's text preferences
	 */
	async get(): Promise<UserTextPreferences | null> {
		const result = await request<TextPreferencesResponse>('/api/user/text-preferences');
		if (result.success && result.data?.preferences) {
			return result.data.preferences;
		}
		return null;
	},

	/**
	 * Save user's text preferences (partial update supported)
	 */
	async save(preferences: {
		defaultStyle: TextStyle;
		allowFormatting?: boolean;
		maxMessageLength?: number;
	}): Promise<boolean> {
		const result = await request('/api/user/text-preferences', {
			method: 'POST',
			body: JSON.stringify(preferences)
		});
		return result.success;
	}
};

// ============ MENTIONS ============

export const mentions = {
	/**
	 * Update the timestamp of the last read mention
	 */
	async markRead(timestamp: number): Promise<boolean> {
		const result = await request('/api/chat/mention-read', {
			method: 'POST',
			body: JSON.stringify({ timestamp })
		});
		return result.success;
	}
};

// ============ SESSION ============

export interface LoginResponse {
	success: boolean;
	user?: {
		id: string;
		nickname: string;
		status: string;
	};
	error?: string;
}

export const session = {
	/**
	 * Login with username and password
	 */
	async login(username: string, password: string): Promise<LoginResponse> {
		const result = await request<LoginResponse>('/api/session/login', {
			method: 'POST',
			body: JSON.stringify({ username, password })
		});
		return result.data ?? { success: false, error: result.error };
	},

	/**
	 * Register a new user
	 */
	async register(
		username: string,
		password: string,
		confirmPassword: string
	): Promise<LoginResponse> {
		const result = await request<LoginResponse>('/api/register', {
			method: 'POST',
			body: JSON.stringify({
				suUsername: username,
				suPassword: password,
				suConfirmPassword: confirmPassword
			})
		});
		return result.data ?? { success: false, error: result.error };
	}
};

// ============ CHAT ============

export interface SendMessageParams {
	content: string;
	roomId: string;
	styleData?: string;
	hasFormatting?: boolean;
}

export const chat = {
	/**
	 * Send a message to a chat room
	 */
	async sendMessage(params: SendMessageParams): Promise<boolean> {
		const result = await request('/api/chat/messages', {
			method: 'POST',
			body: JSON.stringify(params)
		});
		return result.success;
	},

	/**
	 * Load more messages (pagination)
	 */
	async loadMessages(
		roomId: string,
		beforeTimestamp?: number,
		isPublic = false
	): Promise<{ messages: unknown[]; hasMore: boolean } | null> {
		const params = new URLSearchParams({ roomId });
		if (beforeTimestamp) params.set('before', beforeTimestamp.toString());
		if (isPublic) params.set('public', 'true');

		const result = await request<{ success: boolean; messages: unknown[]; hasMore: boolean }>(
			`/api/chat/messages?${params.toString()}`
		);
		if (result.success && result.data) {
			return { messages: result.data.messages, hasMore: result.data.hasMore };
		}
		return null;
	}
};

// ============ EXPORT ============

export const api = {
	textPreferences,
	mentions,
	session,
	chat
};

export default api;
