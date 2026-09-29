<script lang="ts">
	import { desktop } from '$lib/states/desktop.svelte';
	import { chatState } from '$lib/states/chat.svelte';

	const currentUser = $derived(chatState.getCurrentUser());

	interface DesktopIcon {
		id: string;
		label: string;
		icon: string;
		action: () => void;
		hidden?: boolean;
	}

	const icons = $derived<DesktopIcon[]>([
		{
			id: 'aim',
			label: 'PDR AIM',
			icon: '/desktop/pdraim-icon.png',
			// Signed out: the sign-on window (which opens the buddy list and unlocks the
			// chat room once logged in). Signed in: the buddy list.
			action: () => (currentUser ? desktop.openBuddyList() : desktop.openLogin('signin'))
		},
		{
			id: 'general',
			label: 'Salon General',
			icon: '/aim/chat-room-48.png',
			action: () => desktop.openChatRoom(null, 'General')
		},
		{
			id: 'away',
			label: 'Message d’absence',
			icon: '/aim/xp-note-48.png',
			action: () => desktop.openAway(),
			hidden: !currentUser
		},
		{
			id: 'prefs',
			label: 'Préférences',
			icon: '/aim/xp-control-panel-48.png',
			action: () => desktop.openPreferences()
		},
		{
			id: 'about',
			label: 'Aide',
			icon: '/aim/xp-help-48.png',
			action: () => desktop.openAbout()
		}
	]);

	let selected = $state<string | null>(null);

	function handleKeydown(event: KeyboardEvent, action: () => void) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			action();
		}
	}
</script>

<div class="desktop-icons">
	{#each icons.filter((i) => !i.hidden) as icon (icon.id)}
		<div
			class="desktop-icon"
			class:selected={selected === icon.id}
			onclick={(e) => {
				e.stopPropagation();
				selected = icon.id;
			}}
			ondblclick={icon.action}
			onkeydown={(e) => handleKeydown(e, icon.action)}
			onfocus={() => (selected = icon.id)}
			role="button"
			tabindex="0"
		>
			<img src={icon.icon} alt="" />
			<span class="icon-label">{icon.label}</span>
		</div>
	{/each}
</div>

<style>
	.desktop-icons {
		position: fixed;
		top: 16px;
		left: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		z-index: 1;
	}

	.desktop-icon {
		display: flex;
		flex-direction: column;
		align-items: center;
		cursor: default;
		width: 80px;
		text-align: center;
		padding: 6px 4px;
		border: 1px dotted transparent;
		border-radius: 2px;
		outline: none;
	}

	.desktop-icon:hover {
		background: rgba(49, 106, 197, 0.15);
	}

	.desktop-icon.selected,
	.desktop-icon:focus-visible {
		background: rgba(49, 106, 197, 0.45);
		border-color: rgba(255, 255, 255, 0.8);
	}

	.desktop-icon img {
		width: 40px;
		height: 40px;
		margin-bottom: 4px;
		pointer-events: none;
		image-rendering: pixelated;
		filter: drop-shadow(1px 1px 1px rgba(0, 0, 0, 0.6));
	}

	.icon-label {
		color: white;
		text-shadow:
			1px 1px 1px rgba(0, 0, 0, 0.9),
			0 0 4px rgba(0, 0, 0, 0.6);
		font-family: Tahoma, 'Pixelated MS Sans Serif', sans-serif;
		font-size: 11px;
		user-select: none;
		pointer-events: none;
		max-width: 100%;
		overflow-wrap: break-word;
		line-height: 1.2;
	}

	@media (max-width: 768px) {
		.desktop-icons {
			display: none;
		}
	}
</style>
