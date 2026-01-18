import { CONVEX_API_SECRET } from '$env/static/private';
import { PUBLIC_CONVEX_URL } from '$env/static/public';

// Convert .cloud URL to .site URL for HTTP actions
function getHttpUrl(): string {
	return PUBLIC_CONVEX_URL.replace('.convex.cloud', '.convex.site');
}

// Generic fetch helper for Convex HTTP endpoints (server-side only)
async function convexFetch<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
	const url = `${getHttpUrl()}${path}`;

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Convex-Secret': CONVEX_API_SECRET
		},
		body: JSON.stringify(body)
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Convex HTTP error: ${response.status} - ${error}`);
	}

	return response.json();
}

// ============ USERS ============

export const users = {
	getByNickname: (nickname: string) =>
		convexFetch<ConvexUser | null>('/api/users/getByNickname', { nickname }),

	getById: (id: string) => convexFetch<ConvexUser | null>('/api/users/getById', { id }),

	create: (nickname: string, password: string) =>
		convexFetch<{ userId: string }>('/api/users/create', { nickname, password }),

	updateStatus: (userId: string, status: string) =>
		convexFetch<ConvexUser>('/api/users/updateStatus', { userId, status }),

	list: () => convexFetch<ConvexUser[]>('/api/users/list', {}),

	setAllOffline: () => convexFetch<{ updated: number }>('/api/users/setAllOffline', {})
};

// ============ SESSIONS ============

export const sessions = {
	create: (tokenHash: string, userId: string, expiresAt: number) =>
		convexFetch<{ id: string; tokenHash: string }>('/api/sessions/create', {
			tokenHash,
			userId,
			expiresAt
		}),

	validate: (tokenHash: string) =>
		convexFetch<{ session: ConvexSession | null; user: ConvexUser | null }>(
			'/api/sessions/validate',
			{ tokenHash }
		),

	remove: (tokenHash: string) =>
		convexFetch<{ success: boolean }>('/api/sessions/remove', { tokenHash })
};

// ============ CHAT ROOMS ============

export const chatRooms = {
	getOrCreateDefault: () => convexFetch<ConvexChatRoom>('/api/chatRooms/getOrCreateDefault', {}),

	getById: (id: string) => convexFetch<ConvexChatRoom | null>('/api/chatRooms/getById', { id })
};

// ============ MESSAGES ============

export const messages = {
	getByRoom: (roomId: string, limit?: number, beforeTimestamp?: number) =>
		convexFetch<{ messages: ConvexMessage[]; hasMore: boolean }>('/api/messages/getByRoom', {
			roomId,
			limit,
			beforeTimestamp
		}),

	send: (
		chatRoomId: string,
		senderId: string,
		content: string,
		type?: string,
		styleData?: string,
		hasFormatting?: boolean
	) =>
		convexFetch<ConvexMessage>('/api/messages/send', {
			chatRoomId,
			senderId,
			content,
			type,
			styleData,
			hasFormatting
		})
};

// ============ TYPES ============

export interface ConvexUser {
	_id: string;
	_creationTime: number;
	password: string;
	nickname: string;
	status: string;
	avatarUrl?: string;
	createdAt: number;
	lastSeen?: number;
}

export interface ConvexSession {
	_id: string;
	_creationTime: number;
	tokenHash: string;
	userId: string;
	expiresAt: number;
	createdAt: number;
}

export interface ConvexMessage {
	_id: string;
	_creationTime: number;
	chatRoomId: string;
	senderId: string;
	content: string;
	type: string;
	timestamp: number;
	styleData?: string;
	hasFormatting?: boolean;
}

export interface ConvexChatRoom {
	_id: string;
	_creationTime: number;
	name?: string;
	type: string;
	createdAt: number;
}

export default { users, sessions, messages, chatRooms };
