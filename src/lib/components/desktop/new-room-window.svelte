<script lang="ts">
	import XpWindow from './xp-window.svelte';
	import { desktop } from '$lib/states/desktop.svelte';
	import { chatState } from '$lib/states/chat.svelte';
	import { useAimClient } from '$lib/aim/client';

	const client = useAimClient();
	const signedIn = $derived(Boolean(chatState.getCurrentUser()));
	let name = $state('');
	let topic = $state('');
	let pending = $state(false);
	let error = $state('');

	async function create() {
		const trimmedName = name.trim();
		const trimmedTopic = topic.trim();
		if (trimmedName.length < 2 || trimmedName.length > 40) {
			error = 'Le nom du salon doit contenir entre 2 et 40 caractères.';
			return;
		}
		if (trimmedTopic.length > 120) {
			error = 'Le sujet ne peut pas dépasser 120 caractères.';
			return;
		}
		pending = true;
		error = '';
		try {
			const room = await client.createGroupRoom(trimmedName, trimmedTopic || undefined);
			desktop.openChatRoom(room.id, trimmedName);
			desktop.close('new-room');
		} catch (err) {
			error = err instanceof Error ? err.message : 'Impossible de créer le salon.';
		} finally {
			pending = false;
		}
	}
</script>

<XpWindow id="new-room" width={340} height={220} resizableWindow={false}>
	<div class="content">
		{#if signedIn}
			<label for="room-name">Nom du salon</label>
			<input
				id="room-name"
				type="text"
				maxlength="40"
				minlength="2"
				bind:value={name}
				oninput={() => (error = '')}
			/>
			<label for="room-topic">Sujet (facultatif)</label>
			<input
				id="room-topic"
				type="text"
				maxlength="120"
				bind:value={topic}
				oninput={() => (error = '')}
			/>
			{#if error}<span role="alert">{error}</span>{/if}
		{:else}
			<p>Connectez-vous pour créer un salon.</p>
		{/if}
		<div class="actions">
			{#if signedIn}<button disabled={pending} onclick={create}>Créer</button>{:else}<button
					onclick={() => desktop.openLogin('signin')}>Se connecter</button
				>{/if}
			<button onclick={() => desktop.close('new-room')}>Annuler</button>
		</div>
	</div>
</XpWindow>

<style>
	.content {
		display: flex;
		flex-direction: column;
		gap: 7px;
		height: 100%;
		font:
			11px Tahoma,
			'Pixelated MS Sans Serif',
			sans-serif;
	}
	input {
		width: 100%;
		box-sizing: border-box;
		font: inherit;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 6px;
		margin-top: auto;
	}
	[role='alert'] {
		color: #a00;
	}
</style>
