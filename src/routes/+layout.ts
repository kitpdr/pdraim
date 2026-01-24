import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ data, depends }) => {
	// Register client-side dependencies for invalidation
	depends('app:session');
	depends('app:chat');
	// Return the data from the server load function
	return {
		user: data.user,
		session: data.session,
		meta: {
			title: 'PDR AIM - Sandbox',
			description:
				"Un projet sandbox non lucratif qui recrée l'ambiance des salons de discussion de l'époque AOL/AIM. Une expérience nostalgique dans un environnement Windows XP.",
			keywords:
				'sandbox chat, AOL, AIM, salon de discussion, Windows XP, projet non lucratif, rétro',
			ogImage: '/og-image.jpg',
			type: 'website',
			url: 'https://pdraim.org',
			locale: 'fr_FR'
		}
	};
};
