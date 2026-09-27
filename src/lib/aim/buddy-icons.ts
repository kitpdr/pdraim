/**
 * Preset buddy icons (48x48 in the original AIM). Rendered as emoji on a
 * coloured tile so no image assets are needed.
 */
export interface BuddyIconPreset {
	id: string;
	emoji: string;
	label: string;
	bg: string;
}

export const BUDDY_ICONS: BuddyIconPreset[] = [
	{ id: 'runner', emoji: '🏃', label: 'Running man', bg: '#f6c700' },
	{ id: 'smiley', emoji: '🙂', label: 'Smiley', bg: '#ffe680' },
	{ id: 'cool', emoji: '😎', label: 'Cool', bg: '#8fd3ff' },
	{ id: 'cat', emoji: '🐱', label: 'Chat', bg: '#ffd1dc' },
	{ id: 'dog', emoji: '🐶', label: 'Chien', bg: '#d9c3a5' },
	{ id: 'alien', emoji: '👽', label: 'Alien', bg: '#b6ffb0' },
	{ id: 'skull', emoji: '💀', label: 'Crâne', bg: '#dcdcdc' },
	{ id: 'fire', emoji: '🔥', label: 'Feu', bg: '#ffb27a' },
	{ id: 'star', emoji: '⭐', label: 'Étoile', bg: '#3a4fbf' },
	{ id: 'heart', emoji: '💜', label: 'Cœur', bg: '#f7c6ff' },
	{ id: 'music', emoji: '🎵', label: 'Musique', bg: '#c4f0ff' },
	{ id: 'game', emoji: '🎮', label: 'Jeux', bg: '#c9ffd6' },
	{ id: 'pizza', emoji: '🍕', label: 'Pizza', bg: '#ffe0b3' },
	{ id: 'rocket', emoji: '🚀', label: 'Fusée', bg: '#1f2a5a' },
	{ id: 'ghost', emoji: '👻', label: 'Fantôme', bg: '#eaeaff' },
	{ id: 'robot', emoji: '🤖', label: 'Robot', bg: '#cfd8dc' }
];

export const DEFAULT_BUDDY_ICON = BUDDY_ICONS[0];

export function getBuddyIcon(id: string | null | undefined): BuddyIconPreset {
	return BUDDY_ICONS.find((i) => i.id === id) ?? DEFAULT_BUDDY_ICON;
}
