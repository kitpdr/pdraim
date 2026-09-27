<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '../../../convex/_generated/api';
	import XpWindow from './xp-window.svelte';
	import { desktop } from '$lib/states/desktop.svelte';
	import { authQuery, useAimClient } from '$lib/aim/client';

	const presets = [
		'Je suis parti(e) manger',
		'Au téléphone…',
		'Parti(e) faire un tour, je reviens',
		"En cours, j'ai pas le droit d'être là 😅",
		'Je dors, laisse un message'
	];
	const me = authQuery(api.aim.getMe, () => ({}));
	const client = useAimClient();
	let text = $state('');
	let custom = $state('');
	let selected = $state('custom');
	let pending = $state(false);
	let error = $state('');
	let initialized = $state(false);

	onMount(() => {
		custom = localStorage.getItem('pdraim-away-last') ?? '';
	});
	$effect(() => {
		const data = me?.data;
		if (!initialized && data) {
			const current = data.awayMessage ?? '';
			text = current || custom;
			selected = presets.includes(current) ? current : 'custom';
			initialized = true;
		}
	});

	function selectPreset(event: Event) {
		selected = (event.currentTarget as HTMLSelectElement).value;
		text = selected === 'custom' ? custom : selected;
	}
	function editText() {
		selected = 'custom';
		custom = text;
		localStorage.setItem('pdraim-away-last', custom);
	}
	async function apply(value?: string) {
		pending = true;
		error = '';
		try {
			await client.setAwayMessage(value);
			if (value && selected === 'custom') localStorage.setItem('pdraim-away-last', value);
			desktop.close('away');
		} catch (err) {
			error = err instanceof Error ? err.message : 'Impossible de modifier le message.';
		} finally {
			pending = false;
		}
	}
</script>

<XpWindow id="away" width={360} height={340} resizableWindow={false}>
	<div class="content">
		<label for="away-preset">Messages d’absence enregistrés</label>
		<!-- Inline list box (like AIM) so the choices always stay inside the window -->
		<select
			id="away-preset"
			class="preset-list"
			size={presets.length + 1}
			value={selected}
			onchange={selectPreset}
		>
			{#each presets as preset (preset)}<option value={preset}>{preset}</option>{/each}
			<option value="custom">Personnalisé…</option>
		</select>
		<label for="away-text">Votre message</label>
		<textarea id="away-text" maxlength="300" bind:value={text} oninput={editText}></textarea>
		<small>{text.length}/300</small>
		{#if error}<span role="alert">{error}</span>{/if}
		<div class="actions">
			<button disabled={pending || !text.trim()} onclick={() => apply(text)}
				>Je suis absent(e)</button
			>
			<button disabled={pending} onclick={() => apply(undefined)}>Je suis de retour</button>
			<button onclick={() => desktop.close('away')}>Annuler</button>
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
	select,
	textarea {
		width: 100%;
		box-sizing: border-box;
		font: inherit;
	}
	.preset-list {
		height: auto;
		padding: 1px;
		background-image: none;
		border: 1px solid #7f9db9;
		overflow: hidden;
	}
	.preset-list:focus {
		background-color: #fff;
		color: inherit;
	}
	.preset-list option {
		padding: 1px 3px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.preset-list option:checked {
		background: #316ac5;
		color: #fff;
	}
	textarea {
		flex: 1;
		min-height: 60px;
		resize: none;
		border: 1px solid #7f9db9;
	}
	small {
		align-self: flex-end;
	}
	.actions {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
		justify-content: flex-end;
		margin-top: auto;
	}
	[role='alert'] {
		color: #a00;
	}
</style>
