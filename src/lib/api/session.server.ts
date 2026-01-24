import { sessions } from '../db/convex.server';
import type { Session, SafeUser } from '../types/chat';
import { createLogger } from '../utils/logger.server';

const log = createLogger('session-server');

// Helper: Compute SHA-256 hash of a message and encode it as a hex string.
export async function sha256(message: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(message);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
	return hashHex;
}

// Helper: Custom Base32 encoder using the standard alphabet.
const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(data: Uint8Array): string {
	let bits = 0;
	let value = 0;
	let output = '';
	for (let i = 0; i < data.length; i++) {
		value = (value << 8) | data[i];
		bits += 8;
		while (bits >= 5) {
			const index = (value >>> (bits - 5)) & 0x1f;
			output += base32Alphabet[index];
			bits -= 5;
		}
	}
	if (bits > 0) {
		const index = (value << (5 - bits)) & 0x1f;
		output += base32Alphabet[index];
	}
	return output;
}

// Generate a secure session token by generating 20 random bytes and Base32 encoding them.
export function generateSessionToken(): string {
	const randomBytesArray = new Uint8Array(20);
	crypto.getRandomValues(randomBytesArray);
	const token = base32Encode(randomBytesArray);
	log.debug('Generated session token', { tokenPrefix: token.slice(0, 4) + '***' });
	return token;
}

// Create a session record once a valid token is available.
// The session ID is the SHA-256 hash of the token.
export async function createSession(token: string, userId: string): Promise<Session> {
	log.debug('Creating session', { userId });
	const tokenHash = await sha256(token);
	const createdAt = Date.now();
	const expiresAt = createdAt + 7 * 24 * 60 * 60 * 1000; // 7 days expiry

	await sessions.create(tokenHash, userId, expiresAt);

	log.debug('Session created', { tokenHash });
	return { id: tokenHash, userId, createdAt, expiresAt };
}

/**
 * Type distributed through our API.
 * Returns an object with both session and user if valid, or nulls if not.
 */
export type SessionValidationResult =
	| { session: Session; user: SafeUser }
	| { session: null; user: null };

// Validate a session token by converting it to its SHA-256 hash, checking expiration, and fetching the user.
export async function validateSessionToken(token: string): Promise<SessionValidationResult> {
	log.debug('Validating session token');
	const tokenHash = await sha256(token);

	const result = await sessions.validate(tokenHash);

	if (!result.session || !result.user) {
		log.debug('Session not found or invalid', { tokenHash });
		return { session: null, user: null };
	}

	// Map Convex types to our local types - using native Convex IDs
	const session: Session = {
		id: result.session.tokenHash,
		userId: result.user._id,
		createdAt: result.session.createdAt,
		expiresAt: result.session.expiresAt
	};

	const user: SafeUser = {
		id: result.user._id,
		nickname: result.user.nickname,
		status: result.user.status as SafeUser['status'],
		avatarUrl: result.user.avatarUrl,
		lastSeen: result.user.lastSeen,
		lastReadMentionTimestamp: result.user.lastReadMentionTimestamp
	};

	log.debug('Session validated', { tokenHash, userId: user.id });
	return { session, user };
}

// Invalidate a specific session by deleting it from the database.
export async function invalidateSession(tokenHash: string): Promise<void> {
	log.debug('Invalidating session', { tokenHash });
	await sessions.remove(tokenHash);
	log.debug('Session invalidated', { tokenHash });
}
