import type { RequestHandler } from '@sveltejs/kit';
import type { RegisterResponseSuccess, RegisterResponseError } from '$lib/types/payloads';
import { users } from '$lib/db/convex.server';
import { hashPassword } from '$lib/utils/password';
import { createRegistrationSchema, DEFAULT_PASSWORD_CONSTRAINTS } from '$lib/validation/password';
import { createLogger } from '$lib/utils/logger.server';

const log = createLogger('register-server');

// In-memory map to track failed captcha attempts per IP
const captchaAttempts = new Map<string, { count: number; lastAttempt: number }>();

// Lazy cleanup: Cloudflare Workers don't allow setInterval at global scope
const ONE_HOUR = 60 * 60 * 1000;
let lastCleanup = 0;
function cleanupOldCaptchaAttempts() {
	const now = Date.now();
	if (now - lastCleanup < ONE_HOUR) return;
	lastCleanup = now;

	for (const [ip, data] of captchaAttempts.entries()) {
		if (now - data.lastAttempt > ONE_HOUR) {
			captchaAttempts.delete(ip);
		}
	}
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	log.debug('New registration attempt received');

	// Lazy cleanup on each request (replaces setInterval for Cloudflare compatibility)
	cleanupOldCaptchaAttempts();

	if (request.method !== 'POST') {
		log.warn('Invalid method used', { method: request.method });
		return new Response(JSON.stringify({ error: 'Method Not Allowed' } as RegisterResponseError), {
			status: 405
		});
	}

	// Get the IP address for rate limiting and Turnstile validation
	const ip = getClientAddress();
	const maskedIp = ip
		.split('.')
		.map((octet, idx) => (idx < 3 ? 'xxx' : octet))
		.join('.');
	const now = Date.now();
	const attemptData = captchaAttempts.get(ip) || { count: 0, lastAttempt: 0 };

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		log.warn('Invalid JSON payload received');
		return new Response(JSON.stringify({ error: 'Invalid JSON' } as RegisterResponseError), {
			status: 400
		});
	}

	const { suUsername, suPassword, suConfirmPassword, captchaAnswer, turnstileToken } = body as {
		suUsername: string;
		suPassword: string;
		suConfirmPassword: string;
		captchaAnswer: string;
		turnstileToken?: string;
	};

	// Validate input using Zod schema
	try {
		const registrationSchema = createRegistrationSchema(DEFAULT_PASSWORD_CONSTRAINTS);
		registrationSchema.parse({
			suUsername,
			suPassword,
			suConfirmPassword,
			captchaAnswer,
			turnstileToken
		});
	} catch (err: unknown) {
		const zodError = err as { errors?: Array<{ message?: string }> };
		const errorMessage = zodError.errors?.[0]?.message || 'Invalid input data';
		log.warn('Registration validation failed', { error: errorMessage });
		return new Response(JSON.stringify({ error: errorMessage } as RegisterResponseError), {
			status: 400
		});
	}

	// Validate PDR captcha
	// SECURITY NOTE: Static CAPTCHA answer is intentional for this community app.
	// The answer "point de rencontre" acts as a shared-knowledge gate, not bot prevention.
	// Bot prevention is handled by Cloudflare Turnstile (when enabled in production).
	const normalizedAnswer = captchaAnswer.trim().toLowerCase();
	if (normalizedAnswer !== 'point de rencontre') {
		attemptData.count++;
		attemptData.lastAttempt = now;
		captchaAttempts.set(ip, attemptData);
		log.warn('Invalid captcha answer', { maskedIp, attemptCount: attemptData.count });
		return new Response(
			JSON.stringify({ error: 'Invalid answer to the PDR question' } as RegisterResponseError),
			{ status: 400 }
		);
	}

	// Reset captcha attempts on success
	captchaAttempts.delete(ip);

	// Trim input values (validation already done by Zod)
	const username = suUsername.trim();
	const password = suPassword;

	// Check if nickname already exists using Convex
	const existingUser = await users.getByNickname(username);
	if (existingUser) {
		log.warn('Username already exists', { username });
		return new Response(
			JSON.stringify({ error: 'This username is already taken' } as RegisterResponseError),
			{ status: 409 }
		);
	}

	// Securely hash the user's password.
	let hashedPassword: string;
	try {
		hashedPassword = await hashPassword(password);
	} catch {
		log.error('Error hashing password');
		return new Response(
			JSON.stringify({ error: 'Internal Server Error' } as RegisterResponseError),
			{ status: 500 }
		);
	}

	// Insert the new user into Convex
	try {
		await users.create(username, hashedPassword);
		log.info(`User ${username} registered successfully`);
	} catch (err: unknown) {
		log.error('Database insertion error', { error: err as object });
		return new Response(
			JSON.stringify({
				error: 'User registration failed. Possibly user already exists.'
			} as RegisterResponseError),
			{ status: 409 }
		);
	}

	return new Response(JSON.stringify({ success: true } as RegisterResponseSuccess), {
		status: 201
	});
};
