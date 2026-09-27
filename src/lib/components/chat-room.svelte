<script lang="ts">
	import { chatState } from '../states/chat.svelte';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api as convexApi } from '../../convex/_generated/api';
	import type { Id } from '../../convex/_generated/dataModel';
	import type { Message, EnrichedMessage, SafeUser } from '../types/chat';
	import { onMount, tick } from 'svelte';
	import { SvelteSet, SvelteMap } from 'svelte/reactivity';
	import { browser } from '$app/environment';
	import { env } from '$env/dynamic/public';
	import { api } from '$lib/api/client';
	import LoadingButton from './ui/button-loading.svelte';
	import Tooltip from './ui/tooltip.svelte';
	import LoadingDots from './ui/loading-dots.svelte';
	import XpWindow from './desktop/xp-window.svelte';
	import { desktop } from '$lib/states/desktop.svelte';
	import { useAimClient } from '$lib/aim/client';
	import { getBuddyIcon } from '$lib/aim/buddy-icons';
	import { STATUS_LABELS_FR, type AimStatus } from '$lib/types/aim';
	import FormattedMessage from './formatted-message.svelte';
	import TextFormattingToolbar from './text-formatting-toolbar.svelte';
	import MentionPicker from './mention-picker.svelte';
	import {
		MAX_MENTION_SUGGESTIONS,
		MENTION_PICKER,
		findMentionContext,
		highlightMentionsInput,
		containsMention,
		calculatePickerHeight,
		calculatePickerWidth
	} from '../utils/mention';
	import { DEFAULT_TEXT_STYLE, type TextStyle } from '../types/text-formatting';
	import { formatFrenchDateTime, formatFrenchRelativeTimeSafe } from '$lib/utils/date-format';
	import { debounce } from '$lib/utils/chat-window-state';
	import { MAX_MESSAGE_LENGTH } from '$lib/validation/message';

	// Props
	let {
		roomId: requestedRoomId = null,
		roomName = 'General',
		initialTextStyle = DEFAULT_TEXT_STYLE
	} = $props<{
		roomId?: Id<'chatRooms'> | null;
		roomName?: string;
		initialTextStyle?: TextStyle;
	}>();

	// svelte-ignore state_referenced_locally
	const windowId = requestedRoomId ? `room-${requestedRoomId}` : 'room-default';

	const isClient = browser && Boolean(env.PUBLIC_CONVEX_URL);
	const aim = useAimClient();

	// ============ CONVEX REAL-TIME SUBSCRIPTIONS ============

	// Subscribe to default room (to get room ID) when no explicit room was requested
	// svelte-ignore state_referenced_locally
	const defaultRoomQuery =
		isClient && !requestedRoomId ? useQuery(convexApi.queries.getDefaultRoomPublic, {}) : null;

	// Subscribe to users (buddy list) - real-time updates
	const usersQuery = isClient ? useQuery(convexApi.queries.getUsersPublic, {}) : null;

	// Room ID: explicit prop or the default room
	const roomId = $derived(
		(requestedRoomId ?? defaultRoomQuery?.data?.id) as Id<'chatRooms'> | undefined
	);

	// Room topic (from public group rooms list)
	const groupRoomsQuery = isClient ? useQuery(convexApi.aim.getGroupRooms, {}) : null;
	const roomTopic = $derived(groupRoomsQuery?.data?.find((r) => r.id === roomId)?.topic ?? null);

	// Subscribe to messages - skipped until the room ID is available
	const messagesQuery = isClient
		? useQuery(convexApi.queries.getMessagesPublic, () => (roomId ? { roomId } : 'skip'))
		: null;

	const convexClient = isClient ? useConvexClient() : null;

	// Transform Convex users to SafeUser format
	const onlineUsers = $derived.by<SafeUser[]>(() => {
		if (!usersQuery?.data) return [];
		return usersQuery.data
			.map((u) => ({
				id: u.id,
				nickname: u.nickname,
				status: u.status as SafeUser['status'],
				avatarUrl: u.avatarUrl ?? null,
				lastSeen: u.lastSeen ?? null,
				awayMessage: u.awayMessage,
				buddyIcon: u.buddyIcon
			}))
			.sort((a, b) => {
				const statusOrder: Record<string, number> = {
					online: 0,
					idle: 1,
					away: 2,
					busy: 3,
					offline: 4
				};
				const diff = (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
				return diff !== 0 ? diff : a.nickname.localeCompare(b.nickname);
			});
	});

	// Transform Convex messages to EnrichedMessage format
	const messages = $derived.by<EnrichedMessage[]>(() => {
		if (!messagesQuery?.data) return [];
		return messagesQuery.data.map((msg) => ({
			id: msg.id,
			chatRoomId: msg.chatRoomId,
			senderId: msg.senderId,
			content: msg.content,
			type: msg.type as Message['type'],
			timestamp: msg.timestamp,
			styleData: msg.styleData,
			hasFormatting: msg.hasFormatting ?? false,
			user: msg.sender
				? {
						id: msg.sender.id,
						nickname: msg.sender.nickname,
						status: msg.sender.status as SafeUser['status'],
						avatarUrl: msg.sender.avatarUrl ?? null,
						lastSeen: null
					}
				: {
						id: msg.senderId,
						nickname: 'Unknown User',
						status: 'offline' as const,
						avatarUrl: null,
						lastSeen: null
					}
		}));
	});

	// Messages loaded via pagination (older history)
	let pagedMessages = $state<Message[]>([]);

	// Merge paginated messages with live subscription data
	const allMessages = $derived.by<EnrichedMessage[]>(() => {
		// Using object for deduplication (avoiding Map for svelte reactivity compliance)
		const merged: Record<string, EnrichedMessage> = {};
		for (const msg of pagedMessages) {
			merged[msg.id] = enrichMessage(msg);
		}
		for (const msg of messages) {
			merged[msg.id] = msg;
		}
		return Object.values(merged).sort((a, b) => a.timestamp - b.timestamp);
	});

	// Loading and error states from Convex
	const isInitialLoading = $derived(
		(defaultRoomQuery?.isLoading ?? false) ||
			(usersQuery?.isLoading ?? false) ||
			(messagesQuery?.isLoading ?? false)
	);
	const connectionError = $derived.by<string | null>(() => {
		if (defaultRoomQuery?.error) return 'Erreur de connexion au salon';
		if (usersQuery?.error) return 'Erreur de chargement des utilisateurs';
		if (messagesQuery?.error) return 'Erreur de chargement des messages';
		return null;
	});

	// Update chatState with room ID when available
	$effect(() => {
		if (roomId) {
			chatState.setCurrentRoomId(roomId);
			chatState.setConnectionStatus('connected');
		}
	});

	// ============ USER STATE ============

	const currentUser = $derived(chatState.getCurrentUser());

	// ============ WINDOW STATE ============

	let isMobile = $state(false);
	let showUserList = $state(false);

	// ============ USER LIST INTERACTIONS (AIM-style) ============

	let selectedUserId = $state<string | null>(null);
	let userMenu = $state<{ x: number; y: number; user: SafeUser } | null>(null);
	let roomPanel = $state<HTMLDivElement | null>(null);

	async function openImWith(user: SafeUser) {
		if (!currentUser || user.id === currentUser.id) return;
		try {
			const { id } = await aim.getOrCreateDirectRoom(user.id as Id<'users'>);
			desktop.openIm({
				roomId: id,
				otherUserId: user.id as Id<'users'>,
				otherNickname: user.nickname
			});
		} catch (err) {
			console.error('Failed to open IM', err);
		}
	}

	function openUserMenu(event: MouseEvent, user: SafeUser) {
		event.preventDefault();
		selectedUserId = user.id;
		const rect = roomPanel?.getBoundingClientRect();
		userMenu = {
			x: event.clientX - (rect?.left ?? 0),
			y: event.clientY - (rect?.top ?? 0),
			user
		};
	}

	function closeUserMenu() {
		userMenu = null;
	}

	function statusIcon(status: string) {
		const known: AimStatus[] = ['online', 'away', 'busy', 'idle', 'offline'];
		return `/aim/status-${known.includes(status as AimStatus) ? status : 'offline'}.svg`;
	}

	function statusLabel(user: SafeUser) {
		const label = STATUS_LABELS_FR[(user.status as AimStatus) ?? 'offline'] ?? user.status;
		if (user.status === 'away' && user.awayMessage) return `${label} : ${user.awayMessage}`;
		if (user.status === 'offline') {
			return `${label} — dernière connexion : ${formatFrenchRelativeTimeSafe(user.lastSeen)}`;
		}
		return label;
	}

	// ============ INPUT STATE ============

	let currentMessage = $state('');
	let inputScrollLeft = $state(0);
	// Initialize text style with defaults - user-specific style applied after API fetch
	let currentTextStyle = $state<TextStyle>({ ...DEFAULT_TEXT_STYLE });
	// Track if we've applied the user's style from the API/DB (to avoid repeated fetch resets)
	let hasAppliedUserStyle = $state(false);
	let lastInitialStyleJson = $state<string | null>(null);
	let styleFetchNonce = $state(0);
	let styleFetchAttempts = 0;
	let styleFetchInFlight = false;
	let lastUserId = $state<string | null>(null);

	// ============ MENTION STATE ============

	let messageInput = $state<HTMLInputElement | null>(null);
	let mentionOpen = $state(false);
	let mentionQuery = $state('');
	let mentionAnchorIndex = $state<number | null>(null);
	let mentionSelectedIndex = $state(0);
	let mentionObservedIds = $state<Set<string>>(new Set());
	let mentionMessageIds = $state<Set<string>>(new Set());
	let mentionUnreadCount = $state(0);
	let mentionDismissKey = $state<string | null>(null);
	let mentionObserver: IntersectionObserver | null = null;
	let pendingMentionTimestamp = $state<number | null>(null);

	let baseTitle = $state('');
	const mentionListBoxId = `mentions-${Math.random().toString(36).slice(2, 8)}`;
	let mentionActiveId = $state<string | null>(null);
	let chatArea = $state<HTMLDivElement | null>(null);
	let mentionListStyle = $state('');
	let mentionListInside = $state(true);
	let mentionMeasureContext: CanvasRenderingContext2D | null = null;

	// ============ RATE LIMITING STATE ============

	let cooldownEndTime = $state<number | null>(null);
	let cooldownProgress = $state(0);
	let cooldownInterval: ReturnType<typeof setInterval> | null = null;
	let rateLimitWarning = $state<string | null>(null);
	let isSendingMessage = $state(false);

	// ============ SCROLL STATE ============

	let isLoadingMore = $state(false);
	let hasMoreMessages = $state(true);
	let oldestMessageTimestamp = $state<number | null>(null);
	let lastMessageSignature = $state<string | null>(null);
	let hasInitialScrolled = $state(false);

	// ============ DERIVED STATE ============

	// Visible messages (limit for non-logged-in users)
	const visibleMessages = $derived.by<EnrichedMessage[]>(() => {
		const isLoggedIn = Boolean(currentUser);
		return isLoggedIn ? allMessages : allMessages.slice(Math.max(0, allMessages.length - 50));
	});

	// Show registration prompt for non-logged-in users
	const showRegistrationPrompt = $derived(!currentUser && allMessages.length > 50);

	// Character counter
	const CHAR_WARNING_THRESHOLD = Math.floor(MAX_MESSAGE_LENGTH * 0.8);
	const showCharCounter = $derived(currentMessage.length >= CHAR_WARNING_THRESHOLD);
	const charCounterClass = $derived(
		currentMessage.length >= MAX_MESSAGE_LENGTH
			? 'at-limit'
			: currentMessage.length >= MAX_MESSAGE_LENGTH * 0.95
				? 'near-limit'
				: 'warning'
	);

	// User counts
	const usersOnline = $derived(onlineUsers.filter((u) => u.status !== 'offline'));
	const usersOffline = $derived(onlineUsers.filter((u) => u.status === 'offline'));

	const mentionableUsers = $derived(
		onlineUsers.filter((user) => !currentUser || user.id !== currentUser.id)
	);

	// Filter users for mention autocomplete
	// Empty query (just "@") shows all users to let user browse the list
	const mentionSuggestions = $derived.by<SafeUser[]>(() => {
		if (!mentionOpen) return [];
		const query = mentionQuery.trim().toLowerCase();
		const candidates = query
			? mentionableUsers.filter((user) => user.nickname.toLowerCase().startsWith(query))
			: mentionableUsers;
		return candidates.slice(0, MAX_MENTION_SUGGESTIONS);
	});

	// Format input message with mention highlighting (for overlay display)
	const formattedInputMessage = $derived.by(() => {
		if (!currentMessage) return '';
		// Escape HTML entities first
		const escaped = currentMessage
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');
		// Apply mention styling using shared utility
		return highlightMentionsInput(escaped);
	});

	// mentionUnreadCount is managed in state updates
	const hasMentionHighlight = $derived.by<Record<string, boolean>>(() => {
		const highlights: Record<string, boolean> = {};
		if (!currentUser) return highlights;
		for (const message of visibleMessages) {
			highlights[message.id] = shouldHighlightMention(message);
		}
		return highlights;
	});

	// ============ EFFECTS ============

	// Update text style when user logs in - fetch preferences directly from API
	$effect(() => {
		const _styleFetchNonce = styleFetchNonce;
		if (_styleFetchNonce < 0) return;
		const userId = currentUser?.id ?? null;
		const defaultStyleJson = JSON.stringify(DEFAULT_TEXT_STYLE);
		const initialStyleJson = JSON.stringify(initialTextStyle ?? DEFAULT_TEXT_STYLE);

		if (initialStyleJson !== lastInitialStyleJson) {
			lastInitialStyleJson = initialStyleJson;
			currentTextStyle = {
				...DEFAULT_TEXT_STYLE,
				...(initialTextStyle ?? DEFAULT_TEXT_STYLE),
				color: (initialTextStyle?.color ?? DEFAULT_TEXT_STYLE.color) || '#000000'
			};
			if (!currentUser) {
				hasAppliedUserStyle = false;
			} else if (initialStyleJson !== defaultStyleJson) {
				hasAppliedUserStyle = true;
			}
		}

		// User changed (logged in or different user)
		if (userId !== lastUserId) {
			lastUserId = userId;
			hasAppliedUserStyle = false;
			styleFetchAttempts = 0;
			styleFetchInFlight = false;
		}

		// Fetch and apply user's saved style when they log in
		if (!currentUser || hasAppliedUserStyle || styleFetchInFlight || !browser) return;

		let isActive = true;
		const activeUserId = currentUser.id;
		const attempt = styleFetchAttempts + 1;
		styleFetchAttempts = attempt;
		styleFetchInFlight = true;
		// Fetch user preferences directly to avoid timing issues with invalidateAll
		api.textPreferences
			.get()
			.then((prefs) => {
				if (!isActive || currentUser?.id !== activeUserId) return;
				if (!prefs?.defaultStyle) return;
				currentTextStyle = {
					...DEFAULT_TEXT_STYLE,
					...prefs.defaultStyle,
					color: prefs.defaultStyle.color || '#000000'
				};
				hasAppliedUserStyle = true;
			})
			.finally(() => {
				if (!isActive || currentUser?.id !== activeUserId) return;
				if (!hasAppliedUserStyle && attempt < 3) {
					const retryDelay = Math.min(1500, 300 * attempt);
					window.setTimeout(() => {
						styleFetchInFlight = false;
						styleFetchNonce += 1;
					}, retryDelay);
					return;
				}
				styleFetchInFlight = false;
			});

		return () => {
			isActive = false;
		};
	});

	// Save text style to database when it changes (after initial load)
	let lastSavedStyleJson = $state<string | null>(null);
	$effect(() => {
		// Only save if user is logged in and style has been initialized
		if (!currentUser || !hasAppliedUserStyle || !browser) return;

		const styleJson = JSON.stringify(currentTextStyle);

		// Skip if this is the initial load (set lastSavedStyleJson to current)
		if (lastSavedStyleJson === null) {
			lastSavedStyleJson = styleJson;
			return;
		}

		// Only save if style actually changed
		if (styleJson !== lastSavedStyleJson) {
			lastSavedStyleJson = styleJson;
			debouncedSaveTextStyle(currentTextStyle);
		}
	});

	// Auto-scroll to bottom when new messages arrive
	$effect(() => {
		if (!browser || !chatArea) return;

		// Reference visibleMessages so effect re-runs when messages change
		const latestMessage = visibleMessages[visibleMessages.length - 1];
		if (!latestMessage) return;
		const firstMessage = visibleMessages[0];
		const messageSignature = `${firstMessage?.id ?? 'none'}:${latestMessage.id}:${visibleMessages.length}`;
		const hasMessageUpdate = messageSignature !== lastMessageSignature;
		lastMessageSignature = messageSignature;

		const isNearBottom = chatArea.scrollTop + chatArea.offsetHeight >= chatArea.scrollHeight - 40;

		// Scroll to bottom on initial load OR when messages update (if user was near bottom)
		if (!hasInitialScrolled || (hasMessageUpdate && isNearBottom)) {
			hasInitialScrolled = true;
			// Use rAF to ensure browser has completed layout after DOM update
			requestAnimationFrame(() => {
				if (chatArea) {
					chatArea.scrollTo(0, chatArea.scrollHeight);
				}
			});
		}
	});

	// Update oldest timestamp for pagination
	$effect(() => {
		if (allMessages.length > 0) {
			oldestMessageTimestamp = Math.min(...allMessages.map((m) => m.timestamp));
		}
	});

	$effect(() => {
		if (!browser) return;
		if (!baseTitle) baseTitle = document.title;
		const totalMentions = chatState.getMentionTotal();
		if (totalMentions > 0) {
			document.title = `(${totalMentions}) ${baseTitle}`;
		} else {
			document.title = baseTitle;
		}
	});

	$effect(() => {
		chatState.setRoomMentionCount(roomId ?? null, mentionUnreadCount);
	});

	$effect(() => {
		if (!browser || !currentUser) {
			mentionObservedIds = new SvelteSet();
			mentionMessageIds = new SvelteSet();
			if (mentionUnreadCount !== 0) {
				mentionUnreadCount = 0;
			}
			// Reset pending timestamp when user logs out
			pendingMentionTimestamp = null;
			// mention observer reset
			if (mentionObserver) {
				mentionObserver.disconnect();
				mentionObserver = null;
			}
			return;
		}
		const mentionIds = new SvelteSet<string>();
		const lastReadTimestamp = currentUser.lastReadMentionTimestamp ?? 0;
		const mentionIdsToPreObserve: string[] = [];

		for (const message of visibleMessages) {
			if (shouldHighlightMention(message)) {
				mentionIds.add(message.id);
				// Pre-mark as observed if message is older than lastReadMentionTimestamp
				if (message.timestamp <= lastReadTimestamp && !mentionObservedIds.has(message.id)) {
					mentionIdsToPreObserve.push(message.id);
				}
			}
		}
		// Batch update observed IDs to avoid repeated Set allocations
		if (mentionIdsToPreObserve.length > 0) {
			mentionObservedIds = new SvelteSet([...mentionObservedIds, ...mentionIdsToPreObserve]);
		}
		const nextMentionIds = mentionIds;
		if (!setsEqual(nextMentionIds, mentionMessageIds)) {
			mentionMessageIds = nextMentionIds;
		}
		const nextUnreadCount = Array.from(nextMentionIds).filter(
			(messageId) => !mentionObservedIds.has(messageId)
		).length;
		// mentionObservedIds is a local Set to avoid effect loops
		if (mentionUnreadCount !== nextUnreadCount) {
			mentionUnreadCount = nextUnreadCount;
		}
	});

	$effect(() => {
		const currentMentionIds = mentionMessageIds;
		if (!browser || !chatArea || !currentUser) return;
		if (mentionObserver) {
			mentionObserver.disconnect();
		}
		// Precompute message timestamp map to avoid O(n) lookup in callback
		const messageTimestampMap = new SvelteMap<string, number>();
		for (const msg of visibleMessages) {
			messageTimestampMap.set(msg.id, msg.timestamp);
		}
		mentionObserver = new IntersectionObserver(
			(entries) => {
				const updatedObserved = new SvelteSet(mentionObservedIds);
				let changed = false;
				const currentObserved = mentionObservedIds;
				const currentUnread = mentionUnreadCount;
				let maxTimestamp = pendingMentionTimestamp ?? 0;

				for (const entry of entries) {
					const target = entry.target as HTMLElement;
					const messageId = target.dataset.messageId;
					if (!messageId || !currentMentionIds.has(messageId)) continue;
					if (entry.isIntersecting && !updatedObserved.has(messageId)) {
						updatedObserved.add(messageId);
						changed = true;

						// Get timestamp from precomputed map (O(1) instead of O(n))
						const timestamp = messageTimestampMap.get(messageId);
						if (timestamp !== undefined && timestamp > maxTimestamp) {
							maxTimestamp = timestamp;
						}
					}
				}
				if (changed && !setsEqual(updatedObserved, currentObserved)) {
					mentionObservedIds = updatedObserved;
					const nextUnread = Math.max(0, currentMentionIds.size - updatedObserved.size);
					if (currentUnread !== nextUnread) {
						mentionUnreadCount = nextUnread;
					}

					// Update the server with the new max timestamp
					if (maxTimestamp > (pendingMentionTimestamp ?? 0)) {
						pendingMentionTimestamp = maxTimestamp;
						debouncedUpdateMentionTimestamp(maxTimestamp);
					}
				}
			},
			{ root: chatArea, threshold: 0.6 }
		);
		const nodes = Array.from(chatArea.querySelectorAll<HTMLElement>('[data-message-id]'));
		for (const node of nodes) {
			const messageId = node.dataset.messageId;
			if (messageId && currentMentionIds.has(messageId)) {
				mentionObserver.observe(node);
			}
		}
		// only observe mention messages
		// mention observer reset
		return () => {
			mentionObserver?.disconnect();
		};
	});

	$effect(() => {
		if (!mentionOpen || mentionSuggestions.length === 0) {
			if (mentionActiveId !== null) {
				mentionActiveId = null;
			}
			return;
		}
		const currentActiveId = mentionActiveId;
		let selectedIndex = mentionSelectedIndex;
		if (selectedIndex >= mentionSuggestions.length) {
			selectedIndex = 0;
			if (mentionSelectedIndex !== 0) {
				mentionSelectedIndex = 0;
			}
		}
		const active = mentionSuggestions[selectedIndex];
		const nextActiveId = active ? getMentionListItemId(active.id) : null;
		if (currentActiveId !== nextActiveId) {
			mentionActiveId = nextActiveId;
		}
	});

	$effect(() => {
		if (!mentionOpen || !messageInput) {
			if (mentionListStyle) mentionListStyle = '';
			return;
		}
		const currentListStyle = mentionListStyle;
		const currentInside = mentionListInside;
		const inputRect = messageInput.getBoundingClientRect();
		const containerRect = messageInput.closest('.chat-container')?.getBoundingClientRect();
		// Use shared utility for height calculation
		const listHeight = calculatePickerHeight(mentionSuggestions.length);
		const spaceBelow = containerRect
			? containerRect.bottom - inputRect.bottom
			: window.innerHeight - inputRect.bottom;
		const spaceAbove = containerRect ? inputRect.top - containerRect.top : inputRect.top;
		const showAbove = spaceBelow < listHeight && spaceAbove > listHeight;
		const maxNameWidth = mentionSuggestions.reduce((max, user) => {
			const width = measureMentionText(user.nickname, true, 13.6);
			return Math.max(max, width);
		}, 0);
		// Status uses 0.7rem (11.2px) font size and uppercase (add ~10% for letter-spacing)
		const statusWidth = measureMentionText('OFFLINE', false, 11.2) * 1.1;
		// Use shared utility for width calculation
		const listWidth = calculatePickerWidth(maxNameWidth, statusWidth);
		if (containerRect) {
			if (!currentInside) mentionListInside = true;
			const top = showAbove
				? inputRect.top - containerRect.top - listHeight - MENTION_PICKER.OFFSET_GAP
				: inputRect.bottom - containerRect.top + MENTION_PICKER.OFFSET_GAP;
			const left = inputRect.left - containerRect.left;
			const nextStyle = `top: ${Math.max(MENTION_PICKER.EDGE_MARGIN, top)}px; left: ${Math.max(MENTION_PICKER.EDGE_MARGIN, left)}px; width: ${listWidth}px;`;
			if (currentListStyle !== nextStyle) {
				mentionListStyle = nextStyle;
			}
		} else {
			if (currentInside) mentionListInside = false;
			const top = showAbove
				? inputRect.top - listHeight - MENTION_PICKER.OFFSET_GAP
				: inputRect.bottom + MENTION_PICKER.OFFSET_GAP;
			const nextStyle = `top: ${Math.max(MENTION_PICKER.EDGE_MARGIN, top)}px; left: ${Math.max(MENTION_PICKER.EDGE_MARGIN, inputRect.left)}px; width: ${listWidth}px;`;
			if (currentListStyle !== nextStyle) {
				mentionListStyle = nextStyle;
			}
		}
		if (mentionSuggestions.length === 0 && mentionActiveId !== null) {
			mentionActiveId = null;
		}
		if (mentionSelectedIndex >= mentionSuggestions.length && mentionSuggestions.length > 0) {
			mentionSelectedIndex = 0;
		}
	});

	// ============ HELPERS ============

	function resolveUser(senderId: string): SafeUser {
		const knownUser = onlineUsers.find((user) => user.id === senderId);
		if (knownUser) return knownUser;
		return {
			id: senderId,
			nickname: 'Unknown User',
			status: 'offline',
			avatarUrl: null,
			lastSeen: null
		};
	}

	function enrichMessage(message: Message): EnrichedMessage {
		return {
			...message,
			user: resolveUser(message.senderId)
		};
	}

	function mergePagedMessages(incoming: Message[]) {
		if (incoming.length === 0) return;
		const existingIds = new Set(pagedMessages.map((message) => message.id));
		const newMessages = incoming.filter((message) => !existingIds.has(message.id));
		if (newMessages.length === 0) return;
		pagedMessages = [...pagedMessages, ...newMessages];
	}

	// Debounced function to update the server with last read mention timestamp
	const debouncedUpdateMentionTimestamp = debounce(async (timestamp: number) => {
		if (!currentUser || !browser) return;
		await api.mentions.markRead(timestamp);
	}, 1000);

	// Debounced function to save text style preferences to the database
	const debouncedSaveTextStyle = debounce(async (style: TextStyle) => {
		if (!currentUser || !browser) return;
		await api.textPreferences.save({
			defaultStyle: style,
			allowFormatting: true,
			maxMessageLength: MAX_MESSAGE_LENGTH
		});
	}, 1500);

	function setsEqual(a: Set<string>, b: Set<string>) {
		if (a.size !== b.size) return false;
		for (const value of a) {
			if (!b.has(value)) return false;
		}
		return true;
	}

	function measureMentionText(text: string, bold: boolean = true, fontSizePx: number = 13.6) {
		if (!mentionMeasureContext) {
			const canvas = document.createElement('canvas');
			mentionMeasureContext = canvas.getContext('2d');
		}
		if (!mentionMeasureContext) return 0;
		mentionMeasureContext.font = `${bold ? 'bold ' : ''}${fontSizePx}px 'Pixelated MS Sans Serif', Tahoma, sans-serif`;
		return mentionMeasureContext.measureText(text).width;
	}

	function updateMentionState(input: HTMLInputElement) {
		if (!currentUser) {
			mentionOpen = false;
			return;
		}
		const cursorIndex = input.selectionStart ?? input.value.length;
		const context = findMentionContext(input.value, cursorIndex);
		if (!context) {
			closeMentionPicker();
			return;
		}
		const mentionKey = `${context.atIndex}:${context.query}`;
		if (mentionDismissKey === mentionKey) {
			return;
		}
		const wasOpen = mentionOpen;
		const previousQuery = mentionQuery;
		const sameAnchor = mentionAnchorIndex === context.atIndex;
		mentionOpen = true;
		mentionQuery = context.query;
		mentionAnchorIndex = context.atIndex;
		mentionDismissKey = null;
		if (!wasOpen || !sameAnchor || previousQuery !== context.query) {
			mentionSelectedIndex = 0;
		}
	}

	function registerMentionNode(node: HTMLElement) {
		if (!node) return;
		const messageId = node.dataset.messageId;
		if (!messageId) return;
		if (mentionObserver) {
			mentionObserver.observe(node);
		}
		// Return destroy method to properly cleanup when node is removed
		return {
			destroy() {
				if (mentionObserver) {
					mentionObserver.unobserve(node);
				}
			}
		};
	}

	function closeMentionPicker() {
		mentionOpen = false;
		mentionQuery = '';
		mentionAnchorIndex = null;
		mentionSelectedIndex = 0;
		mentionActiveId = null;
		mentionDismissKey = null;
		if (messageInput) {
			messageInput.focus();
		}
	}

	function clampMentionIndex(nextIndex: number) {
		if (mentionSuggestions.length === 0) return 0;
		const maxIndex = mentionSuggestions.length - 1;
		if (nextIndex < 0) return maxIndex;
		if (nextIndex > maxIndex) return 0;
		return nextIndex;
	}

	function applyMentionSelection(user: SafeUser) {
		if (!messageInput || mentionAnchorIndex === null) return;
		const selectionStart = messageInput.selectionStart ?? currentMessage.length;
		const before = currentMessage.slice(0, mentionAnchorIndex);
		const after = currentMessage.slice(selectionStart);
		const mentionText = `@${user.nickname} `;
		currentMessage = `${before}${mentionText}${after}`;
		void tick().then(() => {
			if (!messageInput) return;
			const cursor = before.length + mentionText.length;
			messageInput.focus();
			messageInput.setSelectionRange(cursor, cursor);
		});
		closeMentionPicker();
	}

	function handleMentionKeydown(event: KeyboardEvent) {
		if (!mentionOpen || mentionSuggestions.length === 0) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			mentionSelectedIndex = clampMentionIndex(mentionSelectedIndex + 1);
			void tick().then(() => scrollMentionOptionIntoView());
			return;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			mentionSelectedIndex = clampMentionIndex(mentionSelectedIndex - 1);
			void tick().then(() => scrollMentionOptionIntoView());
			return;
		}
		if (event.key === 'Enter' || event.key === 'Tab') {
			event.preventDefault();
			const choice = mentionSuggestions[mentionSelectedIndex];
			if (choice) applyMentionSelection(choice);
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			if (mentionOpen && mentionAnchorIndex !== null) {
				mentionDismissKey = `${mentionAnchorIndex}:${mentionQuery}`;
			}
			closeMentionPicker();
		}
	}

	function getMentionListItemId(userId: string) {
		return `${mentionListBoxId}-${userId}`;
	}

	function scrollMentionOptionIntoView() {
		if (!mentionActiveId) return;
		const option = document.getElementById(mentionActiveId);
		option?.scrollIntoView({ block: 'nearest' });
	}

	function updateCooldownProgress() {
		if (!cooldownEndTime) return;
		const now = Date.now();
		if (now >= cooldownEndTime) {
			cooldownEndTime = null;
			cooldownProgress = 0;
			rateLimitWarning = null;
			if (cooldownInterval) {
				clearInterval(cooldownInterval);
				cooldownInterval = null;
			}
			return;
		}
		cooldownProgress = (cooldownEndTime - now) / 1000;
	}

	function startCooldownTimer(retryAfter: number) {
		cooldownEndTime = Date.now() + retryAfter;
		if (cooldownInterval) clearInterval(cooldownInterval);
		cooldownInterval = setInterval(updateCooldownProgress, 100);
		updateCooldownProgress();
	}

	// ============ HANDLERS ============

	function shouldHighlightMention(message: EnrichedMessage) {
		if (!currentUser) return false;
		if (message.senderId === currentUser.id) return false;
		return containsMention(message.content, currentUser.nickname);
	}

	function handleInputChange(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.value.length > MAX_MESSAGE_LENGTH) {
			input.value = input.value.slice(0, MAX_MESSAGE_LENGTH);
			currentMessage = input.value;
		}
		inputScrollLeft = input.scrollLeft;
		updateMentionState(input);
		if (!mentionOpen && mentionQuery) {
			mentionQuery = '';
		}
	}

	function handleInputScroll(e: Event) {
		inputScrollLeft = (e.target as HTMLInputElement).scrollLeft;
	}

	function handleInputFocus() {
		if (!messageInput) return;
		updateMentionState(messageInput);
	}

	function handleInputClick() {
		if (!messageInput) return;
		updateMentionState(messageInput);
	}

	function handleInputKeydown(event: KeyboardEvent) {
		if (!messageInput) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			if (mentionOpen && mentionAnchorIndex !== null) {
				mentionDismissKey = `${mentionAnchorIndex}:${mentionQuery}`;
			}
			closeMentionPicker();
			return;
		}
		if (mentionOpen) {
			handleMentionKeydown(event);
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			void handleSubmit();
		}
	}

	function handleInputKeyup() {
		if (!messageInput) return;
		updateMentionState(messageInput);
	}

	async function handleSubmit() {
		if (!currentMessage.trim() || !currentUser || cooldownEndTime) return;

		isSendingMessage = true;
		try {
			const result = await api.chat.sendMessage({
				content: currentMessage,
				type: 'chat',
				userId: currentUser.id,
				chatRoomId: roomId,
				styleData: currentTextStyle ? JSON.stringify(currentTextStyle) : undefined
			});

			if (!result.success && result.isRateLimited && result.retryAfter) {
				startCooldownTimer(result.retryAfter);
				rateLimitWarning = "Whoa there! You're sending messages too quickly. Take a breather...";
			} else if (!result.success) {
				rateLimitWarning = result.error || 'Failed to send message. Please try again.';
				setTimeout(() => (rateLimitWarning = null), 3000);
			} else {
				currentMessage = '';
				rateLimitWarning = null;
			}
		} catch (error) {
			console.error('Failed to send message:', error);
			rateLimitWarning = 'Failed to send message. Please try again.';
			setTimeout(() => (rateLimitWarning = null), 3000);
		} finally {
			isSendingMessage = false;
		}
	}

	async function handleScroll(event: Event) {
		const target = event.target as HTMLElement;
		const { scrollTop } = target;

		if (
			scrollTop < 100 &&
			!isLoadingMore &&
			hasMoreMessages &&
			roomId &&
			chatArea &&
			currentUser &&
			convexClient
		) {
			isLoadingMore = true;
			const prevScrollHeight = chatArea.scrollHeight;
			const prevScrollTop = chatArea.scrollTop;

			try {
				const fetchLimit = currentUser ? 100 : 50;
				const data = await convexClient.query(convexApi.queries.getMessagesPublicPage, {
					roomId,
					limit: fetchLimit,
					beforeTimestamp: oldestMessageTimestamp ?? undefined
				});

				if (data.messages.length === 0) {
					hasMoreMessages = false;
				} else {
					const fetchedMessages = data.messages as Message[];
					mergePagedMessages(fetchedMessages);

					requestAnimationFrame(() => {
						if (!chatArea) return;
						const newScrollHeight = chatArea.scrollHeight;
						const heightDifference = newScrollHeight - prevScrollHeight;
						chatArea.scrollTop = prevScrollTop + heightDifference;
					});

					const newOldest = Math.min(...fetchedMessages.map((m) => m.timestamp));
					oldestMessageTimestamp = oldestMessageTimestamp
						? Math.min(oldestMessageTimestamp, newOldest)
						: newOldest;
					hasMoreMessages = data.hasMore;
				}
			} catch (error) {
				console.error('Error loading more messages:', error);
				hasMoreMessages = false;
			} finally {
				isLoadingMore = false;
			}
		}
	}

	function openSignup() {
		desktop.openLogin('signup');
	}

	// ============ LIFECYCLE ============

	onMount(() => {
		if (!browser) return;

		isMobile = window.innerWidth <= 768;
		const handleResize = () => {
			isMobile = window.innerWidth <= 768;
		};
		window.addEventListener('resize', handleResize);

		const onGlobalClick = () => closeUserMenu();
		const onGlobalKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') closeUserMenu();
		};
		window.addEventListener('click', onGlobalClick);
		window.addEventListener('keydown', onGlobalKey);

		return () => {
			window.removeEventListener('resize', handleResize);
			window.removeEventListener('click', onGlobalClick);
			window.removeEventListener('keydown', onGlobalKey);
			if (cooldownInterval) clearInterval(cooldownInterval);
			// Clean up canvas context used for text measurement
			mentionMeasureContext = null;
		};
	});

	// Scroll selected mention option into view when selection changes
	$effect(() => {
		if (!mentionOpen || mentionSuggestions.length === 0) return;
		// Track mentionSelectedIndex to trigger scroll on keyboard navigation
		void mentionSelectedIndex;
		void tick().then(() => scrollMentionOptionIntoView());
	});
</script>

<XpWindow
	id={windowId}
	width={800}
	height={600}
	minWidth={420}
	minHeight={420}
	showMaximize
	bodyClass="chat-room-body"
>
	{#snippet menu()}
		<button type="button" onclick={() => desktop.openBuddyList()}>Contacts</button>
		<button type="button" onclick={() => desktop.openNewRoom()}>Nouveau salon</button>
		<button type="button" onclick={() => (showUserList = !showUserList)}>
			{showUserList || !isMobile ? 'Participants' : 'Participants'}
		</button>
		{#if !currentUser}
			<button type="button" onclick={() => desktop.openLogin('signin')}>Se connecter</button>
		{/if}
	{/snippet}

	<div class="room-header">
		<img src="/aim/chat-room.svg" alt="" width="16" height="16" />
		<span class="room-name">{roomName}</span>
		{#if roomTopic}
			<span class="room-topic">— {roomTopic}</span>
		{/if}
		<span class="room-count">{usersOnline.length} en ligne</span>
		{#if mentionUnreadCount > 0}
			<span class="room-mentions"
				>({mentionUnreadCount} mention{mentionUnreadCount > 1 ? 's' : ''})</span
			>
		{/if}
		{#if connectionError}
			<span class="connection-error">⚠️ {connectionError}</span>
		{/if}
	</div>

	<div class="room-panel" bind:this={roomPanel}>
		<div class="chat-container">
			{#if rateLimitWarning}
				<div class="rate-limit-warning" class:with-progress={cooldownEndTime}>
					<span>{rateLimitWarning}</span>
					{#if cooldownEndTime}
						<small>Vous pourrez envoyer un autre message dans {cooldownProgress.toFixed(1)}s</small>
					{/if}
				</div>
			{/if}

			<div
				class="sunken-panel chat-area"
				style="flex: 1; margin-bottom: 0.5rem; padding: 0.5rem; overflow-y: auto;"
				onscroll={(e) => handleScroll(e)}
				bind:this={chatArea}
			>
				{#if isInitialLoading}
					<div class="initial-loading">
						<LoadingDots text="Chargement des messages" />
					</div>
				{:else if isLoadingMore}
					<div class="loading-messages">
						<LoadingDots text="Chargement" />
					</div>
				{/if}
				{#if showRegistrationPrompt}
					<div class="registration-prompt">
						<p>
							👋 <button class="link-button" onclick={openSignup}>Inscris-toi</button>pour lire le
							reste du chat !
						</p>
					</div>
				{/if}
				{#each visibleMessages as message (message.id)}
					<div
						class="message {message.type} text"
						class:mention-highlight={hasMentionHighlight[message.id]}
						data-message-id={message.id}
						data-mention={hasMentionHighlight[message.id]
							? `Mention de @${currentUser?.nickname ?? ''}`
							: undefined}
						aria-label={hasMentionHighlight[message.id]
							? `Message mentionnant ${currentUser?.nickname ?? ''}`
							: undefined}
						use:registerMentionNode
					>
						{#if message.type === 'emote'}
							<span class="emote-text">
								<Tooltip
									data={{
										text: formatFrenchDateTime(new Date(message.timestamp)),
										direction: 'left',
										closeDelay: 1000,
										touchBehavior: 'remove',
										interactive: false
									}}
								>
									<span class="nickname pointer-events-none">{message.user.nickname}</span>
								</Tooltip>
								{message.content}
							</span>
						{:else}
							<Tooltip
								data={{
									text: formatFrenchDateTime(new Date(message.timestamp)),
									direction: 'left',
									closeDelay: 1000,
									touchBehavior: 'remove',
									interactive: false
								}}
							>
								<span class="nickname pointer-events-none">{message.user.nickname}:</span>
							</Tooltip>
							<span class="message-content">
								<FormattedMessage {message} allowFormatting={true} />
							</span>
						{/if}
					</div>
				{/each}
			</div>

			<!-- Text Formatting Toolbar -->
			{#if currentUser}
				<div style="margin-bottom: 0.25rem;">
					<TextFormattingToolbar
						bind:style={currentTextStyle}
						compact={true}
						showFontSelector={true}
					/>
				</div>
			{/if}

			<div class="field-row input-container" style="margin: 0; position: relative;">
				{#if currentTextStyle.gradient && currentTextStyle.gradient.length > 1}
					<div
						class="gradient-input-wrapper"
						style="flex: 1; position: relative; background: white; overflow: hidden;"
					>
						<!-- Gradient text overlay that syncs with input scroll -->
						<span
							class="gradient-text-overlay retro-font-{currentTextStyle.fontFamily}"
							style="
										position: absolute;
										left: 3px;
										top: 50%;
										transform: translateY(-50%) translateX(-{inputScrollLeft}px);
										pointer-events: none;
										white-space: nowrap;
										font-size: {currentTextStyle.fontSize}px;
										{currentTextStyle.bold
								? currentTextStyle.fontFamily === 'tahoma'
									? 'font-weight: 200;'
									: 'font-weight: 700;'
								: ''}
										{currentTextStyle.italic ? 'font-style: italic;' : ''}
										{currentTextStyle.underline || currentTextStyle.strikethrough
								? `text-decoration: ${[currentTextStyle.underline ? 'underline' : '', currentTextStyle.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ')};`
								: ''}
										background: linear-gradient(to right, {currentTextStyle.gradient.join(', ')});
										-webkit-background-clip: text;
										-webkit-text-fill-color: transparent;
										background-clip: text;
									"
							aria-hidden="true"
						>
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- formattedInputMessage is sanitized by highlightMentionsInput -->
							{@html formattedInputMessage}
						</span>
						<input
							type="text"
							bind:value={currentMessage}
							maxlength={MAX_MESSAGE_LENGTH}
							class="styled-input retro-font-{currentTextStyle.fontFamily}"
							style="width: 100%; background: transparent; color: transparent; caret-color: black; font-size: {currentTextStyle.fontSize}px; padding-left: 3px; {currentTextStyle.bold
								? currentTextStyle.fontFamily === 'tahoma'
									? 'font-weight: 200;'
									: 'font-weight: 700;'
								: ''} {currentTextStyle.italic
								? 'font-style: italic;'
								: ''} {currentTextStyle.underline || currentTextStyle.strikethrough
								? `text-decoration: ${[currentTextStyle.underline ? 'underline' : '', currentTextStyle.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ')};`
								: ''}"
							onkeydown={handleInputKeydown}
							onkeyup={handleInputKeyup}
							oninput={handleInputChange}
							onscroll={handleInputScroll}
							onfocus={handleInputFocus}
							onclick={handleInputClick}
							bind:this={messageInput}
							placeholder={!currentUser
								? 'Inscris-toi pour participer.'
								: cooldownEndTime
									? `Patientez ${cooldownProgress.toFixed(1)}s...`
									: 'Écrivez un message...'}
							disabled={!currentUser || Boolean(cooldownEndTime)}
							role="combobox"
							aria-autocomplete="list"
							aria-controls={mentionOpen ? mentionListBoxId : undefined}
							aria-expanded={mentionOpen}
						/>
					</div>
				{:else}
					<div
						class="mention-input-wrapper"
						style="flex: 1; position: relative; background: white; overflow: hidden;"
					>
						<!-- Text overlay with mention highlighting -->
						<span
							class="mention-text-overlay retro-font-{currentTextStyle.fontFamily}"
							style="
										position: absolute;
										left: 3px;
										top: 50%;
										transform: translateY(-50%) translateX(-{inputScrollLeft}px);
										pointer-events: none;
										white-space: nowrap;
										font-size: {currentTextStyle.fontSize}px;
										color: {currentTextStyle.color || '#000000'};
										{currentTextStyle.bold
								? currentTextStyle.fontFamily === 'tahoma'
									? 'font-weight: 200;'
									: 'font-weight: 700;'
								: ''}
										{currentTextStyle.italic ? 'font-style: italic;' : ''}
										{currentTextStyle.underline || currentTextStyle.strikethrough
								? `text-decoration: ${[currentTextStyle.underline ? 'underline' : '', currentTextStyle.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ')};`
								: ''}
									"
							aria-hidden="true"
						>
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- formattedInputMessage is sanitized by highlightMentionsInput -->
							{@html formattedInputMessage}
						</span>
						<input
							type="text"
							bind:value={currentMessage}
							maxlength={MAX_MESSAGE_LENGTH}
							class="styled-input mention-overlay-input retro-font-{currentTextStyle.fontFamily}"
							style="width: 100%; background: transparent; color: transparent; font-size: {currentTextStyle.fontSize}px; padding-left: 3px; {currentTextStyle.bold
								? currentTextStyle.fontFamily === 'tahoma'
									? 'font-weight: 200;'
									: 'font-weight: 700;'
								: ''} {currentTextStyle.italic
								? 'font-style: italic;'
								: ''} {currentTextStyle.underline || currentTextStyle.strikethrough
								? `text-decoration: ${[currentTextStyle.underline ? 'underline' : '', currentTextStyle.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ')};`
								: ''} caret-color: {currentTextStyle.color || 'black'};"
							onkeydown={handleInputKeydown}
							onkeyup={handleInputKeyup}
							oninput={handleInputChange}
							onscroll={handleInputScroll}
							onfocus={handleInputFocus}
							onclick={handleInputClick}
							bind:this={messageInput}
							placeholder={!currentUser
								? 'Inscris-toi pour participer.'
								: cooldownEndTime
									? `Patientez ${cooldownProgress.toFixed(1)}s...`
									: 'Écrivez un message...'}
							disabled={!currentUser || Boolean(cooldownEndTime)}
							role="combobox"
							aria-autocomplete="list"
							aria-controls={mentionOpen ? mentionListBoxId : undefined}
							aria-expanded={mentionOpen}
						/>
					</div>
				{/if}
				<LoadingButton
					onclick={handleSubmit}
					disabled={!currentUser || Boolean(cooldownEndTime)}
					loading={isSendingMessage}
					text={cooldownEndTime ? `${cooldownProgress.toFixed(1)}s` : 'Envoyer'}
				/>
				{#if showCharCounter}
					<span class="char-counter {charCounterClass}">
						{currentMessage.length}/{MAX_MESSAGE_LENGTH}
					</span>
				{/if}
			</div>
			{#if mentionOpen}
				<MentionPicker
					suggestions={mentionSuggestions}
					selectedIndex={mentionSelectedIndex}
					activeId={mentionActiveId}
					listBoxId={mentionListBoxId}
					listStyle={mentionListStyle}
					isPortal={!mentionListInside}
					onSelect={applyMentionSelection}
				/>
			{/if}

			{#if cooldownEndTime}
				<div
					class="cooldown-progress"
					style="width: {100 - ((cooldownProgress * 100) / (cooldownEndTime - Date.now())) * 1000}%"
				></div>
			{/if}
		</div>

		<!-- Participants (AIM chat room people list) -->
		<div
			class="sunken-panel users-list"
			class:mobile={isMobile}
			class:hidden={isMobile && !showUserList}
		>
			<p class="section-header">Participants ({usersOnline.length})</p>
			{#each usersOnline as user (user.id)}
				<div
					class="user {user.status}"
					class:selected={selectedUserId === user.id}
					class:me={currentUser?.id === user.id}
					role="button"
					tabindex="0"
					title={statusLabel(user)}
					onclick={(e) => {
						e.stopPropagation();
						selectedUserId = user.id;
						closeUserMenu();
					}}
					ondblclick={() => openImWith(user)}
					oncontextmenu={(e) => openUserMenu(e, user)}
					onkeydown={(e) => {
						if (e.key === 'Enter') openImWith(user);
					}}
				>
					<span
						class="buddy-tile"
						style="background: {getBuddyIcon(user.buddyIcon).bg}"
						aria-hidden="true">{getBuddyIcon(user.buddyIcon).emoji}</span
					>
					<img class="status-icon" src={statusIcon(user.status)} alt="" width="12" height="12" />
					<span class="nickname">{user.nickname}</span>
				</div>
			{/each}

			{#if usersOffline.length > 0}
				<div class="section-separator"></div>
				<p class="section-header offline-header">Hors ligne ({usersOffline.length})</p>
				{#each usersOffline as user (user.id)}
					<div
						class="user offline"
						class:selected={selectedUserId === user.id}
						role="button"
						tabindex="0"
						title={statusLabel(user)}
						onclick={(e) => {
							e.stopPropagation();
							selectedUserId = user.id;
							closeUserMenu();
						}}
						ondblclick={() => openImWith(user)}
						oncontextmenu={(e) => openUserMenu(e, user)}
						onkeydown={(e) => {
							if (e.key === 'Enter') openImWith(user);
						}}
					>
						<img class="status-icon" src={statusIcon('offline')} alt="" width="12" height="12" />
						<span class="nickname">{user.nickname}</span>
					</div>
				{/each}
			{/if}
		</div>

		{#if userMenu}
			<div
				class="user-menu"
				style="left: {userMenu.x}px; top: {userMenu.y}px;"
				role="menu"
				tabindex="-1"
				onclick={(e) => e.stopPropagation()}
				onkeydown={(e) => {
					if (e.key === 'Escape') closeUserMenu();
				}}
			>
				<div class="user-menu-title">{userMenu.user.nickname}</div>
				{#if currentUser && userMenu.user.id !== currentUser.id}
					<button
						type="button"
						role="menuitem"
						onclick={() => {
							const u = userMenu?.user;
							closeUserMenu();
							if (u) void openImWith(u);
						}}>Envoyer un message instantané</button
					>
					<button
						type="button"
						role="menuitem"
						onclick={() => {
							const u = userMenu?.user;
							closeUserMenu();
							if (u) void aim.addBuddy(u.id as Id<'users'>).catch(console.error);
						}}>Ajouter à ma liste de contacts</button
					>
				{/if}
				<button
					type="button"
					role="menuitem"
					onclick={() => {
						const u = userMenu?.user;
						closeUserMenu();
						if (u) desktop.openProfile({ userId: u.id as Id<'users'>, nickname: u.nickname });
					}}>Infos sur {userMenu.user.nickname}</button
				>
			</div>
		{/if}
	</div>
</XpWindow>

<style>
	.chat-area,
	.users-list {
		font-size: 1rem;
		font-family: Arial, 'Pixelated MS Sans Serif', Verdana, Tahoma, sans-serif;
	}

	input:not(.styled-input) {
		font-size: 1rem;
		font-family: 'Pixelated MS Sans Serif', Arial, Verdana, Tahoma, sans-serif;
	}

	/* ===== Layout inside the XP window ===== */
	.room-header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 3px 6px;
		margin-bottom: 4px;
		background: linear-gradient(180deg, #fff3a6 0%, #f6c700 100%);
		border: 1px solid #c99a00;
		font-family: Tahoma, 'Pixelated MS Sans Serif', sans-serif;
		font-size: 11px;
		flex: 0 0 auto;
		min-width: 0;
	}

	.room-name {
		font-weight: bold;
	}

	.room-topic {
		color: #5a4a00;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
		flex: 1;
	}

	.room-count {
		margin-left: auto;
		color: #5a4a00;
		white-space: nowrap;
	}

	.room-mentions {
		font-weight: bold;
		color: #c00000;
		white-space: nowrap;
	}

	.room-panel {
		position: relative;
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		gap: 6px;
	}

	.chat-container {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.users-list {
		width: 10.5rem;
		flex: 0 0 auto;
		padding: 0.4rem;
		overflow-y: auto;
		font-size: 0.85rem;
	}

	.user {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 1px 3px;
		cursor: pointer;
		border: 1px dotted transparent;
		user-select: none;
	}

	.user:hover {
		background: #e8eefb;
	}

	.user.selected {
		background: #316ac5;
		color: #fff;
		border-color: #fff;
	}

	.user.me .nickname {
		font-weight: bold;
	}

	.user.away .nickname,
	.user.idle .nickname {
		color: #777;
		font-style: italic;
	}

	.user.selected .nickname {
		color: #fff;
	}

	.buddy-tile {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		font-size: 11px;
		border: 1px solid rgba(0, 0, 0, 0.25);
		border-radius: 2px;
		flex: 0 0 16px;
	}

	.status-icon {
		flex: 0 0 12px;
	}

	.user-menu {
		position: absolute;
		z-index: 50;
		min-width: 200px;
		background: #fff;
		border: 1px solid #aca899;
		box-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
		padding: 2px;
		font-family: Tahoma, 'Pixelated MS Sans Serif', sans-serif;
		font-size: 11px;
		display: flex;
		flex-direction: column;
	}

	.user-menu-title {
		font-weight: bold;
		padding: 3px 20px;
		border-bottom: 1px solid #aca899;
		margin-bottom: 2px;
		color: #444;
	}

	.user-menu button {
		text-align: left;
		background: transparent;
		border: none;
		box-shadow: none;
		border-radius: 0;
		padding: 3px 20px;
		min-width: 0;
		font-size: 11px;
	}

	.user-menu button:hover {
		background: #316ac5;
		color: #fff;
	}

	.chat-area {
		line-height: 1.4;
	}

	.message {
		margin-bottom: 0.25rem;
		word-break: break-word;
		line-height: 1.4;
	}

	.message :global(.gradient-text-static) {
		display: inline;
		vertical-align: baseline;
		line-height: inherit;
	}

	.message :global(.gradient-char) {
		display: inline;
		vertical-align: baseline;
		line-height: inherit;
	}

	.message .nickname {
		display: inline;
		font-weight: bold;
		color: #2d31a6;
		cursor: help;
		margin-right: 0.25rem;
		vertical-align: baseline;
	}

	.message-content {
		display: inline;
		vertical-align: baseline;
	}

	.message-content :global(.formatted-message),
	.message-content :global(.gradient-text-static) {
		display: inline;
		vertical-align: baseline;
	}

	.message.emote {
		color: #666;
		font-style: italic;
	}

	.message.emote .nickname {
		color: #666;
	}

	.message-content :global(.mention-token) {
		color: inherit;
		font-weight: bold;
	}

	/* Input mention highlighting */
	.mention-input-wrapper,
	.gradient-input-wrapper {
		flex: 1;
		position: relative;
		background: white;
		overflow: hidden;
	}

	.mention-text-overlay,
	.gradient-text-overlay {
		position: absolute;
		left: 3px;
		top: 50%;
		pointer-events: none;
		white-space: nowrap;
	}

	.mention-text-overlay :global(.input-mention),
	.gradient-text-overlay :global(.input-mention) {
		color: #1e2a72;
		-webkit-text-fill-color: #1e2a72;
	}

	/* Force input text to be transparent when using overlay */
	.mention-overlay-input {
		color: transparent !important;
		-webkit-text-fill-color: transparent !important;
	}

	.section-header {
		margin: 0 0 0.25rem 0;
		font-weight: bold;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-muted-foreground);
	}

	.offline-header {
		opacity: 0.7;
	}

	.section-separator {
		border-top: 1px solid var(--color-border);
		margin: 0.5rem 0;
	}

	.user.offline {
		color: var(--color-muted-foreground);
		font-style: italic;
	}

	.sunken-panel {
		background: white;
		border: 0.125rem inset #dfdfdf;
	}

	input[type='text'] {
		font-size: 1rem;
		margin-right: 0.25rem;
	}

	.styled-input {
		font-style: inherit;
	}

	button {
		font-size: 1rem;
	}

	.chat-container {
		position: relative;
		z-index: 1;
	}

	.input-container {
		position: relative;
		z-index: 2;
	}

	.input-container input:disabled {
		opacity: 0.7;
		background-color: rgba(128, 128, 128, 0.3) !important;
		cursor: not-allowed;
	}

	/* Fade input wrapper when disabled */
	.input-container:has(input:disabled) .gradient-input-wrapper,
	.input-container:has(input:disabled) .mention-input-wrapper {
		opacity: 0.6;
		background-color: #f0f0f0 !important;
	}

	.hidden {
		display: none !important;
	}

	@media (max-width: 768px) {
		.room-panel {
			flex-direction: column;
		}

		.users-list.mobile {
			width: 100%;
			max-height: 30vh;
		}
	}

	.relative-time {
		color: #666;
		font-size: 0.75rem;
		margin-right: 0.5rem;
		font-style: italic;
	}

	.cooldown-progress {
		position: absolute;
		bottom: 0;
		left: 0;
		height: 2px;
		background: #2d31a6;
		transition: width 0.1s linear;
	}

	.input-container {
		position: relative;
	}

	.char-counter {
		font-size: 0.75rem;
		padding: 0 0.25rem;
		margin-left: 0.25rem;
		white-space: nowrap;
		font-family: 'Pixelated MS Sans Serif', Tahoma, sans-serif;
	}

	.char-counter.warning {
		color: var(--color-muted-foreground);
	}

	.char-counter.near-limit {
		color: var(--color-warning);
		font-weight: bold;
	}

	.char-counter.at-limit {
		color: var(--color-destructive);
		font-weight: bold;
	}

	.connection-error {
		font-size: 0.75rem;
		color: #ff4444;
		margin-left: 0.5rem;
	}

	.error-banner {
		position: absolute;
		top: 2rem;
		left: 0;
		right: 0;
		background: #ffebee;
		color: #c62828;
		padding: 0.5rem;
		text-align: center;
		z-index: 100;
		border-bottom: 1px solid #ffcdd2;
		font-size: 0.875rem;
	}

	.rate-limit-warning {
		background: #fff3e0;
		color: #e65100;
		padding: 0.5rem;
		margin-bottom: 0.5rem;
		border-radius: 4px;
		font-size: 0.875rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		animation: slideIn 0.3s ease-out;
		border: 1px solid #ffe0b2;
	}

	.rate-limit-warning.with-progress {
		border-left: 4px solid #e65100;
	}

	.rate-limit-warning small {
		color: #666;
		font-size: 0.75rem;
	}

	@keyframes slideIn {
		from {
			transform: translateY(-100%);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	.message.mention-highlight {
		background: rgba(255, 237, 186, 0.45);
		border-radius: 4px;
		padding: 0.2rem 0.35rem;
		box-shadow: inset 0 0 0 1px rgba(178, 136, 0, 0.2);
	}

	.cooldown-progress {
		position: absolute;
		bottom: 0;
		left: 0;
		height: 2px;
		background: #e65100;
		transition: width 0.1s linear;
	}

	.initial-loading {
		display: flex;
		justify-content: center;
		align-items: center;
		height: 100%;
		font-size: 1.1rem;
		color: #666;
	}

	.loading-messages {
		text-align: center;
		padding: 1rem;
		color: #666;
		font-style: italic;
		background: rgba(0, 0, 0, 0.05);
		margin-bottom: 1rem;
		border-radius: 4px;
	}

	.registration-prompt {
		background: #fff3e0;
		color: #e65100;
		padding: 1rem;
		margin-bottom: 1rem;
		border-radius: 4px;
		text-align: center;
		font-size: 0.95rem;
		border: 1px solid #ffe0b2;
		animation: fadeIn 0.3s ease-out;
	}

	.registration-prompt p {
		margin: 0;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(-10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.registration-prompt .link-button {
		color: #e65100;
		text-decoration: underline;
		cursor: pointer;
		background: none;
		border: none;
		padding: 0;
		font: inherit;
	}

	.registration-prompt .link-button:hover {
		color: #ef6c00;
		text-decoration: none;
	}

	.chat-window.minimized {
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
	}

	.minimized :global(.resize-handle) {
		display: none;
	}

	.title-bar-text {
		flex: 1;
		min-width: 0;
		padding-right: 0.5rem;
	}

	.title-bar-controls {
		display: flex;
		gap: 2px;
		margin-left: auto;
	}

	.pointer-events-none {
		pointer-events: none;
	}

	.gradient-input-wrapper {
		border: 1px inset #dfdfdf;
		padding: 2px;
	}

	.gradient-input-wrapper input {
		border: none !important;
		outline: none !important;
		padding: 1px 3px;
	}
</style>
