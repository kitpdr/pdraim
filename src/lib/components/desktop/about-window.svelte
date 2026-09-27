<script lang="ts">
	import XpWindow from './xp-window.svelte';
	import { desktop } from '$lib/states/desktop.svelte';
</script>

<XpWindow id="about" width={360} height={260} resizableWindow={false}>
	<div class="content">
		<img src="/aim/running-man.svg" alt="" width="48" height="48" />
		<h2>PDR AIM</h2>
		<p>v0.3.0</p>
		<p>
			Un bac à sable associatif et sans but lucratif, pour retrouver l’époque des salons de
			discussion AOL/AIM.
		</p>
		<p>Un petit coin de nostalgie pour les anciens habitués.</p>
		<a href="https://pdraim.org" target="_blank" rel="noopener noreferrer">pdraim.org</a>
		<div class="actions"><button onclick={() => desktop.close('about')}>OK</button></div>
	</div>
</XpWindow>

<style>
	.content {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 4px;
		height: 100%;
		overflow: auto;
		font:
			11px Tahoma,
			'Pixelated MS Sans Serif',
			sans-serif;
	}
	h2,
	p {
		margin: 0;
	}
	h2 {
		font-size: 18px;
	}
	.actions {
		margin-top: auto;
		align-self: flex-end;
	}
</style>
