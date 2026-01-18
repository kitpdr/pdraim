import type { Handle } from '@sveltejs/kit';
import { users } from '$lib/db/convex.server';
import { handleRateLimit } from '$lib/api/rate-limiter';
import { createLogger } from '$lib/utils/logger.server';
import { ensureDefaultChatRoom } from '$lib/utils/chat.server';
import { validateSessionToken } from '$lib/api/session.server';
import { setSessionTokenCookie, deleteSessionTokenCookie } from '$lib/api/session.cookie';

const log = createLogger('hooks-server');

// Add security headers to response
function addSecurityHeaders(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set('X-Frame-Options', 'DENY');
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

// Set all users to offline on server start (using Convex)
async function setAllUsersOffline() {
	try {
		const result = await users.setAllOffline();
		log.info('All users set to offline on server start', { updated: result.updated });
	} catch (error: unknown) {
		log.error('Failed to set users offline on server start:', { error });
	}
}

// Initialize server (deferred, non-blocking for Cloudflare Workers compatibility)
let initialized = false;
async function initializeServer() {
	if (initialized) return;
	initialized = true;
	try {
		log.info('Initializing server...');
		await ensureDefaultChatRoom();
		await setAllUsersOffline();
		log.info('Server initialized successfully');
	} catch (error: unknown) {
		log.error('Failed to initialize server:', { error });
		// Don't exit - let the server continue and retry on next request
		initialized = false;
	}
}

export const handle: Handle = async ({ event, resolve }) => {
	// Lazy initialization on first request (Cloudflare Workers compatible)
	await initializeServer();

	log.debug('Handling request', { path: event.url.pathname });

	// CSRF protection: validate Origin header for state-changing requests
	if (event.request.method !== 'GET' && event.request.method !== 'HEAD') {
		const origin = event.request.headers.get('origin');
		const host = event.request.headers.get('host');

		// Block cross-origin requests (origin header is present but doesn't match host)
		if (origin) {
			try {
				const originUrl = new URL(origin);
				if (originUrl.host !== host) {
					log.warn('CSRF check failed - origin mismatch', {
						origin: originUrl.host,
						host
					});
					return new Response('Forbidden', { status: 403 });
				}
			} catch {
				log.warn('CSRF check failed - invalid origin', { origin });
				return new Response('Forbidden', { status: 403 });
			}
		}
	}

	// Get session token from cookies
	const token = event.cookies.get('session') ?? null;

	// Validate session token if token exists
	if (token) {
		const { session, user } = await validateSessionToken(token);
		if (session) {
			log.debug('Valid session found', { user: user?.nickname });
			setSessionTokenCookie(event, token, session.expiresAt);
			event.locals.session = session;
			event.locals.user = user;
		} else {
			log.debug('Invalid session token');
			deleteSessionTokenCookie(event);
			event.locals.session = null;
			event.locals.user = null;
		}
	}

	// Identify public chat and room requests if there is no valid session
	const isPublicChatRequest =
		event.url.pathname.startsWith('/api/chat/messages') && event.request.method === 'GET';
	const isPublicRoomRequest =
		event.url.pathname.startsWith('/api/rooms/') && event.request.method === 'GET';

	if ((isPublicChatRequest || isPublicRoomRequest) && !event.locals.session) {
		log.debug('Public request accessed', { path: event.url.pathname });
		const response = await resolve(event);
		return addSecurityHeaders(response);
	}

	// Public routes that don't require authentication
	const publicRoutes = [
		'/',
		'/api/session/login',
		'/api/session/validate',
		'/api/register',
		'/login',
		'/register'
	];

	// Handle public routes
	if (publicRoutes.includes(event.url.pathname)) {
		log.debug('Public route accessed', { path: event.url.pathname });
		const response = await resolve(event);
		return addSecurityHeaders(response);
	}

	// Skip rate limiting for SSE endpoint when authenticated
	if (event.url.pathname.startsWith('/api/sse')) {
		const response = await resolve(event);
		return addSecurityHeaders(response);
	}

	// Apply rate limiting for non-public endpoints
	if (!isPublicChatRequest && !isPublicRoomRequest) {
		const rateLimitResult = await handleRateLimit(event);
		if (rateLimitResult?.status === 429) {
			return new Response('Too Many Requests', {
				status: 429,
				headers: {
					'Retry-After': '60'
				}
			});
		}
	}

	const response = await resolve(event);
	return addSecurityHeaders(response);
};
