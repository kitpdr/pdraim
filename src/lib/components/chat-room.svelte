<script lang="ts">
	import { chatState } from '../states/chat.svelte';
	import { useQuery } from 'convex-svelte';
	import { api } from '../../convex/_generated/api';
	import type { Id } from '../../convex/_generated/dataModel';
	import type { Message, EnrichedMessage, SafeUser } from '../types/chat';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { draggable } from '$lib/actions/draggable';
	import { resizable } from '$lib/actions/resizable';
	import { maximizable } from '$lib/actions/maximizable';
	import { minimizable, type MinimizableNode } from '$lib/actions/minimizable';
	import LoadingButton from './ui/button-loading.svelte';
	import Tooltip from './ui/tooltip.svelte';
	import LoadingDots from './ui/loading-dots.svelte';
	import AimLogin from './aim-login.svelte';
	import FormattedMessage from './formatted-message.svelte';
	import TextFormattingToolbar from './text-formatting-toolbar.svelte';
	import {
		DEFAULT_TEXT_STYLE,
		type TextStyle,
		generateInputCSSStyle
	} from '../types/text-formatting';
	import { formatFrenchDateTime, formatFrenchRelativeTimeSafe } from '$lib/utils/date-format';
	import { loadWindowState, saveWindowState, debounce } from '$lib/utils/chat-window-state';
	import { MAX_MESSAGE_LENGTH } from '$lib/validation/message';

	// Props
	let { showChatRoom = $bindable(), initialTextStyle = DEFAULT_TEXT_STYLE } = $props();

	// ============ CONVEX REAL-TIME SUBSCRIPTIONS ============

	// Subscribe to default room (to get room ID)
	const defaultRoomQuery = useQuery(api.queries.getDefaultRoomPublic, {});

	// Subscribe to users (buddy list) - real-time updates
	const usersQuery = useQuery(api.queries.getUsersPublic, {});

	// Room ID from Convex query
	const roomId = $derived(defaultRoomQuery.data?.id as Id<'chatRooms'> | undefined);

	// Subscribe to messages - only when room ID is available
	const messagesQuery = $derived(
		roomId ? useQuery(api.queries.getMessagesPublic, () => ({ roomId: roomId!, limit: 100 })) : null
	);

	// Transform Convex users to SafeUser format
	const onlineUsers = $derived.by<SafeUser[]>(() => {
		if (!usersQuery.data) return [];
		return usersQuery.data
			.map((u) => ({
				id: u.id,
				nickname: u.nickname,
				status: u.status as SafeUser['status'],
				avatarUrl: u.avatarUrl ?? null,
				lastSeen: u.lastSeen ?? null
			}))
			.sort((a, b) => {
				const statusOrder: Record<string, number> = { online: 0, away: 1, busy: 2, offline: 3 };
				return (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3);
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
		defaultRoomQuery.isLoading || usersQuery.isLoading || messagesQuery?.isLoading
	);
	const connectionError = $derived.by<string | null>(() => {
		if (defaultRoomQuery.error) return 'Erreur de connexion au salon';
		if (usersQuery.error) return 'Erreur de chargement des utilisateurs';
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

	let windowWidth = $state(800);
	let windowHeight = $state(600);
	let windowX = $state(0);
	let windowY = $state(0);
	let isMobile = $state(false);
	let showUserList = $state(false);
	let isMaximized = $state(false);
	let isMinimized = $state(false);
	let isCentered = $state(true);

	// ============ INPUT STATE ============

	let currentMessage = $state('');
	let inputScrollLeft = $state(0);
	let currentTextStyle = $state<TextStyle>({
		...DEFAULT_TEXT_STYLE,
		...initialTextStyle,
		color: initialTextStyle.color || '#000000'
	});

	// ============ RATE LIMITING STATE ============

	let cooldownEndTime = $state<number | null>(null);
	let cooldownProgress = $state(0);
	let cooldownInterval: ReturnType<typeof setInterval> | null = null;
	let rateLimitWarning = $state<string | null>(null);
	let isSendingMessage = $state(false);

	// ============ AUTH STATE ============

	let showAuth = $state(false);

	// ============ SCROLL STATE ============

	let isLoadingMore = $state(false);
	let hasMoreMessages = $state(true);
	let oldestMessageTimestamp = $state<number | null>(null);
	let lastMessageCount = $state(0);

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
	const totalUsers = $derived(onlineUsers.length);
	const usersOnline = $derived(onlineUsers.filter((u) => u.status !== 'offline'));
	const usersOffline = $derived(onlineUsers.filter((u) => u.status === 'offline'));

	// ============ EFFECTS ============

	// Auto-scroll to bottom when new messages arrive
	$effect(() => {
		if (messages.length > lastMessageCount && messages.length > 0) {
			lastMessageCount = messages.length;
			if (browser) {
				const chatArea = document.querySelector('.chat-area');
				if (chatArea) {
					setTimeout(() => {
						chatArea.scrollTop = chatArea.scrollHeight;
					}, 0);
				}
			}
		}
	});

	// Update oldest timestamp for pagination
	$effect(() => {
		if (allMessages.length > 0) {
			oldestMessageTimestamp = Math.min(...allMessages.map((m) => m.timestamp));
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

	const debouncedSaveWindowState = debounce(saveWindowState, 300);

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

	function handleClose() {
		showChatRoom = false;
	}

	function handleInputChange(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.value.length > MAX_MESSAGE_LENGTH) {
			input.value = input.value.slice(0, MAX_MESSAGE_LENGTH);
			currentMessage = input.value;
		}
		inputScrollLeft = input.scrollLeft;
	}

	function handleInputScroll(e: Event) {
		inputScrollLeft = (e.target as HTMLInputElement).scrollLeft;
	}

	async function handleSubmit() {
		if (!currentMessage.trim() || !currentUser || cooldownEndTime) return;

		isSendingMessage = true;
		try {
			const response = await fetch('/api/chat/messages', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					content: currentMessage,
					type: 'chat',
					userId: currentUser.id,
					chatRoomId: roomId,
					styleData: currentTextStyle ? JSON.stringify(currentTextStyle) : undefined
				})
			});

			const data = await response.json();

			if (!data.success && data.isRateLimited && data.retryAfter) {
				startCooldownTimer(data.retryAfter);
				rateLimitWarning = "Whoa there! You're sending messages too quickly. Take a breather...";
			} else if (!data.success) {
				rateLimitWarning = data.error || 'Failed to send message. Please try again.';
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

	function handleDragMove(event: CustomEvent<{ x: number; y: number }>) {
		windowX = event.detail.x;
		windowY = event.detail.y;
		isCentered = false;
	}

	interface MaximizableNode extends HTMLElement {
		toggleMaximize: () => void;
	}

	function handleMaximize(event: MouseEvent) {
		const node = (event.currentTarget as HTMLElement).closest('.window') as MaximizableNode;
		if (node) {
			if (isMinimized) {
				const minimizableNode = node as unknown as MinimizableNode;
				if (minimizableNode?.toggleMinimize) {
					minimizableNode.toggleMinimize();
				}
				setTimeout(() => node.toggleMaximize(), 300);
			} else {
				node.toggleMaximize();
			}
		}
	}

	function handleMaximizeEvent(
		event: CustomEvent<{
			isMaximized: boolean;
			width: number;
			height: number;
			x: number;
			y: number;
		}>
	) {
		isMaximized = event.detail.isMaximized;
		windowWidth = event.detail.width;
		windowHeight = event.detail.height;
		windowX = event.detail.x;
		windowY = event.detail.y;
	}

	function handleMinimize(event: CustomEvent<{ isMinimized: boolean }>) {
		isMinimized = event.detail.isMinimized;
	}

	async function handleScroll(event: Event) {
		const chatArea = event.target as HTMLElement;
		const { scrollTop } = chatArea;

		if (scrollTop < 100 && !isLoadingMore && hasMoreMessages && roomId) {
			isLoadingMore = true;
			const scrollHeight = chatArea.scrollHeight;
			const currentScrollTop = chatArea.scrollTop;

			try {
				// Build query string manually to avoid URLSearchParams (svelte reactivity compliance)
				const queryParts = [
					`before=${encodeURIComponent(oldestMessageTimestamp?.toString() || '')}`,
					`roomId=${encodeURIComponent(roomId)}`
				];
				if (!currentUser) queryParts.push('public=true');
				const queryString = queryParts.join('&');

				const response = await fetch(`/api/chat/messages?${queryString}`);

				if (response.ok) {
					const data = await response.json();
					if (data.success) {
						if (data.messages.length === 0) {
							hasMoreMessages = false;
						} else {
							const fetchedMessages = data.messages as Message[];
							mergePagedMessages(fetchedMessages);

							requestAnimationFrame(() => {
								const newScrollHeight = chatArea.scrollHeight;
								const heightDifference = newScrollHeight - scrollHeight;
								chatArea.scrollTop = currentScrollTop + heightDifference;
							});

							const newOldest = Math.min(...fetchedMessages.map((m) => m.timestamp));
							oldestMessageTimestamp = oldestMessageTimestamp
								? Math.min(oldestMessageTimestamp, newOldest)
								: newOldest;
							hasMoreMessages = data.hasMore;
						}
					}
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
		showAuth = true;
	}

	function handleLoginSuccess() {
		showAuth = false;
	}

	// ============ LIFECYCLE ============

	onMount(() => {
		if (!browser) return;

		isMobile = window.innerWidth <= 768;

		if (!isMobile) {
			const savedState = loadWindowState();
			const maxWidth = window.innerWidth - 40;
			const maxHeight = window.innerHeight - 40;

			windowWidth = Math.min(savedState.width, maxWidth);
			windowHeight = Math.min(savedState.height, maxHeight);

			if (savedState.x === -1) {
				windowX = Math.max(0, (window.innerWidth - windowWidth) / 2);
			} else {
				windowX = Math.max(0, Math.min(savedState.x, window.innerWidth - windowWidth));
			}
			if (savedState.y === -1) {
				windowY = Math.max(0, (window.innerHeight - windowHeight) / 2);
			} else {
				windowY = Math.max(0, Math.min(savedState.y, window.innerHeight - windowHeight));
			}

			isMaximized = savedState.isMaximized;
			isMinimized = savedState.isMinimized;
			showUserList = savedState.showUserList;
			isCentered = savedState.isCentered;
		}

		const handleResize = () => {
			const wasMobile = isMobile;
			isMobile = window.innerWidth <= 768;

			if (isMobile) {
				windowWidth = window.innerWidth;
				windowHeight = window.innerHeight;
				windowX = 0;
				windowY = 0;
			} else if (wasMobile && !isMobile) {
				const savedState = loadWindowState();
				const maxWidth = window.innerWidth - 40;
				const maxHeight = window.innerHeight - 40;
				windowWidth = Math.min(savedState.width, maxWidth);
				windowHeight = Math.min(savedState.height, maxHeight);

				if (savedState.x === -1) {
					windowX = Math.max(0, (window.innerWidth - windowWidth) / 2);
				} else {
					windowX = Math.max(0, Math.min(savedState.x, window.innerWidth - windowWidth));
				}
				if (savedState.y === -1) {
					windowY = Math.max(0, (window.innerHeight - windowHeight) / 2);
				} else {
					windowY = Math.max(0, Math.min(savedState.y, window.innerHeight - windowHeight));
				}
			} else if (!isMobile) {
				const maxWidth = window.innerWidth - 40;
				const maxHeight = window.innerHeight - 40;
				windowWidth = Math.min(windowWidth, maxWidth);
				windowHeight = Math.min(windowHeight, maxHeight);

				if (isCentered) {
					windowX = Math.max(0, (window.innerWidth - windowWidth) / 2);
					windowY = Math.max(0, (window.innerHeight - windowHeight) / 2);
				} else {
					windowX = Math.max(0, Math.min(windowX, window.innerWidth - windowWidth));
					windowY = Math.max(0, Math.min(windowY, window.innerHeight - windowHeight));
				}
			}
		};

		if (isMobile) handleResize();

		window.addEventListener('resize', handleResize);

		return () => {
			window.removeEventListener('resize', handleResize);
			if (cooldownInterval) clearInterval(cooldownInterval);
		};
	});

	// Save window state when it changes
	$effect(() => {
		if (!browser || isMobile) return;
		debouncedSaveWindowState({
			width: windowWidth,
			height: windowHeight,
			x: windowX,
			y: windowY,
			isMaximized,
			isMinimized,
			showUserList,
			isCentered
		});
	});
</script>

{#if showChatRoom}
	<div
		class="chat-window window"
		class:minimized={isMinimized}
		style="width: {windowWidth}px; height: {windowHeight}px; left: {windowX}px; top: {windowY}px;"
		use:draggable={{ handle: '.title-bar', enabled: !isMobile && !isMaximized }}
		use:resizable={{
			enabled: !isMobile && !isMaximized && !isMinimized,
			minWidth: 400,
			minHeight: 500,
			maxWidth: window.innerWidth - 40,
			maxHeight: window.innerHeight - 40
		}}
		use:maximizable={{ enabled: !isMobile && !isMinimized, padding: 4 }}
		use:minimizable={{ enabled: !isMobile }}
		onmaximize={handleMaximizeEvent}
		onminimize={handleMinimize}
		onresizemove={(e) => {
			windowWidth = Math.max(400, e.detail.width);
			windowHeight = Math.max(500, e.detail.height);
		}}
		ondragmove={handleDragMove}
	>
		<div class="title-bar">
			<div
				class="title-bar-text"
				style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: 'MS Sans Serif', 'Pixelated MS Sans Serif', sans-serif;"
			>
				Pdr Aim {#if currentUser}
					- {currentUser.nickname}{:else}
					- {totalUsers} membre{totalUsers > 1 ? 's' : ''}{/if}
				{#if connectionError && !isMinimized}
					<span class="connection-error">⚠️ {connectionError}</span>
				{/if}
			</div>
			<div class="title-bar-controls">
				{#if !isMobile}
					<button
						aria-label="Minimize"
						onclick={(e) => {
							e.stopPropagation();
							const node = (e.currentTarget as HTMLElement).closest(
								'.window'
							) as MinimizableNode | null;
							if (node?.toggleMinimize) node.toggleMinimize();
						}}
					></button>
					<button aria-label="Maximize" class:maximized={isMaximized} onclick={handleMaximize}
					></button>
					<button onclick={handleClose} aria-label="Close"></button>
				{:else}
					<button
						aria-label="Afficher/Masquer la liste des contacts"
						onclick={() => (showUserList = !showUserList)}
						class="contacts-btn">👥</button
					>
					<button
						aria-label="Minimize"
						onclick={(e) => {
							e.stopPropagation();
							const node = (e.currentTarget as HTMLElement).closest(
								'.window'
							) as MinimizableNode | null;
							if (node?.toggleMinimize) node.toggleMinimize();
						}}
					></button>
					<button onclick={handleClose} aria-label="Close"></button>
				{/if}
			</div>
		</div>

		{#if !isMinimized}
			<div
				class="window-body"
				style="display: flex; height: calc(100% - 2rem); margin: 0; padding: 0.5rem;"
			>
				{#if connectionError}
					<div class="error-banner">
						{connectionError}
					</div>
				{/if}

				<div
					class="chat-container"
					style="flex: 1; display: flex; flex-direction: column; margin-right: 0.5rem;"
				>
					{#if rateLimitWarning}
						<div class="rate-limit-warning" class:with-progress={cooldownEndTime}>
							<span>{rateLimitWarning}</span>
							{#if cooldownEndTime}
								<small
									>Vous pourrez envoyer un autre message dans {cooldownProgress.toFixed(1)}s</small
								>
							{/if}
						</div>
					{/if}

					<div
						class="sunken-panel chat-area"
						style="flex: 1; margin-bottom: 0.5rem; padding: 0.5rem; overflow-y: auto;"
						onscroll={(e) => handleScroll(e)}
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
									👋 <button class="link-button" onclick={openSignup}>Inscris-toi</button>pour lire
									le reste du chat !
								</p>
							</div>
						{/if}
						{#each visibleMessages as message (message.id)}
							<div class="message {message.type} text">
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

					<div class="field-row input-container" style="margin: 0;">
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
									aria-hidden="true">{currentMessage}</span
								>
								<input
									type="text"
									bind:value={currentMessage}
									maxlength={MAX_MESSAGE_LENGTH}
									class="styled-input retro-font-{currentTextStyle.fontFamily}"
									style="width: 100%; background: transparent; color: transparent; caret-color: black; font-size: {currentTextStyle.fontSize}px; {currentTextStyle.bold
										? currentTextStyle.fontFamily === 'tahoma'
											? 'font-weight: 200;'
											: 'font-weight: 700;'
										: ''} {currentTextStyle.italic
										? 'font-style: italic;'
										: ''} {currentTextStyle.underline || currentTextStyle.strikethrough
										? `text-decoration: ${[currentTextStyle.underline ? 'underline' : '', currentTextStyle.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ')};`
										: ''}"
									onkeydown={(e) => e.key === 'Enter' && handleSubmit()}
									oninput={handleInputChange}
									onscroll={handleInputScroll}
									placeholder={cooldownEndTime
										? `Patientez ${cooldownProgress.toFixed(1)}s...`
										: 'Écrivez un message...'}
									disabled={!currentUser || Boolean(cooldownEndTime)}
								/>
							</div>
						{:else}
							<input
								type="text"
								bind:value={currentMessage}
								maxlength={MAX_MESSAGE_LENGTH}
								class="styled-input retro-font-{currentTextStyle.fontFamily}"
								style="flex: 1; {generateInputCSSStyle(currentTextStyle)}"
								onkeydown={(e) => e.key === 'Enter' && handleSubmit()}
								placeholder={cooldownEndTime
									? `Patientez ${cooldownProgress.toFixed(1)}s...`
									: 'Écrivez un message...'}
								disabled={!currentUser || Boolean(cooldownEndTime)}
							/>
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
					{#if cooldownEndTime}
						<div
							class="cooldown-progress"
							style="width: {100 -
								((cooldownProgress * 100) / (cooldownEndTime - Date.now())) * 1000}%"
						></div>
					{/if}
				</div>

				<!-- Online users list -->
				<div
					class="sunken-panel users-list"
					class:mobile={isMobile}
					class:hidden={isMobile && !showUserList}
					style="width: {isMobile ? '100%' : '9.375rem'}; padding: 0.5rem; overflow-y: auto;"
				>
					<!-- Online users section -->
					{#if usersOnline.length > 0}
						<p class="section-header">En ligne ({usersOnline.length})</p>
						{#each usersOnline as user (user.id)}
							<div class="user">{user.nickname}</div>
						{/each}
					{/if}

					<!-- Offline users section -->
					{#if usersOffline.length > 0}
						{#if usersOnline.length > 0}
							<div class="section-separator"></div>
						{/if}
						<p class="section-header offline-header">Hors ligne ({usersOffline.length})</p>
						{#each usersOffline as user (user.id)}
							<div class="user offline">
								<Tooltip
									data={{
										text: 'Dernière connexion: ' + formatFrenchRelativeTimeSafe(user.lastSeen),
										direction: 'bottom',
										closeDelay: 1000,
										touchBehavior: 'remove'
									}}
								>
									<span class="nickname">{user.nickname}</span>
								</Tooltip>
							</div>
						{/each}
					{/if}
				</div>
			</div>
		{/if}
	</div>
{/if}

{#if showAuth}
	<AimLogin bind:showAuth activeTab={'signup' as const} onLoginSuccess={handleLoginSuccess} />
{/if}

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

	.title-bar {
		height: 2rem;
		position: relative;
		cursor: default;
		user-select: none;
		display: flex;
		align-items: center;
		padding: 0 0.5rem;
	}

	.title-bar:not(:has(button:hover)) {
		cursor: move;
	}

	.chat-window {
		position: fixed;
		box-sizing: border-box;
		transition:
			width 0.3s ease,
			height 0.3s ease,
			left 0.3s ease,
			top 0.3s ease;
		will-change: transform;
	}

	.chat-window.dragging {
		transition: none !important;
		user-select: none;
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

	.user {
		margin-bottom: 0.125rem;
		padding-left: 0.25rem;
		line-height: 1.4;
		font-size: 0.9rem;
		font-weight: normal;
		color: var(--color-foreground);
	}

	.user.offline {
		color: var(--color-muted-foreground);
		font-style: italic;
	}

	.user.offline .nickname {
		cursor: help;
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

	.input-container input:disabled,
	.input-container {
		opacity: 0.7;
		background-color: rgba(128, 128, 128, 0.1);
		cursor: not-allowed;
	}

	.hidden {
		display: none !important;
	}

	:global(.resize-handle) {
		position: absolute;
		bottom: 0;
		right: 0;
		width: 15px !important;
		height: 15px !important;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='15' height='15'%3E%3Cpath d='M11 11v-2h2v2h-2zm0-4h2v2h-2V7zm-2 2V7h2v2H9zm0 2v-2h2v2H9zm-2 0v-2h2v2H7z' fill='%23000'/%3E%3C/svg%3E");
		background-position: bottom right;
		background-repeat: no-repeat;
		cursor: se-resize !important;
	}

	@media (max-width: 768px) {
		.window {
			position: fixed !important;
			top: 0 !important;
			left: 0 !important;
			right: 0 !important;
			bottom: 0 !important;
			width: 100% !important;
			height: 100% !important;
			transition: transform 0.3s ease !important;
			margin: 0 !important;
			border-radius: 0 !important;
		}

		.window.minimized {
			transform: translateY(calc(100% - 32px)) !important;
			height: 100% !important;
		}

		.window.minimized .title-bar {
			height: 32px;
		}

		.title-bar-controls button {
			width: 24px;
			height: 24px;
			padding: 0;
			margin: 0 2px;
			background-color: transparent;
			border: 1px solid transparent;
			position: relative;
		}

		.title-bar-controls button.contacts-btn {
			width: auto;
			padding: 0 0.5rem;
			font-size: 1.25rem;
		}

		.window.minimized .title-bar-controls button {
			opacity: 0.8;
		}

		.window.minimized .title-bar-controls button.contacts-btn {
			opacity: 0.8;
		}

		.window-body {
			flex-direction: column;
		}

		.chat-container {
			margin-right: 0 !important;
			margin-bottom: 0 !important;
			height: 100%;
		}

		.users-list.mobile {
			position: fixed;
			bottom: 0;
			left: 0;
			right: 0;
			height: auto;
			max-height: 30vh;
			z-index: 1000;
			border-top: 0.125rem solid #dfdfdf;
			background: white;
		}

		.input-container {
			padding: 0.5rem;
			border-top: 0.125rem solid #dfdfdf;
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

	.error-banner small {
		color: #666;
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

	.minimized .title-bar {
		cursor: pointer;
	}

	.minimized .window-body {
		display: none;
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
