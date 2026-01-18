import type { PageServerLoad } from './$types';
import { validateSessionToken } from '$lib/api/session.server';
import { DEFAULT_TEXT_STYLE, type TextStyle } from '$lib/types/text-formatting';

export const load: PageServerLoad = async ({ cookies }) => {
	const token = cookies.get('session');

	if (!token) {
		return {
			user: null,
			lastTextStyle: DEFAULT_TEXT_STYLE
		};
	}

	try {
		const { user } = await validateSessionToken(token);

		if (!user) {
			return {
				user: null,
				lastTextStyle: DEFAULT_TEXT_STYLE
			};
		}

		// For now, return default text style
		// TODO: Fetch user's last text style from Convex if needed
		const lastTextStyle: TextStyle = DEFAULT_TEXT_STYLE;

		return {
			user,
			lastTextStyle
		};
	} catch (error) {
		console.error('Error loading page data:', error);
		return {
			user: null,
			lastTextStyle: DEFAULT_TEXT_STYLE
		};
	}
};
