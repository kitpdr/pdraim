import type { RequestEvent } from '@sveltejs/kit';
import { createLogger } from '$lib/utils/logger.server';

const log = createLogger('rate-limiter');

const isDev = import.meta.env.DEV;

// Rate limit configuration by endpoint type
const RATE_LIMITS = {
	// Authentication endpoints (login, register)
	auth: {
		points: isDev ? 1000 : 20,
		durationMs: 5 * 60 * 1000
	},

	// Public endpoints (public chat)
	public: {
		points: isDev ? 1000 : 30,
		durationMs: 60 * 1000
	},

	// Protected endpoints (authenticated API calls)
	protected: {
		points: isDev ? 1000 : 100,
		durationMs: 60 * 1000
	}
} as const;

// In-memory store for rate limiting
const ipRequests = new Map<string, Array<{ timestamp: number }>>();

// Compute max duration across all rate limits for cleanup
const MAX_RATE_LIMIT_DURATION = Math.max(
	RATE_LIMITS.auth.durationMs,
	RATE_LIMITS.public.durationMs,
	RATE_LIMITS.protected.durationMs
);

// Lazy cleanup: remove stale entries on each check (Cloudflare Workers don't allow setInterval at global scope)
let lastCleanup = 0;

function cleanupStaleEntries() {
	const now = Date.now();
	// Run cleanup at most once per max duration window
	if (now - lastCleanup < MAX_RATE_LIMIT_DURATION) return;
	lastCleanup = now;

	for (const [ip, timestamps] of ipRequests.entries()) {
		const filtered = timestamps.filter((t) => now - t.timestamp < MAX_RATE_LIMIT_DURATION);
		if (filtered.length === 0) {
			ipRequests.delete(ip);
		} else {
			ipRequests.set(ip, filtered);
		}
	}
}

function getEndpointType(pathname: string, isPublic: boolean): keyof typeof RATE_LIMITS {
	if (pathname.startsWith('/api/session/login') || pathname.startsWith('/api/register')) {
		return 'auth';
	}
	if (isPublic) {
		return 'public';
	}
	return 'protected';
}

function isRateLimited(
	ip: string,
	endpointType: keyof typeof RATE_LIMITS
): { limited: boolean; retryAfter?: number } {
	// Lazy cleanup on each check (replaces setInterval for Cloudflare compatibility)
	cleanupStaleEntries();

	// Skip rate limiting completely in development for localhost
	if (isDev && (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost')) {
		return { limited: false };
	}

	const now = Date.now();
	const { points, durationMs } = RATE_LIMITS[endpointType];
	const requests = ipRequests.get(ip) || [];
	const validRequests = requests.filter((req) => now - req.timestamp < durationMs);

	log.debug(
		`Rate limit check for ${ip} on ${endpointType}: ${validRequests.length}/${points} requests in the last ${durationMs / 1000}s`
	);

	if (validRequests.length >= points) {
		const oldestRequest = validRequests[0];
		const retryAfter = durationMs - (now - oldestRequest.timestamp);
		return { limited: true, retryAfter };
	}

	validRequests.push({ timestamp: now });
	ipRequests.set(ip, validRequests);

	return { limited: false };
}

export async function handleRateLimit(event: RequestEvent): Promise<Response | null> {
	const ip = event.getClientAddress();
	const url = new URL(event.request.url);
	const isPublic = url.searchParams.get('public') === 'true';

	// Skip rate limiting for non-API routes
	if (!url.pathname.startsWith('/api')) {
		return null;
	}

	const endpointType = getEndpointType(url.pathname, isPublic);
	const { limited, retryAfter } = isRateLimited(ip, endpointType);

	if (limited) {
		// Construct a user-friendly error message
		let errorMessage = 'Too many requests. ';
		if (endpointType === 'auth') {
			errorMessage += 'Please wait before attempting to log in again.';
		} else {
			errorMessage += 'Please try again later.';
		}

		// Build response body - only include debug info in development
		const responseBody: Record<string, unknown> = {
			error: errorMessage,
			retryAfter: Math.ceil((retryAfter || 0) / 1000)
		};

		// Only include potentially sensitive info in dev mode
		if (isDev) {
			responseBody.endpointType = endpointType;
			responseBody.debug = {
				hasUser: Boolean(event.locals.user),
				hasSession: Boolean(event.locals.session),
				endpointType,
				rateLimitPoints: RATE_LIMITS[endpointType].points
			};
		}

		// Build headers - only include debug headers in development
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			'Retry-After': Math.ceil((retryAfter || 0) / 1000).toString()
		};

		if (isDev) {
			headers['X-Debug-Has-User'] = Boolean(event.locals.user).toString();
			headers['X-Debug-Has-Session'] = Boolean(event.locals.session).toString();
			headers['X-Debug-Endpoint-Type'] = endpointType;
			headers['X-Debug-Rate-Limit-Points'] = RATE_LIMITS[endpointType].points.toString();
		}

		return new Response(JSON.stringify(responseBody), {
			status: 429,
			headers
		});
	}

	return null;
}
