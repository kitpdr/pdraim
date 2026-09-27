<script lang="ts">
	import { onMount } from 'svelte';
	import XpWindow from './xp-window.svelte';
	import { desktop } from '$lib/states/desktop.svelte';
	import {
		soundsEnabled,
		setSoundsEnabled,
		playSound,
		unlockAudio,
		type AimSound
	} from '$lib/aim/sounds';

	const sounds: { label: string; name: AimSound }[] = [
		{ label: "Porte qui s'ouvre", name: 'doorOpen' },
		{ label: 'Porte qui claque', name: 'doorSlam' },
		{ label: 'Message reçu', name: 'imReceive' },
		{ label: 'Message envoyé', name: 'imSend' },
		{ label: 'Bienvenue', name: 'welcome' },
		{ label: 'Modem 56k', name: 'modem' }
	];
	let soundOn = $state(true);
	let timestamps = $state(true);
	onMount(() => {
		soundOn = soundsEnabled();
		timestamps = localStorage.getItem('pdraim-show-timestamps') !== 'false';
	});
	function changeSound() {
		setSoundsEnabled(soundOn);
		if (soundOn) unlockAudio();
	}
	function changeTimestamps() {
		localStorage.setItem('pdraim-show-timestamps', String(timestamps));
	}
</script>

<XpWindow id="preferences" width={380} height={320} resizableWindow={false}>
	<div class="content">
		<label
			><input type="checkbox" bind:checked={soundOn} onchange={changeSound} /> Sons activés (porte, ding…)</label
		>
		<div class="sound-list">
			{#each sounds as sound (sound.name)}
				<div class="sound-row">
					<span>{sound.label}</span><button
						disabled={!soundOn}
						onclick={() => {
							unlockAudio();
							playSound(sound.name);
						}}>Tester</button
					>
				</div>
			{/each}
		</div>
		<label
			><input type="checkbox" bind:checked={timestamps} onchange={changeTimestamps} /> Afficher les horodatages</label
		>
		<div class="actions"><button onclick={() => desktop.close('preferences')}>Fermer</button></div>
	</div>
</XpWindow>

<style>
	.content {
		display: flex;
		flex-direction: column;
		gap: 8px;
		height: 100%;
		overflow: auto;
		font:
			11px Tahoma,
			'Pixelated MS Sans Serif',
			sans-serif;
	}
	.sound-list {
		display: grid;
		gap: 3px;
	}
	.sound-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.actions {
		margin-top: auto;
		align-self: flex-end;
	}
</style>
