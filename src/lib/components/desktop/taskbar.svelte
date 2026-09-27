<script lang="ts">
	import { onMount } from 'svelte';
	import { desktop } from '$lib/states/desktop.svelte';
	import { chatState } from '$lib/states/chat.svelte';
	import { soundsEnabled, setSoundsEnabled, unlockAudio } from '$lib/aim/sounds';

	let menuOpen = $state(false);
	let soundOn = $state(true);
	let clock = $state('');
	let menuElement = $state<HTMLElement>();
	let startElement = $state<HTMLButtonElement>();
	const user = $derived(chatState.getCurrentUser());

	function updateClock() {
		clock = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
	}

	onMount(() => {
		soundOn = soundsEnabled();
		updateClock();
		const timer = setInterval(updateClock, 30_000);
		function outside(event: PointerEvent) {
			if (
				menuOpen &&
				!menuElement?.contains(event.target as Node) &&
				!startElement?.contains(event.target as Node)
			)
				menuOpen = false;
		}
		function escape(event: KeyboardEvent) {
			if (event.key === 'Escape') menuOpen = false;
		}
		document.addEventListener('pointerdown', outside);
		document.addEventListener('keydown', escape);
		return () => {
			clearInterval(timer);
			document.removeEventListener('pointerdown', outside);
			document.removeEventListener('keydown', escape);
		};
	});

	function choose(action: () => void) {
		menuOpen = false;
		action();
	}

	async function logout() {
		const response = await fetch('/api/session/logout', { method: 'POST' });
		if (response.ok) window.location.reload();
	}
</script>

<div class="taskbar">
	<button
		class="start"
		bind:this={startElement}
		aria-expanded={menuOpen}
		aria-controls="start-menu"
		onclick={() => (menuOpen = !menuOpen)}
		><img src="/aim/start.svg" alt="" width="20" height="20" />démarrer</button
	>
	{#if menuOpen}
		<div class="start-menu" id="start-menu" bind:this={menuElement}>
			<div class="menu-header">{user?.nickname ?? 'Invité'}</div>
			<button onclick={() => choose(() => desktop.openBuddyList())}
				>PDR AIM — Liste de contacts</button
			>
			<button onclick={() => choose(() => desktop.openChatRoom(null, 'General'))}
				>Salon General</button
			>
			<button onclick={() => choose(() => desktop.openNewRoom())}>Nouveau salon…</button>
			<hr />
			<button onclick={() => choose(() => desktop.openPreferences())}>Préférences</button>
			<button onclick={() => choose(() => desktop.openAbout())}>À propos</button>
			<hr />
			{#if user}
				<button
					onclick={() => {
						menuOpen = false;
						void logout();
					}}>Se déconnecter</button
				>
			{:else}
				<button onclick={() => choose(() => desktop.openLogin('signin'))}>Se connecter</button>
				<button onclick={() => choose(() => desktop.openLogin('signup'))}>S'inscrire</button>
			{/if}
		</div>
	{/if}
	<div class="tasks">
		{#each desktop.taskbarWindows as w (w.id)}
			<button
				class="task"
				class:pressed={desktop.focusedId === w.id}
				class:minimized={w.minimized}
				class:attention={w.attention}
				title={w.title}
				onclick={() => desktop.toggleFromTaskbar(w.id)}
				><img src={w.icon} alt="" width="16" height="16" /><span>{w.title}</span></button
			>
		{/each}
	</div>
	<div class="tray">
		<button
			class="tray-button"
			title={soundOn ? 'Désactiver les sons' : 'Activer les sons'}
			aria-label={soundOn ? 'Désactiver les sons' : 'Activer les sons'}
			onclick={() => {
				unlockAudio();
				soundOn = !soundsEnabled();
				setSoundsEnabled(soundOn);
			}}><span aria-hidden="true">{soundOn ? '🔊' : '🔇'}</span></button
		>
		<img
			src="/aim/running-man.svg"
			alt=""
			title={user ? `Statut : ${user.status}` : 'Hors ligne'}
			width="16"
			height="16"
		/>
		<time>{clock}</time>
	</div>
</div>

<style>
	.taskbar {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		height: 30px;
		z-index: 5000;
		display: flex;
		align-items: stretch;
		gap: 4px;
		background: linear-gradient(#245edb, #3168d5);
		border-top: 1px solid #0f3d9a;
		box-sizing: border-box;
		color: white;
		font:
			11px Tahoma,
			'Pixelated MS Sans Serif',
			sans-serif;
	}
	.start {
		display: flex;
		align-items: center;
		gap: 4px;
		border: 0;
		border-radius: 0 14px 14px 0;
		background: linear-gradient(#3c8f3c, #2c7a2c);
		color: white;
		font:
			bold italic 14px Tahoma,
			sans-serif;
		padding: 0 14px 0 6px;
		cursor: pointer;
		box-shadow: inset 0 1px #8acb70;
	}
	.start-menu {
		position: absolute;
		bottom: 30px;
		left: 0;
		width: 250px;
		background: white;
		border: 2px solid #245edb;
		box-shadow: 2px 2px 8px #3339;
		color: #222;
		padding-bottom: 4px;
	}
	.menu-header {
		background: linear-gradient(#245edb, #4f91ef);
		color: white;
		font-weight: bold;
		padding: 10px;
	}
	.start-menu button {
		display: block;
		width: 100%;
		text-align: left;
		background: transparent;
		border: 0;
		box-shadow: none;
		border-radius: 0;
		padding: 6px 12px;
		font: inherit;
		color: #222;
		cursor: pointer;
	}
	.start-menu button:hover,
	.start-menu button:focus-visible {
		background: #316ac5;
		color: white;
	}
	.start-menu hr {
		border: 0;
		border-top: 1px solid #ccc;
		margin: 4px 8px;
	}
	.tasks {
		display: flex;
		gap: 3px;
		align-items: center;
		flex: 1;
		overflow: hidden;
		min-width: 0;
	}
	.task {
		display: flex;
		align-items: center;
		gap: 4px;
		width: 160px;
		max-width: 160px;
		min-width: 36px;
		height: 24px;
		flex-shrink: 1;
		color: white;
		background: #ffffff30;
		border: 1px solid #ffffff44;
		border-radius: 3px;
		padding: 2px 6px;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.task span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.task img {
		flex: 0 0 16px;
	}
	.task.pressed {
		background: #103b96;
		box-shadow: inset 1px 1px 3px #082a76;
	}
	.task.minimized {
		background: #ffffff18;
	}
	.task.attention {
		animation: flash 1s infinite alternate;
	}
	@keyframes flash {
		from {
			background: #e69a12;
		}
		to {
			background: #ffdc55;
			color: #222;
		}
	}
	.tray {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 8px;
		background: linear-gradient(#0c91e8, #1684d1);
		border-left: 1px solid #78baff;
		white-space: nowrap;
	}
	.tray-button {
		min-width: 0;
		padding: 0;
		border: 0;
		box-shadow: none;
		background: none;
		cursor: pointer;
		font-size: 14px;
	}
	.tray time {
		font: inherit;
	}
</style>
