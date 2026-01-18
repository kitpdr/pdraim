import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';

const http = httpRouter();

// Validate the secret header for server-to-server calls
function validateSecret(request: Request): boolean {
	const secret = request.headers.get('X-Convex-Secret');
	const expectedSecret = process.env.CONVEX_API_SECRET;

	if (!expectedSecret) {
		console.error('CONVEX_API_SECRET environment variable not set');
		return false;
	}

	return secret === expectedSecret;
}

// Generic error response
function unauthorizedResponse() {
	return new Response(JSON.stringify({ error: 'Unauthorized' }), {
		status: 401,
		headers: { 'Content-Type': 'application/json' }
	});
}

function errorResponse(message: string, status = 400) {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

// Helper function to safely parse JSON body
async function parseJsonBody<T>(request: Request): Promise<T | null> {
	try {
		return (await request.json()) as T;
	} catch {
		return null;
	}
}

// ============ USERS (server-side only) ============

// Get user by nickname - for login
http.route({
	path: '/api/users/getByNickname',
	method: 'POST',
	handler: httpAction(async (ctx, request) => {
		if (!validateSecret(request)) return unauthorizedResponse();

		const body = await parseJsonBody<{ nickname: string }>(request);
		if (!body) return errorResponse('Invalid JSON', 400);

		const user = await ctx.runQuery(internal.usersInternal.getByNickname, {
			nickname: body.nickname
		});

		return new Response(JSON.stringify(user), {
			headers: { 'Content-Type': 'application/json' }
		});
	})
});

// Create user - for registration
http.route({
	path: '/api/users/create',
	method: 'POST',
	handler: httpAction(async (ctx, request) => {
		if (!validateSecret(request)) return unauthorizedResponse();

		const body = await parseJsonBody<{ nickname: string; password: string }>(request);
		if (!body) return errorResponse('Invalid JSON', 400);

		try {
			const userId = await ctx.runMutation(internal.usersInternal.create, {
				nickname: body.nickname,
				password: body.password
			});
			return new Response(JSON.stringify({ userId }), {
				headers: { 'Content-Type': 'application/json' }
			});
		} catch (e) {
			return errorResponse(e instanceof Error ? e.message : 'Failed to create user');
		}
	})
});

// Get user by ID
http.route({
	path: '/api/users/getById',
	method: 'POST',
	handler: httpAction(async (ctx, request) => {
		if (!validateSecret(request)) return unauthorizedResponse();

		const body = await parseJsonBody<{ id: string }>(request);
		if (!body) return errorResponse('Invalid JSON', 400);

		const user = await ctx.runQuery(internal.usersInternal.getById, { id: body.id as Id<'users'> });

		return new Response(JSON.stringify(user), {
			headers: { 'Content-Type': 'application/json' }
		});
	})
});

// List all users
http.route({
	path: '/api/users/list',
	method: 'POST',
	handler: httpAction(async (ctx, request) => {
		if (!validateSecret(request)) return unauthorizedResponse();

		const users = await ctx.runQuery(internal.usersInternal.list);

		return new Response(JSON.stringify(users), {
			headers: { 'Content-Type': 'application/json' }
		});
	})
});

// Update user status
http.route({
	path: '/api/users/updateStatus',
	method: 'POST',
	handler: httpAction(async (ctx, request) => {
		if (!validateSecret(request)) return unauthorizedResponse();

		const body = await parseJsonBody<{ userId: string; status: string }>(request);
		if (!body) return errorResponse('Invalid JSON', 400);

		try {
			const user = await ctx.runMutation(internal.usersInternal.updateStatus, {
				id: body.userId as Id<'users'>,
				status: body.status
			});
			return new Response(JSON.stringify(user), {
				headers: { 'Content-Type': 'application/json' }
			});
		} catch (e) {
			return errorResponse(e instanceof Error ? e.message : 'Failed to update status');
		}
	})
});

// Set all users offline (server startup)
http.route({
	path: '/api/users/setAllOffline',
	method: 'POST',
	handler: httpAction(async (ctx, request) => {
		if (!validateSecret(request)) return unauthorizedResponse();

		const result = await ctx.runMutation(internal.usersInternal.setAllOffline);

		return new Response(JSON.stringify(result), {
			headers: { 'Content-Type': 'application/json' }
		});
	})
});

// ============ SESSIONS (server-side only) ============

// Create session - for login
http.route({
	path: '/api/sessions/create',
	method: 'POST',
	handler: httpAction(async (ctx, request) => {
		if (!validateSecret(request)) return unauthorizedResponse();

		const body = await parseJsonBody<{ tokenHash: string; userId: string; expiresAt: number }>(
			request
		);
		if (!body) return errorResponse('Invalid JSON', 400);

		try {
			const result = await ctx.runMutation(internal.sessionsInternal.create, {
				tokenHash: body.tokenHash,
				userId: body.userId as Id<'users'>,
				expiresAt: body.expiresAt
			});
			return new Response(JSON.stringify(result), {
				headers: { 'Content-Type': 'application/json' }
			});
		} catch (e) {
			return errorResponse(e instanceof Error ? e.message : 'Failed to create session');
		}
	})
});

// Validate session
http.route({
	path: '/api/sessions/validate',
	method: 'POST',
	handler: httpAction(async (ctx, request) => {
		if (!validateSecret(request)) return unauthorizedResponse();

		const body = await parseJsonBody<{ tokenHash: string }>(request);
		if (!body) return errorResponse('Invalid JSON', 400);

		const result = await ctx.runQuery(internal.sessionsInternal.validateAndGetUser, {
			tokenHash: body.tokenHash
		});

		return new Response(JSON.stringify(result), {
			headers: { 'Content-Type': 'application/json' }
		});
	})
});

// Remove session - for logout
http.route({
	path: '/api/sessions/remove',
	method: 'POST',
	handler: httpAction(async (ctx, request) => {
		if (!validateSecret(request)) return unauthorizedResponse();

		const body = await parseJsonBody<{ tokenHash: string }>(request);
		if (!body) return errorResponse('Invalid JSON', 400);

		await ctx.runMutation(internal.sessionsInternal.remove, { tokenHash: body.tokenHash });

		return new Response(JSON.stringify({ success: true }), {
			headers: { 'Content-Type': 'application/json' }
		});
	})
});

// ============ CHAT ROOMS (server-side only) ============

// Get or create default room
http.route({
	path: '/api/chatRooms/getOrCreateDefault',
	method: 'POST',
	handler: httpAction(async (ctx, request) => {
		if (!validateSecret(request)) return unauthorizedResponse();

		const room = await ctx.runMutation(internal.chatRoomsInternal.getOrCreateDefault);

		return new Response(JSON.stringify(room), {
			headers: { 'Content-Type': 'application/json' }
		});
	})
});

// Get room by ID
http.route({
	path: '/api/chatRooms/getById',
	method: 'POST',
	handler: httpAction(async (ctx, request) => {
		if (!validateSecret(request)) return unauthorizedResponse();

		const body = await parseJsonBody<{ id: string }>(request);
		if (!body) return errorResponse('Invalid JSON', 400);

		const room = await ctx.runQuery(internal.chatRoomsInternal.getById, {
			id: body.id as Id<'chatRooms'>
		});

		return new Response(JSON.stringify(room), {
			headers: { 'Content-Type': 'application/json' }
		});
	})
});

// ============ MESSAGES (server-side only) ============

// Get messages by room - for initial load
http.route({
	path: '/api/messages/getByRoom',
	method: 'POST',
	handler: httpAction(async (ctx, request) => {
		if (!validateSecret(request)) return unauthorizedResponse();

		const body = await parseJsonBody<{ roomId: string; limit?: number; beforeTimestamp?: number }>(
			request
		);
		if (!body) return errorResponse('Invalid JSON', 400);

		const result = await ctx.runQuery(internal.messagesInternal.getByRoom, {
			roomId: body.roomId as Id<'chatRooms'>,
			limit: body.limit,
			beforeTimestamp: body.beforeTimestamp
		});

		return new Response(JSON.stringify(result), {
			headers: { 'Content-Type': 'application/json' }
		});
	})
});

// Send message
http.route({
	path: '/api/messages/send',
	method: 'POST',
	handler: httpAction(async (ctx, request) => {
		if (!validateSecret(request)) return unauthorizedResponse();

		const body = await parseJsonBody<{
			chatRoomId: string;
			senderId: string;
			content: string;
			type: string;
			styleData?: string;
			hasFormatting?: boolean;
			timestamp?: number;
		}>(request);
		if (!body) return errorResponse('Invalid JSON', 400);

		try {
			const message = await ctx.runMutation(internal.messagesInternal.send, {
				chatRoomId: body.chatRoomId as Id<'chatRooms'>,
				senderId: body.senderId as Id<'users'>,
				content: body.content,
				type: body.type,
				styleData: body.styleData,
				hasFormatting: body.hasFormatting,
				timestamp: body.timestamp
			});
			return new Response(JSON.stringify(message), {
				headers: { 'Content-Type': 'application/json' }
			});
		} catch (e) {
			return errorResponse(e instanceof Error ? e.message : 'Failed to send message');
		}
	})
});

// ============ TEXT PREFERENCES (server-side only) ============

// Get user text preferences
http.route({
	path: '/api/textPreferences/get',
	method: 'POST',
	handler: httpAction(async (ctx, request) => {
		if (!validateSecret(request)) return unauthorizedResponse();

		const body = await parseJsonBody<{ userId: string }>(request);
		if (!body) return errorResponse('Invalid JSON', 400);

		const preferences = await ctx.runQuery(internal.textPreferencesInternal.getByUserId, {
			userId: body.userId as Id<'users'>
		});

		return new Response(JSON.stringify(preferences), {
			headers: { 'Content-Type': 'application/json' }
		});
	})
});

// Save user text preferences
http.route({
	path: '/api/textPreferences/save',
	method: 'POST',
	handler: httpAction(async (ctx, request) => {
		if (!validateSecret(request)) return unauthorizedResponse();

		const body = await parseJsonBody<{
			userId: string;
			defaultStyle: {
				fontFamily: string;
				fontSize: number;
				color?: string;
				gradient?: string[];
				bold: boolean;
				italic: boolean;
				underline: boolean;
				strikethrough: boolean;
			};
			allowFormatting: boolean;
			maxMessageLength: number;
		}>(request);
		if (!body) return errorResponse('Invalid JSON', 400);

		try {
			const result = await ctx.runMutation(internal.textPreferencesInternal.upsert, {
				userId: body.userId as Id<'users'>,
				defaultStyle: body.defaultStyle,
				allowFormatting: body.allowFormatting,
				maxMessageLength: body.maxMessageLength
			});
			return new Response(JSON.stringify({ success: true, id: result }), {
				headers: { 'Content-Type': 'application/json' }
			});
		} catch (e) {
			return errorResponse(e instanceof Error ? e.message : 'Failed to save preferences');
		}
	})
});

export default http;
