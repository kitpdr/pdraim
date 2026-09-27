<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { useQuery } from 'convex-svelte';
	import { api as convexApi } from '../../../convex/_generated/api';
	import type { Id } from '../../../convex/_generated/dataModel';
	import type { EnrichedMessage, SafeUser } from '$lib/types/chat';
	import { authQuery, useAimClient } from '$lib/aim/client';
	import { playSound } from '$lib/aim/sounds';
	import { getBuddyIcon } from '$lib/aim/buddy-icons';
	import { STATUS_LABELS_FR, type AimStatus } from '$lib/types/aim';
	import { chatState } from '$lib/states/chat.svelte';
	import { desktop } from '$lib/states/desktop.svelte';
	import { api } from '$lib/api/client';
	import { DEFAULT_TEXT_STYLE, type TextStyle } from '$lib/types/text-formatting';
	import { MAX_MESSAGE_LENGTH } from '$lib/validation/message';
	import { debounce } from '$lib/utils/chat-window-state';
	import { formatFrenchTime } from '$lib/utils/date-format';
	import XpWindow from './xp-window.svelte';
	import FormattedMessage from '../formatted-message.svelte';
	import TextFormattingToolbar from '../text-formatting-toolbar.svelte';

	let { roomId, otherUserId, otherNickname } = $props<{
		roomId: Id<'chatRooms'>;
		otherUserId: Id<'users'>;
		otherNickname: string;
	}>();
	const id = $derived(`im-${roomId}`);
	const aim = useAimClient();
	const messagesQuery = authQuery(convexApi.aim.getRoomMessages, () => ({ roomId }));
	const typingQuery = authQuery(convexApi.aim.getRoomTyping, () => ({ roomId }));
	const profileQuery = useQuery(convexApi.aim.getUserProfile, () => ({ userId: otherUserId }));
	const currentUser = $derived(chatState.getCurrentUser());
	const profile = $derived(profileQuery.data);
	const buddyIcon = $derived(getBuddyIcon(profile?.buddyIcon));
	const status = $derived((profile?.status ?? 'offline') as AimStatus);
	const messages = $derived.by<EnrichedMessage[]>(() =>
		(messagesQuery?.data ?? []).map((msg) => ({
			id: msg.id,
			chatRoomId: msg.chatRoomId,
			senderId: msg.senderId,
			content: msg.content,
			type: msg.type,
			timestamp: msg.timestamp,
			styleData: msg.styleData,
			hasFormatting: msg.hasFormatting ?? false,
			user: {
				id: msg.sender?.id ?? msg.senderId,
				nickname: msg.sender?.nickname ?? otherNickname,
				status: (msg.sender?.status ?? 'offline') as SafeUser['status'],
				avatarUrl: msg.sender?.avatarUrl ?? null,
				lastSeen: null
			}
		}))
	);
	let menuOpen = $state<'file' | 'contact' | null>(null);
	let draft = $state('');
	let textStyle = $state<TextStyle>({ ...DEFAULT_TEXT_STYLE });
	let styleReady = $state(false);
	let loadedStyle = $state('');
	let sending = $state(false);
	let error = $state('');
	let cooldownSeconds = $state(0);
	let cooldownEnd = 0;
	let cooldownTimer: ReturnType<typeof setInterval> | undefined;
	let typingTimer: ReturnType<typeof setTimeout> | undefined;
	let readTimer: ReturnType<typeof setTimeout> | undefined;
	let lastTypingAt = 0;
	let conversation: HTMLDivElement;
	let firstScroll = true;
	let previousLast: string | null = null;
	let previousRoom: string | null = null;
	const disabled = $derived(!currentUser || sending || cooldownSeconds > 0);

	const saveStyle = debounce((style: TextStyle) => {
		void api.textPreferences.save({
			defaultStyle: style,
			allowFormatting: true,
			maxMessageLength: MAX_MESSAGE_LENGTH
		});
	}, 1500);

	// Load once per signed-in identity; do not persist the fetched default as an edit.
	$effect(() => {
		const userId = currentUser?.id;
		styleReady = false;
		if (!userId) return;
		let active = true;
		void api.textPreferences
			.get()
			.then((prefs) => {
				if (!active) return;
				textStyle = { ...DEFAULT_TEXT_STYLE, ...prefs?.defaultStyle };
				loadedStyle = JSON.stringify(textStyle);
				styleReady = true;
			})
			.catch(() => {
				if (!active) return;
				loadedStyle = JSON.stringify(textStyle);
				styleReady = true;
			});
		return () => {
			active = false;
		};
	});
	$effect(() => {
		const style = JSON.stringify(textStyle);
		if (styleReady && currentUser && style !== loadedStyle) {
			loadedStyle = style;
			saveStyle(JSON.parse(style) as TextStyle);
		}
	});

	function stopTyping() {
		if (typingTimer) clearTimeout(typingTimer);
		typingTimer = undefined;
		if (lastTypingAt) {
			lastTypingAt = 0;
			void aim.setTyping(roomId, false).catch(() => {});
		}
	}
	function onInput() {
		if (!currentUser) return;
		if (!draft.trim()) {
			stopTyping();
			return;
		}
		const now = Date.now();
		if (draft.trim() && now - lastTypingAt >= 3000) {
			lastTypingAt = now;
			void aim.setTyping(roomId, true).catch(() => {});
		}
		if (typingTimer) clearTimeout(typingTimer);
		typingTimer = setTimeout(stopTyping, 4000);
	}
	function startCooldown(retryAfter: number) {
		cooldownEnd = Date.now() + retryAfter;
		if (cooldownTimer) clearInterval(cooldownTimer);
		const update = () => {
			cooldownSeconds = Math.max(0, Math.ceil((cooldownEnd - Date.now()) / 1000));
			if (!cooldownSeconds && cooldownTimer) {
				clearInterval(cooldownTimer);
				cooldownTimer = undefined;
			}
		};
		update();
		if (cooldownSeconds) cooldownTimer = setInterval(update, 200);
	}
	async function send() {
		if (disabled || !draft.trim() || draft.length > MAX_MESSAGE_LENGTH || !currentUser) return;
		sending = true;
		error = '';
		const content = draft;
		try {
			const result = await api.chat.sendMessage({
				content,
				type: 'chat',
				userId: currentUser.id,
				chatRoomId: roomId,
				styleData: JSON.stringify(textStyle)
			});
			if (result.success) {
				if (draft === content) draft = '';
				stopTyping();
				playSound('imSend');
			} else if (result.isRateLimited && result.retryAfter) {
				startCooldown(result.retryAfter);
			} else {
				error = result.error ?? 'Impossible d’envoyer le message.';
			}
		} catch {
			error = 'Impossible d’envoyer le message.';
		} finally {
			sending = false;
		}
	}
	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			void send();
		}
	}

	$effect(() => {
		const room = roomId;
		const data = messagesQuery?.data;
		if (room !== previousRoom) {
			previousRoom = room;
			previousLast = null;
			firstScroll = true;
		}
		if (!data) return;
		const last = data.at(-1);
		const signature = last ? `${last.id}:${last.timestamp}` : '';
		if (
			previousLast !== null &&
			last &&
			signature !== previousLast &&
			last.senderId === otherUserId
		) {
			playSound('imReceive');
			if (desktop.focusedId !== id) desktop.requestAttention(id);
		}
		const changed = signature !== previousLast;
		previousLast = signature;
		if (!changed || !conversation) return;
		const shouldScroll =
			firstScroll ||
			conversation.scrollTop + conversation.clientHeight >= conversation.scrollHeight - 40;
		firstScroll = false;
		if (shouldScroll) void tick().then(() => conversation?.scrollTo(0, conversation.scrollHeight));
	});
	$effect(() => {
		const last = messagesQuery?.data?.at(-1);
		const focused = desktop.focusedId === id && !desktop.get(id)?.minimized;
		if (!focused || !currentUser || !messagesQuery?.data) return;
		// Depend on the latest message and focus, not the mutation's result.
		void last;
		readTimer = setTimeout(() => {
			void aim.markRoomRead(roomId).catch(() => {});
		}, 500);
		return () => {
			if (readTimer) clearTimeout(readTimer);
		};
	});
	onMount(() => () => {
		stopTyping();
		if (cooldownTimer) clearInterval(cooldownTimer);
		if (readTimer) clearTimeout(readTimer);
	});
</script>

<XpWindow {id} width={460} height={420} minWidth={320} minHeight={300} showMaximize>
	{#snippet menu()}
		<div class="menu-item">
			<button
				aria-expanded={menuOpen === 'file'}
				onclick={() => (menuOpen = menuOpen === 'file' ? null : 'file')}>Fichier</button
			>
			{#if menuOpen === 'file'}<div class="dropdown">
					<button
						onclick={() => {
							menuOpen = null;
							desktop.close(id);
						}}>Fermer</button
					>
				</div>{/if}
		</div>
		<div class="menu-item">
			<button
				aria-expanded={menuOpen === 'contact'}
				onclick={() => (menuOpen = menuOpen === 'contact' ? null : 'contact')}>Contact</button
			>
			{#if menuOpen === 'contact'}<div class="dropdown">
					<button
						onclick={() => {
							menuOpen = null;
							desktop.openProfile({ userId: otherUserId, nickname: otherNickname });
						}}>Infos sur {otherNickname}</button
					>
				</div>{/if}
		</div>
	{/snippet}
	<div class="im-body">
		<div class="header">
			<div
				class="buddy-icon"
				style:background={buddyIcon.bg}
				role="img"
				aria-label={buddyIcon.label}
			>
				{buddyIcon.emoji}
			</div>
			<div class="identity">
				<strong>{profile?.nickname ?? otherNickname}</strong><span
					><img src={`/aim/status-${status}.svg`} alt="" width="14" height="14" />
					{STATUS_LABELS_FR[status] ?? 'Hors ligne'}</span
				>
			</div>
		</div>
		{#if status === 'away' && profile?.awayMessage}<div class="away">
				Message d'absence : {profile.awayMessage}
			</div>{/if}
		<div
			class="sunken-panel conversation"
			bind:this={conversation}
			role="log"
			aria-label={`Conversation avec ${otherNickname}`}
		>
			{#if !messagesQuery?.data}<div class="loading">Chargement…</div>{/if}
			{#each messages as message (message.id)}
				{#if message.type === 'system'}<div class="system">{message.content}</div>
				{:else}<div class="message">
						<span
							class:me={message.senderId === currentUser?.id}
							class="nick"
							title={new Date(message.timestamp).toLocaleString('fr-FR')}
							>{message.user.nickname} ({formatFrenchTime(new Date(message.timestamp)).replace(
								'h',
								':'
							)}):</span
						>
						<FormattedMessage {message} allowFormatting={true} />
					</div>{/if}
			{/each}
			{#if typingQuery?.data?.length}<div class="typing">
					{typingQuery.data.map((user) => user.nickname).join(', ')} est en train d'écrire<span
						class="dots">…</span
					>
				</div>{/if}
		</div>
		<TextFormattingToolbar
			bind:style={textStyle}
			compact={true}
			showFontSelector={true}
			onSmiley={(code) => {
				const needsSpace = draft.length > 0 && !draft.endsWith(' ');
				draft = `${draft}${needsSpace ? ' ' : ''}${code} `;
				document.getElementById(`im-input-${roomId}`)?.focus();
			}}
		/>
		<div class="compose field-row">
			<label class="sr-only" for={`im-input-${roomId}`}>Message à {otherNickname}</label>
			<textarea
				id={`im-input-${roomId}`}
				bind:value={draft}
				oninput={onInput}
				onkeydown={onKeydown}
				disabled={!currentUser || cooldownSeconds > 0}
				placeholder={currentUser ? 'Écris ton message…' : 'Connecte-toi pour discuter.'}
				maxlength={MAX_MESSAGE_LENGTH}
				rows="3"
			></textarea>
			<button class="send" onclick={send} disabled={disabled || !draft.trim()}>Envoyer</button>
		</div>
		{#if cooldownSeconds > 0}<span class="notice">Patiente {cooldownSeconds}s…</span
			>{:else if error}<span class="notice" role="alert">{error}</span>{/if}
		{#if draft.length > MAX_MESSAGE_LENGTH * 0.8}<span class="counter"
				>{draft.length}/{MAX_MESSAGE_LENGTH}</span
			>{/if}
	</div>
</XpWindow>

<style>
	.im-body {
		display: flex;
		flex-direction: column;
		min-height: 0;
		height: 100%;
		gap: 5px;
		font-family: Tahoma, 'Pixelated MS Sans Serif', sans-serif;
	}
	.menu-item {
		position: relative;
	}
	.dropdown {
		position: absolute;
		top: 100%;
		left: 0;
		z-index: 100;
		min-width: 160px;
		padding: 2px;
		background: #fff;
		border: 1px solid #aca899;
		box-shadow: 2px 2px 4px #777;
	}
	.dropdown button {
		width: 100%;
		text-align: left;
		white-space: nowrap;
	}
	.dropdown button:hover {
		background: #316ac5;
		color: white;
	}
	.header {
		display: flex;
		align-items: center;
		gap: 9px;
		flex: none;
		padding: 2px 4px;
	}
	.buddy-icon {
		width: 48px;
		height: 48px;
		display: grid;
		place-items: center;
		font-size: 29px;
		border: 1px solid #aca899;
		flex: none;
	}
	.identity {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
	}
	.identity strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.identity span {
		display: flex;
		align-items: center;
		gap: 3px;
	}
	.away {
		flex: none;
		background: #fff8cc;
		border: 1px solid #e1c466;
		padding: 5px;
		overflow-wrap: anywhere;
	}
	.conversation {
		flex: 1 1 auto;
		min-height: 0;
		background: white;
		overflow: auto;
		padding: 6px;
		font:
			12px/1.5 Tahoma,
			'Pixelated MS Sans Serif',
			sans-serif;
	}
	.message {
		margin-bottom: 5px;
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}
	.nick {
		font-weight: bold;
		color: #0000c0;
	}
	.nick.me {
		color: #c00000;
	}
	.system {
		text-align: center;
		color: #777;
		font-style: italic;
		margin: 6px 0;
	}
	.typing,
	.loading {
		color: #777;
		font-style: italic;
	}
	.dots {
		display: inline-block;
		animation: blink 1s infinite alternate;
	}
	@keyframes blink {
		from {
			opacity: 0.25;
		}
		to {
			opacity: 1;
		}
	}
	.compose {
		display: flex;
		align-items: stretch;
		gap: 6px;
		flex: none;
	}
	textarea {
		flex: 1;
		min-width: 0;
		resize: none;
		font:
			12px Tahoma,
			sans-serif;
	}
	.send {
		align-self: flex-end;
	}
	.notice {
		color: #9b2600;
	}
	.counter {
		align-self: flex-end;
		font-size: 10px;
		color: #777;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
	}
</style>
