import type { PageServerLoad } from './$types';
import { validateSessionToken } from '$lib/api/session.server';
import {
	DEFAULT_TEXT_STYLE,
	DEFAULT_USER_PREFERENCES,
	type TextStyle
} from '$lib/types/text-formatting';
import convex from '$lib/db/convex.server';

export const load: PageServerLoad = async ({ cookies, depends }) => {
	depends('app:session');
	const token = cookies.get('session');

	if (!token) {
		return {
			user: null,
			textStyle: DEFAULT_TEXT_STYLE,
			userPreferences: DEFAULT_USER_PREFERENCES
		};
	}

	try {
		const { user } = await validateSessionToken(token);

		if (!user) {
			return {
				user: null,
				textStyle: DEFAULT_TEXT_STYLE,
				userPreferences: DEFAULT_USER_PREFERENCES
			};
		}

		// Fetch user's text preferences from Convex
		const prefs = await convex.textPreferences.get(user.id);

		return {
			user,
			textStyle: (prefs?.defaultStyle as TextStyle) ?? DEFAULT_TEXT_STYLE,
			userPreferences: prefs
				? {
						defaultStyle: prefs.defaultStyle as TextStyle,
						allowFormatting: prefs.allowFormatting,
						maxMessageLength: prefs.maxMessageLength
					}
				: DEFAULT_USER_PREFERENCES
		};
	} catch (error) {
		console.error('Error loading page data:', error);
		return {
			user: null,
			textStyle: DEFAULT_TEXT_STYLE,
			userPreferences: DEFAULT_USER_PREFERENCES
		};
	}
};
