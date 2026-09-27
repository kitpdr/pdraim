<script lang="ts">
	import { useQuery } from 'convex-svelte';
	import { api } from '../../../convex/_generated/api';
	import type { Id } from '../../../convex/_generated/dataModel';
	import XpWindow from './xp-window.svelte';
	import { desktop } from '$lib/states/desktop.svelte';
	import { chatState } from '$lib/states/chat.svelte';
	import { useAimClient } from '$lib/aim/client';
	import { STATUS_LABELS_FR } from '$lib/types/aim';
	import { formatFrenchDateTime } from '$lib/utils/date-format';

	let { userId, nickname } = $props<{ userId: Id<'users'>; nickname: string }>();
	const id = $derived(`profile-${userId}`);
	const profileQuery = useQuery(api.aim.getUserProfile, () => ({ userId }));
	const client = useAimClient();
	const profile = $derived(profileQuery.data);
	const own = $derived(userId === chatState.getCurrentUser()?.id);
	let text = $state('');
	let saved = $state(false);
	let saving = $state(false);
	let error = $state('');
	let initializedFor = $state<string | null>(null);
	$effect(() => {
		if (profile && initializedFor !== userId) {
			text = profile.profile ?? '';
			initializedFor = userId;
		}
	});

	async function save() {
		saving = true;
		saved = false;
		error = '';
		try {
			await client.updateProfile({ profile: text });
			saved = true;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Impossible d’enregistrer.';
		} finally {
			saving = false;
		}
	}
</script>

<XpWindow {id} width={380} height={400} minWidth={300} minHeight={260}>
	<div class="profile-content">
		{#if profile}
			<div class="identity">
				<img class="buddy-icon" src="/aim/running-man-48.png" alt="" width="48" height="48" />
				<div>
					<strong>{profile.nickname}</strong>
					<div class="status">
						<img
							src={`/aim/status-${profile.status}.svg`}
							alt=""
							width="16"
							height="16"
						/>{STATUS_LABELS_FR[profile.status]}
					</div>
					{#if profile.createdAt}<small
							>Membre depuis {formatFrenchDateTime(new Date(profile.createdAt))}</small
						>{/if}
				</div>
			</div>
			{#if profile.awayMessage}<div class="away-message">{profile.awayMessage}</div>{/if}
			<label for="profile-text">Profil</label>
			{#if own}
				<textarea
					id="profile-text"
					class="sunken-panel"
					maxlength="1000"
					bind:value={text}
					oninput={() => (saved = false)}
				></textarea>
				<small>{text.length}/1000</small>
			{:else}
				<div id="profile-text" class="sunken-panel profile-text">
					{profile.profile ?? 'Aucun profil pour le moment.'}
				</div>
			{/if}
		{:else if profile === null}
			<p>Profil introuvable : {nickname}</p>
		{:else}
			<p>Chargement du profil…</p>
		{/if}
		<div class="actions">
			{#if error}<span role="alert">{error}</span>{/if}
			{#if saved}<span role="status">Enregistré ✓</span>{/if}
			{#if own && profile}<button disabled={saving || text.length > 1000} onclick={save}
					>Enregistrer</button
				>{/if}
			<button onclick={() => desktop.close(id)}>Fermer</button>
		</div>
	</div>
</XpWindow>

<style>
	.profile-content {
		display: flex;
		flex-direction: column;
		gap: 6px;
		height: 100%;
		overflow: auto;
		font:
			11px Tahoma,
			'Pixelated MS Sans Serif',
			sans-serif;
	}
	.identity {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.buddy-icon {
		flex: 0 0 48px;
	}
	.status {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.away-message {
		border: 1px solid #d0c7a0;
		background: #fff9dc;
		padding: 6px;
		white-space: pre-wrap;
	}
	.sunken-panel {
		background: white;
		padding: 5px;
		box-sizing: border-box;
		width: 100%;
		min-height: 65px;
		font: inherit;
	}
	.profile-text {
		flex: 1;
		overflow: auto;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	textarea {
		resize: vertical;
	}
	.actions {
		margin-top: auto;
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 6px;
	}
	.actions span[role='alert'] {
		color: #a00;
	}
</style>
