import type { Id } from '../../convex/_generated/dataModel';

export type AimStatus = 'online' | 'away' | 'busy' | 'idle' | 'offline';

/** Public user shape returned by Convex queries (getUsersPublic, getMyBuddies…) */
export interface AimUser {
	id: Id<'users'>;
	nickname: string;
	status: AimStatus;
	avatarUrl?: string | null;
	lastSeen?: number | null;
	awayMessage?: string;
	createdAt?: number;
}

export interface Buddy extends AimUser {
	group: string;
	addedAt: number;
}

export interface DirectRoomSummary {
	id: Id<'chatRooms'>;
	other: AimUser | null;
	lastMessage: { content: string; timestamp: number; senderId: Id<'users'> } | null;
	unreadCount: number;
}

export interface GroupRoomSummary {
	id: Id<'chatRooms'>;
	name: string;
	topic?: string;
	createdAt: number;
	isDefault: boolean;
}

export const DEFAULT_BUDDY_GROUPS = ['Buddies', 'Family', 'Co-Workers'] as const;

export const STATUS_LABELS_FR: Record<AimStatus, string> = {
	online: 'En ligne',
	away: 'Absent',
	busy: 'Occupé',
	idle: 'Inactif',
	offline: 'Hors ligne'
};
