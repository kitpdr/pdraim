// Chat window state persistence utility
// Stores and retrieves window position, size, and UI state from localStorage

export interface ChatWindowState {
	width: number;
	height: number;
	x: number;
	y: number;
	isMaximized: boolean;
	isMinimized: boolean;
	showUserList: boolean;
	isCentered: boolean; // true = window stays centered on resize, false = user has manually positioned
}

const STORAGE_KEY = 'pdraim-chat-window';

// Default values for desktop (800x600 - 16:10 aspect ratio, centered)
export const DEFAULT_WINDOW_STATE: ChatWindowState = {
	width: 800,
	height: 600,
	x: -1, // -1 means "center" - will be calculated on load
	y: -1, // -1 means "center" - will be calculated on load
	isMaximized: false,
	isMinimized: false,
	showUserList: false,
	isCentered: true // default to centered, set to false when user drags window
};

/**
 * Load window state from localStorage
 * Returns saved state merged with defaults, or just defaults if nothing saved
 */
export function loadWindowState(): ChatWindowState {
	if (typeof window === 'undefined') {
		return DEFAULT_WINDOW_STATE;
	}

	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) {
			const parsed = JSON.parse(stored);
			// Merge with defaults to ensure all fields exist
			return {
				...DEFAULT_WINDOW_STATE,
				...parsed
			};
		}
	} catch (error) {
		console.warn('Failed to load chat window state from localStorage:', error);
	}

	return DEFAULT_WINDOW_STATE;
}

/**
 * Save window state to localStorage
 * Debounced externally - this just does the save
 */
export function saveWindowState(state: Partial<ChatWindowState>): void {
	if (typeof window === 'undefined') {
		return;
	}

	try {
		const currentState = loadWindowState();
		const newState = { ...currentState, ...state };
		localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
	} catch (error) {
		console.warn('Failed to save chat window state to localStorage:', error);
	}
}

/**
 * Clear saved window state
 */
export function clearWindowState(): void {
	if (typeof window === 'undefined') {
		return;
	}

	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch (error) {
		console.warn('Failed to clear chat window state from localStorage:', error);
	}
}

/**
 * Simple debounce function for save operations
 */
export function debounce<T extends (...args: Parameters<T>) => void>(
	fn: T,
	delay: number
): (...args: Parameters<T>) => void {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;

	return (...args: Parameters<T>) => {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
		timeoutId = setTimeout(() => {
			fn(...args);
			timeoutId = null;
		}, delay);
	};
}
