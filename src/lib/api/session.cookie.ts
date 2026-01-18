import type { Cookies } from '@sveltejs/kit';
import { createLogger } from '$lib/utils/logger.server';

const log = createLogger('session-cookie');

// Helper function to determine cookie domain
function getCookieDomain(): string | undefined {
	// Allow explicit override via environment variable
	const envDomain = process.env.COOKIE_DOMAIN;
	if (envDomain) {
		log.debug('Using COOKIE_DOMAIN from environment:', { domain: envDomain });
		return envDomain;
	}

	if (process.env.NODE_ENV === 'production') {
		// Check for Cloudflare Pages domain
		if (process.env.CF_PAGES_URL) {
			const url = process.env.CF_PAGES_URL;
			log.debug('Cloudflare Pages URL:', { url });
			// For preview deployments, use host-only cookie
			if (process.env.CF_PAGES_BRANCH !== 'main') {
				return undefined;
			}
			// For production on Cloudflare Pages, use host-only cookie (safest default)
			// Set COOKIE_DOMAIN explicitly if cross-subdomain cookies are needed
			return undefined;
		}
		// Production without explicit domain - use host-only cookie (safest default)
		return undefined;
	}
	return undefined;
}

export function setSessionTokenCookie(
	{ cookies }: { cookies: Cookies },
	token: string,
	expiresAt: number
): void {
	log.debug('Setting session cookie with expiry:', new Date(expiresAt));

	const domain = getCookieDomain();
	log.debug('Setting cookie for domain:', { domain });

	cookies.set('session', token, {
		httpOnly: true,
		sameSite: 'lax',
		secure: process.env.NODE_ENV === 'production',
		domain,
		expires: new Date(expiresAt),
		path: '/'
	});
}

export function deleteSessionTokenCookie({ cookies }: { cookies: Cookies }): void {
	log.debug('Deleting session cookie');

	const domain = getCookieDomain();
	log.debug('Deleting cookie for domain:', { domain });

	cookies.set('session', '', {
		httpOnly: true,
		sameSite: 'lax',
		secure: process.env.NODE_ENV === 'production',
		domain,
		maxAge: 0,
		path: '/'
	});
}

export function getSessionTokenCookie({ cookies }: { cookies: Cookies }): string | undefined {
	log.debug('Getting session cookie');
	return cookies.get('session');
}
