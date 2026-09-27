/**
 * Desktop window manager.
 *
 * Every window on the XP desktop (buddy list, chat rooms, IMs, dialogs) is
 * registered here so the taskbar, focus order and z-index are consistent.
 */
import type { Id } from '../../convex/_generated/dataModel';

export type WindowKind =
	| 'buddy-list'
	| 'chat-room'
	| 'im'
	| 'login'
	| 'profile'
	| 'away'
	| 'new-room'
	| 'preferences'
	| 'about';

export interface DesktopWindow {
	id: string;
	kind: WindowKind;
	title: string;
	icon: string;
	z: number;
	minimized: boolean;
	/** Set when a window wants the taskbar button to blink (new IM). */
	attention: boolean;
	/** Kind-specific payload */
	props: Record<string, unknown>;
}

export interface ImWindowProps {
	roomId: Id<'chatRooms'>;
	otherUserId: Id<'users'>;
	otherNickname: string;
}

export interface ChatRoomWindowProps {
	roomId: Id<'chatRooms'> | null; // null = default room
	roomName: string;
}

export interface ProfileWindowProps {
	userId: Id<'users'>;
	nickname: string;
}

class DesktopState {
	windows = $state<DesktopWindow[]>([]);
	focusedId = $state<string | null>(null);
	private nextZ = 10;

	/** Whether the login "sign on" sequence is running (modem animation). */
	signingOn = $state(false);

	focused = $derived(this.windows.find((w) => w.id === this.focusedId) ?? null);
	taskbarWindows = $derived([...this.windows].sort((a, b) => a.id.localeCompare(b.id)));

	get(id: string) {
		return this.windows.find((w) => w.id === id) ?? null;
	}

	has(id: string) {
		return this.windows.some((w) => w.id === id);
	}

	/**
	 * Open (or focus if already open) a window.
	 * Windows are identified by a stable id so that e.g. an IM with a given
	 * user is never opened twice.
	 */
	open(win: Omit<DesktopWindow, 'z' | 'minimized' | 'attention'>) {
		const existing = this.get(win.id);
		if (existing) {
			existing.title = win.title;
			existing.props = win.props;
			this.focus(win.id);
			return existing;
		}
		const created: DesktopWindow = {
			...win,
			z: ++this.nextZ,
			minimized: false,
			attention: false
		};
		this.windows = [...this.windows, created];
		this.focusedId = created.id;
		return created;
	}

	close(id: string) {
		this.windows = this.windows.filter((w) => w.id !== id);
		if (this.focusedId === id) {
			const top = [...this.windows].filter((w) => !w.minimized).sort((a, b) => b.z - a.z)[0];
			this.focusedId = top?.id ?? null;
		}
	}

	focus(id: string) {
		const win = this.get(id);
		if (!win) return;
		win.minimized = false;
		win.attention = false;
		win.z = ++this.nextZ;
		this.focusedId = id;
	}

	minimize(id: string) {
		const win = this.get(id);
		if (!win) return;
		win.minimized = true;
		if (this.focusedId === id) {
			const top = [...this.windows].filter((w) => !w.minimized).sort((a, b) => b.z - a.z)[0];
			this.focusedId = top?.id ?? null;
		}
	}

	toggleFromTaskbar(id: string) {
		const win = this.get(id);
		if (!win) return;
		if (win.minimized || this.focusedId !== id) {
			this.focus(id);
		} else {
			this.minimize(id);
		}
	}

	requestAttention(id: string) {
		const win = this.get(id);
		if (win && this.focusedId !== id) win.attention = true;
	}

	blurAll() {
		this.focusedId = null;
	}

	// ---------- Convenience openers ----------

	openBuddyList() {
		return this.open({
			id: 'buddy-list',
			kind: 'buddy-list',
			title: 'Liste de contacts',
			icon: '/aim/running-man.svg',
			props: {}
		});
	}

	openChatRoom(roomId: Id<'chatRooms'> | null, roomName: string) {
		const props: ChatRoomWindowProps = { roomId, roomName };
		return this.open({
			id: roomId ? `room-${roomId}` : 'room-default',
			kind: 'chat-room',
			title: `Salon : ${roomName}`,
			icon: '/aim/chat-room.svg',
			props: props as unknown as Record<string, unknown>
		});
	}

	openIm(props: ImWindowProps) {
		return this.open({
			id: `im-${props.roomId}`,
			kind: 'im',
			title: `${props.otherNickname} - Message instantané`,
			icon: '/aim/im.svg',
			props: props as unknown as Record<string, unknown>
		});
	}

	openLogin(tab: 'signin' | 'signup' = 'signin') {
		return this.open({
			id: 'login',
			kind: 'login',
			title: 'Connexion',
			icon: '/aim/running-man.svg',
			props: { tab }
		});
	}

	openProfile(props: ProfileWindowProps) {
		return this.open({
			id: `profile-${props.userId}`,
			kind: 'profile',
			title: `Infos sur ${props.nickname}`,
			icon: '/aim/info.svg',
			props: props as unknown as Record<string, unknown>
		});
	}

	openAway() {
		return this.open({
			id: 'away',
			kind: 'away',
			title: 'Message d’absence',
			icon: '/aim/away.svg',
			props: {}
		});
	}

	openNewRoom() {
		return this.open({
			id: 'new-room',
			kind: 'new-room',
			title: 'Nouveau salon',
			icon: '/aim/chat-room.svg',
			props: {}
		});
	}

	openPreferences() {
		return this.open({
			id: 'preferences',
			kind: 'preferences',
			title: 'Préférences',
			icon: '/aim/setup-icon.png',
			props: {}
		});
	}

	openAbout() {
		return this.open({
			id: 'about',
			kind: 'about',
			title: 'À propos de PDR AIM',
			icon: '/aim/help-icon.png',
			props: {}
		});
	}
}

export const desktop = new DesktopState();
