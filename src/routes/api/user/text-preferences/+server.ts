import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import convex from '$lib/db/convex.server';
import { DEFAULT_USER_PREFERENCES, type UserTextPreferences } from '$lib/types/text-formatting';
import { validateSessionToken } from '$lib/api/session.server';

// GET - Fetch current user's text preferences
export const GET: RequestHandler = async ({ cookies }) => {
	try {
		// Get session token from cookie
		const sessionToken = cookies.get('pdraim_session');
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
		if (err instanceof Response) {
			throw err;
		}
		throw error(500, 'Failed to fetch preferences');
	}
};

// POST - Save current user's text preferences
export const POST: RequestHandler = async ({ cookies, request }) => {
	try {
		// Get session token from cookie
		const sessionToken = cookies.get('pdraim_session');
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
		const { defaultStyle, allowFormatting, maxMessageLength } = body as UserTextPreferences;

		// Validate required fields
		if (
			!defaultStyle ||
			typeof allowFormatting !== 'boolean' ||
			typeof maxMessageLength !== 'number'
		) {
			throw error(400, 'Invalid preferences data');
		}

		// Save preferences via Convex
		const result = await convex.textPreferences.save(
			user.id,
			defaultStyle,
			allowFormatting,
			maxMessageLength
		);

		return json({
			success: true,
			id: result.id
		});
	} catch (err) {
		console.error('Failed to save text preferences:', err);
		if (err instanceof Response) {
			throw err;
		}
		throw error(500, 'Failed to save preferences');
	}
};
