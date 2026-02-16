import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import convex from '$lib/db/convex.server';
import { DEFAULT_USER_PREFERENCES, type UserTextPreferences } from '$lib/types/text-formatting';
import { validateSessionToken } from '$lib/api/session.server';
import { sanitizeStyleData } from '$lib/validation/text-formatting';

const isKitHttpError = (err: unknown): err is { status: number; body: unknown } => {
	return typeof err === 'object' && err !== null && 'status' in err && 'body' in err;
};

// GET - Fetch current user's text preferences
export const GET: RequestHandler = async ({ cookies }) => {
	try {
		// Get session token from cookie
		const sessionToken = cookies.get('session');
		if (!sessionToken) {
			throw error(401, 'No session found');
		}

		// Validate session token
		const { user } = await validateSessionToken(sessionToken);

		if (!user) {
			throw error(401, 'Invalid session');
		}

		// Get user's text preferences
		const preferences = await convex.textPreferences.get(user.id);

		if (!preferences) {
			// Return defaults if no preferences exist
			return json({
				success: true,
				preferences: DEFAULT_USER_PREFERENCES
			});
		}

		// Convert Convex format to frontend format
		const frontendPreferences: UserTextPreferences = {
			defaultStyle: preferences.defaultStyle as UserTextPreferences['defaultStyle'],
			allowFormatting: preferences.allowFormatting,
			maxMessageLength: preferences.maxMessageLength
		};

		return json({
			success: true,
			preferences: frontendPreferences
		});
	} catch (err) {
		console.error('Failed to fetch text preferences:', err);
		if (err instanceof Response || isKitHttpError(err)) {
			throw err;
		}
		throw error(500, 'Failed to fetch preferences');
	}
};

// POST - Save current user's text preferences
export const POST: RequestHandler = async ({ cookies, request }) => {
	try {
		// Get session token from cookie
		const sessionToken = cookies.get('session');
		if (!sessionToken) {
			throw error(401, 'No session found');
		}

		// Validate session token
		const { user } = await validateSessionToken(sessionToken);

		if (!user) {
			throw error(401, 'Invalid session');
		}

		// Parse request body
		const body = await request.json();
		const { allowFormatting, maxMessageLength } = body as {
			allowFormatting: unknown;
			maxMessageLength: unknown;
			defaultStyle: unknown;
		};

		// Validate types
		if (typeof allowFormatting !== 'boolean' || typeof maxMessageLength !== 'number') {
			throw error(400, 'Invalid preferences data');
		}

		// Validate and sanitize style data through existing Zod schema
		const validatedStyle = sanitizeStyleData(body.defaultStyle);
		if (!validatedStyle) {
			throw error(400, 'Invalid style data');
		}

		// Save preferences via Convex
		const result = await convex.textPreferences.save(
			user.id,
			validatedStyle,
			allowFormatting,
			maxMessageLength
		);

		return json({
			success: true,
			id: result.id
		});
	} catch (err) {
		console.error('Failed to save text preferences:', err);
		if (err instanceof Response || isKitHttpError(err)) {
			throw err;
		}
		throw error(500, 'Failed to save preferences');
	}
};
