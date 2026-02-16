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
	headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

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
let initPromise: Promise<void> | null = null;
let lastFailedAttempt = 0;
let failureCount = 0;
const BASE_COOLDOWN = 5000; // 5 seconds
const MAX_COOLDOWN = 60000; // 1 minute max

function initializeServer(): Promise<void> {
	if (initPromise) return initPromise;

	// Exponential backoff after failures
	if (lastFailedAttempt > 0) {
		const cooldown = Math.min(BASE_COOLDOWN * Math.pow(2, failureCount - 1), MAX_COOLDOWN);
		if (Date.now() - lastFailedAttempt < cooldown) {
			return Promise.resolve();
		}
	}

	initPromise = (async () => {
		try {
			log.info('Initializing server...');
			await ensureDefaultChatRoom();
			await setAllUsersOffline();
			log.info('Server initialized successfully');
			lastFailedAttempt = 0;
			failureCount = 0;
		} catch (error: unknown) {
			log.error('Failed to initialize server:', { error, failureCount: failureCount + 1 });
			lastFailedAttempt = Date.now();
			failureCount++;
			initPromise = null;
		}
	})();

	return initPromise;
}

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;

	// Skip initialization for static assets and non-API routes
	const needsInit = path.startsWith('/api/') && !path.startsWith('/api/health');
	if (needsInit) {
		await initializeServer();
	}

	log.debug('Handling request', { path });

	// CSRF protection: validate Origin header for state-changing requests
	if (event.request.method !== 'GET' && event.request.method !== 'HEAD') {
		const origin = event.request.headers.get('origin');
		const host = event.request.headers.get('host');

		if (!origin) {
			// Browsers always send Origin on state-changing requests.
			// Missing Origin means non-browser client (curl, scripts).
			log.warn('CSRF check failed - missing origin header', {
				method: event.request.method,
				path: event.url.pathname
			});
			return new Response('Forbidden', { status: 403 });
		}

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

	// Identify public chat requests if there is no valid session
	const isPublicChatRequest =
		event.url.pathname.startsWith('/api/chat/messages') && event.request.method === 'GET';

	if (isPublicChatRequest && !event.locals.session) {
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

	// Apply rate limiting for non-public endpoints
	if (!isPublicChatRequest) {
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
