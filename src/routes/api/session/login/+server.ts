import type { RequestHandler } from '@sveltejs/kit';
import type { LoginResponseSuccess, LoginResponseError } from '$lib/types/payloads';
import { users } from '$lib/db/convex.server';
import { verifyPassword } from '$lib/utils/password';
import { generateSessionToken, createSession } from '$lib/api/session.server';
import { setSessionTokenCookie } from '$lib/api/session.cookie';
import { createSafeUser } from '$lib/types/chat';
import { createLogger } from '$lib/utils/logger.server';
import { loginSchema } from '$lib/validation/password';
import { z } from 'zod';

const log = createLogger('login-server');

// In-memory map to track failed login attempts per IP
const loginAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MAX_ATTEMPTS = 3;
const ONE_HOUR = 60 * 60 * 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Lazy cleanup: Cloudflare Workers don't allow setInterval at global scope
let lastCleanup = 0;
function cleanupOldAttempts() {
	const now = Date.now();
	if (now - lastCleanup < ONE_HOUR) return;
	lastCleanup = now;

	for (const [ip, data] of loginAttempts.entries()) {
		if (now - data.lastAttempt > ONE_HOUR) {
			loginAttempts.delete(ip);
		}
	}
}

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	log.debug('New login attempt received');

	// Lazy cleanup on each request (replaces setInterval for Cloudflare compatibility)
	cleanupOldAttempts();

	if (request.method !== 'POST') {
		log.warn('Invalid method used', { method: request.method });
		return new Response(JSON.stringify({ error: 'Method Not Allowed' } as LoginResponseError), {
			status: 405
		});
	}

	// Get the IP address for rate limiting
	const ip = getClientAddress();
	const maskedIp = ip
		.split('.')
		.map((octet, idx) => (idx < 3 ? 'xxx' : octet))
		.join('.');
	const now = Date.now();
	const attemptData = loginAttempts.get(ip) || { count: 0, lastAttempt: 0 };

	if (attemptData.count >= MAX_ATTEMPTS) {
		const delay = Math.pow(2, attemptData.count - MAX_ATTEMPTS + 1) * 1000;
		log.warn('Rate limit exceeded', { maskedIp, delay });
		await sleep(delay);
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		log.warn('Invalid JSON payload received');
		return new Response(JSON.stringify({ error: 'Invalid JSON' } as LoginResponseError), {
			status: 400
		});
	}

	const { username, password } = body as {
		username: string;
		password: string;
	};

	// Validate input using Zod schema
	try {
		loginSchema.parse({ username, password });
	} catch (err) {
		const zodError = err as z.ZodError;
		const errorMessage = zodError.issues?.[0]?.message || 'Invalid input data';
		log.warn('Login validation failed', { error: errorMessage });
		return new Response(JSON.stringify({ error: errorMessage } as LoginResponseError), {
			status: 400
		});
	}

	// Find user by username using Convex
	const user = await users.getByNickname(username.trim());

	if (!user) {
		attemptData.count++;
		attemptData.lastAttempt = now;
		loginAttempts.set(ip, attemptData);
		log.warn('Login failed - user not found', {
			maskedIp,
			attemptCount: attemptData.count,
			username: username.trim()
		});
		const remaining = Math.max(0, MAX_ATTEMPTS - attemptData.count);
		return new Response(
			JSON.stringify({
				error: `Invalid username or password. ${remaining > 0 ? remaining + ' attempt(s) remaining.' : 'Please wait before trying again.'}`
			} as LoginResponseError),
			{ status: 401 }
		);
	}

	// Use native Convex _id
	const userId = user._id;

	// Verify password
	try {
		const isValid = await verifyPassword(password.trim(), user.password);
		if (!isValid) {
			attemptData.count++;
			attemptData.lastAttempt = now;
			loginAttempts.set(ip, attemptData);
			log.warn('Login failed - invalid password', {
				maskedIp,
				attemptCount: attemptData.count,
				userId: `${userId.slice(0, 4)}...${userId.slice(-4)}`
			});
			const remaining = Math.max(0, MAX_ATTEMPTS - attemptData.count);
			return new Response(
				JSON.stringify({
					error: `Invalid username or password. ${remaining > 0 ? remaining + ' attempt(s) remaining.' : 'Please wait before trying again.'}`
				} as LoginResponseError),
				{ status: 401 }
			);
		}
	} catch (error) {
		log.error('Error verifying password', { error });
		return new Response(JSON.stringify({ error: 'Internal Server Error' } as LoginResponseError), {
			status: 500
		});
	}

	// Reset login attempt data on success
	loginAttempts.delete(ip);

	// Generate session token and create session
	const token = generateSessionToken();
	const session = await createSession(token, userId);

	// Update user status to online using Convex
	await users.updateStatus(userId, 'online');

	// Set session cookie
	setSessionTokenCookie({ cookies }, token, session.expiresAt);

	log.info('Login successful', {
		userId: `${userId.slice(0, 4)}...${userId.slice(-4)}`,
		expiresAt: new Date(session.expiresAt).toISOString()
	});

	// Return user with native Convex ID
	return new Response(
		JSON.stringify({
			success: true,
			user: createSafeUser({
				id: userId,
				nickname: user.nickname,
				status: 'online',
				avatarUrl: user.avatarUrl,
				lastSeen: user.lastSeen,
				lastReadMentionTimestamp: user.lastReadMentionTimestamp
			})
		} as LoginResponseSuccess),
		{
			status: 200
		}
	);
};
