<script lang="ts">
	import {
		RETRO_FONTS,
		DEFAULT_TEXT_STYLE,
		type TextStyle,
		type FontFamily
	} from '../types/text-formatting';
	import ColorPicker256 from './color-picker-256.svelte';
	import { SMILEYS } from '$lib/aim/smileys';

	// Props
	let {
		style = $bindable(DEFAULT_TEXT_STYLE),
		compact = true,
		showFontSelector = false,
		onSmiley
	} = $props<{
		style?: TextStyle;
		compact?: boolean;
		showFontSelector?: boolean;
		/** When set, shows the AIM smiley picker and inserts the chosen code */
		onSmiley?: (code: string) => void;
	}>();

	let smileyOpen = $state(false);

	// State
	let currentColor = $state(style.color || '#000000');
	let currentGradient = $state(style.gradient);

	// Toggle functions
	function toggleBold() {
		style = { ...style, bold: !style.bold };
	}

	function toggleItalic() {
		style = { ...style, italic: !style.italic };
	}

	function toggleUnderline() {
		style = { ...style, underline: !style.underline };
	}

	function handleColorChange(color: string) {
		currentColor = color;
		style = { ...style, color, gradient: undefined };
	}

	function handleGradientChange(gradient: string[]) {
		currentGradient = gradient;
		style = { ...style, gradient, color: gradient[0] };
	}

	function selectFont(fontFamily: FontFamily) {
		style = { ...style, fontFamily };
	}

	// Keyboard shortcuts handler
	function handleKeydown(event: KeyboardEvent) {
		if (event.ctrlKey || event.metaKey) {
			switch (event.key.toLowerCase()) {
				case 'b':
					event.preventDefault();
					toggleBold();
					break;
				case 'i':
					event.preventDefault();
					toggleItalic();
					break;
				case 'u':
					event.preventDefault();
					toggleUnderline();
					break;
			}
		}
	}

	// Update internal state when style prop changes
	$effect(() => {
		currentColor = style.color || '#000000';
		currentGradient = style.gradient;
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="text-formatting-toolbar sunken-panel" class:compact>
	<!-- Font selector (if enabled) -->
	{#if showFontSelector}
		<select
			value={style.fontFamily}
			onchange={(e) => selectFont((e.target as HTMLSelectElement).value as FontFamily)}
			title="Font Family"
		>
			{#each Object.entries(RETRO_FONTS) as [key, font] (key)}
				<option value={key}>{font.shortName}</option>
			{/each}
		</select>
	{/if}

	<!-- Size slider -->
	<div class="size-control">
		<input
			type="range"
			min="8"
			max="18"
			bind:value={style.fontSize}
			class="size-slider"
			title="Font Size: {style.fontSize}px"
		/>
		<span class="size-display">{style.fontSize}</span>
	</div>

	<!-- Style toggle buttons -->
	<div class="style-toggles">
		<button
			onclick={toggleBold}
			title="Bold (Ctrl+B)"
			style="width: 20px; height: 20px; padding: 0; font-size: 10px;"
		>
			<strong>B</strong>
		</button>

		<button
			onclick={toggleItalic}
			title="Italic (Ctrl+I)"
			style="width: 20px; height: 20px; padding: 0; font-size: 10px;"
		>
			<em>I</em>
		</button>

		<button
			onclick={toggleUnderline}
			title="Underline (Ctrl+U)"
			style="width: 20px; height: 20px; padding: 0; font-size: 10px;"
		>
			<u>U</u>
		</button>
	</div>

	{#if onSmiley}
		<div class="smiley-control">
			<button
				type="button"
				title="Smileys"
				aria-haspopup="true"
				aria-expanded={smileyOpen}
				onclick={() => (smileyOpen = !smileyOpen)}
				class="smiley-trigger"
			>
				<img src="/smileys/01.gif" alt="🙂" width="15" height="15" />
			</button>
			{#if smileyOpen}
				<div class="smiley-picker" role="menu">
					{#each SMILEYS as smiley (smiley.file)}
						<button
							type="button"
							role="menuitem"
							title="{smiley.label}  {smiley.codes[0]}"
							onclick={() => {
								smileyOpen = false;
								onSmiley(smiley.codes[0]);
							}}
						>
							<img src="/smileys/{smiley.file}.gif" alt={smiley.emoji} width="19" height="19" />
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Color controls -->
	<div class="color-controls">
		<ColorPicker256
			bind:selectedColor={currentColor}
			bind:selectedGradient={currentGradient}
			onColorChange={handleColorChange}
			onGradientChange={handleGradientChange}
		/>
	</div>
</div>

<style>
	.text-formatting-toolbar {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 2px;
		font-size: 11px;
		position: relative;
		flex-wrap: wrap;
	}

	.size-control {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.size-slider {
		width: 50px;
		height: 12px;
	}

	.size-display {
		font-size: 9px;
		color: #666;
		min-width: 18px;
		text-align: center;
	}

	.style-toggles {
		display: flex;
		gap: 1px;
	}

	/* xp.css gives every button min-width: 75px; keep toolbar buttons square */
	.style-toggles button,
	.color-controls :global(.color-picker-container > button) {
		width: 22px !important;
		height: 20px !important;
		min-width: 0;
		min-height: 0;
		padding: 0 !important;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.smiley-control {
		position: relative;
		display: flex;
	}
	.smiley-trigger {
		width: 24px;
		height: 20px;
		min-width: 0;
		min-height: 0;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		line-height: 0;
	}
	.smiley-control img {
		display: block;
		image-rendering: pixelated;
	}
	.smiley-picker {
		position: absolute;
		bottom: calc(100% + 2px);
		left: 0;
		z-index: 60;
		display: grid;
		grid-template-columns: repeat(4, 25px);
		gap: 1px;
		padding: 3px;
		background: #fff;
		border: 1px solid #7f9db9;
		box-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
	}
	.smiley-picker button {
		width: 25px;
		height: 25px;
		min-width: 0;
		min-height: 0;
		padding: 0;
		background: transparent;
		box-shadow: none;
		border: 1px solid transparent;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.smiley-picker button:hover {
		border-color: #316ac5;
		background: #e8eefb;
	}
	.color-controls {
		display: flex;
		gap: 1px;
	}

	/* Fix font dropdown text alignment and overflow */
	select {
		height: 20px;
		line-height: 1;
		vertical-align: middle;
		padding: 1px 21px 1px 4px;
		font-size: 11px;
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	select option {
		padding: 2px 4px;
		line-height: normal;
		font-family: inherit;
	}
</style>
