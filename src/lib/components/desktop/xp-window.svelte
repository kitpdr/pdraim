<script lang="ts">
	/**
	 * Generic Windows XP window shell driven by the desktop window manager.
	 * Handles: drag, optional resize, focus/z-index, minimize/close buttons,
	 * mobile full-screen fallback. Content goes in the default snippet.
	 */
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { draggable } from '$lib/actions/draggable';
	import { resizable } from '$lib/actions/resizable';
	import { desktop } from '$lib/states/desktop.svelte';

	let {
		id,
		width = 420,
		height = 320,
		minWidth = 240,
		minHeight = 160,
		x,
		y,
		resizableWindow = true,
		showMaximize = false,
		bodyClass = '',
		children,
		menu,
		onClose
	} = $props<{
		id: string;
		width?: number;
		height?: number;
		minWidth?: number;
		minHeight?: number;
		x?: number;
		y?: number;
		resizableWindow?: boolean;
		showMaximize?: boolean;
		bodyClass?: string;
		children: Snippet;
		menu?: Snippet;
		onClose?: () => void;
	}>();

	const win = $derived(desktop.get(id));
	const focused = $derived(desktop.focusedId === id);

	// svelte-ignore state_referenced_locally
	let w = $state(width);
	// svelte-ignore state_referenced_locally
	let h = $state(height);
	// svelte-ignore state_referenced_locally
	let left = $state(x ?? 0);
	// svelte-ignore state_referenced_locally
	let top = $state(y ?? 0);
	let isMobile = $state(false);
	let isMaximized = $state(false);
	let restore: { w: number; h: number; left: number; top: number } | null = null;

	onMount(() => {
		isMobile = window.innerWidth <= 768;
		if (x === undefined || y === undefined) {
			// Cascade new windows slightly from the centre so they do not stack exactly
			const offset = (desktop.windows.length % 6) * 24;
			left = Math.max(8, Math.round((window.innerWidth - w) / 2) + offset);
			top = Math.max(8, Math.round((window.innerHeight - h) / 2 - 40) + offset);
		}
		const onResize = () => {
			isMobile = window.innerWidth <= 768;
		};
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	});

	function close() {
		onClose?.();
		desktop.close(id);
	}

	function minimize(e: MouseEvent) {
		e.stopPropagation();
		desktop.minimize(id);
	}

	function toggleMaximize(e?: MouseEvent) {
		e?.stopPropagation();
		if (isMobile) return;
		if (isMaximized && restore) {
			w = restore.w;
			h = restore.h;
			left = restore.left;
			top = restore.top;
			isMaximized = false;
		} else {
			restore = { w, h, left, top };
			left = 4;
			top = 4;
			w = window.innerWidth - 8;
			h = window.innerHeight - 8 - 30; // leave room for the taskbar
			isMaximized = true;
		}
	}
</script>

{#if win}
	<div
		class="window xp-window"
		class:inactive={!focused}
		class:hidden={win.minimized}
		class:mobile={isMobile}
		style="width: {w}px; height: {h}px; left: {left}px; top: {top}px; z-index: {win.z};"
		role="dialog"
		aria-label={win.title}
		tabindex="-1"
		onmousedown={() => desktop.focus(id)}
		use:draggable={{ handle: '.title-bar', enabled: !isMobile && !isMaximized }}
		ondragmove={(e) => {
			left = e.detail.x;
			top = e.detail.y;
		}}
		use:resizable={{
			enabled: resizableWindow && !isMobile && !isMaximized,
			minWidth,
			minHeight,
			maxWidth: typeof window !== 'undefined' ? window.innerWidth - 16 : 1600,
			maxHeight: typeof window !== 'undefined' ? window.innerHeight - 40 : 1200
		}}
		onresizemove={(e) => {
			w = Math.max(minWidth, e.detail.width);
			h = Math.max(minHeight, e.detail.height);
		}}
	>
		<div class="title-bar" ondblclick={() => showMaximize && toggleMaximize()} role="presentation">
			<div class="title-bar-text">
				<img src={win.icon} alt="" width="16" height="16" class="title-icon" />
				<span class="title-text">{win.title}</span>
			</div>
			<div class="title-bar-controls">
				<button aria-label="Minimize" onclick={minimize}></button>
				{#if showMaximize && !isMobile}
					<button aria-label={isMaximized ? 'Restore' : 'Maximize'} onclick={toggleMaximize}
					></button>
				{/if}
				<button aria-label="Close" onclick={close}></button>
			</div>
		</div>
		{#if menu}
			<div class="xp-menubar">{@render menu()}</div>
		{/if}
		<div class="window-body xp-body {bodyClass}" class:has-menu={Boolean(menu)}>
			{@render children()}
		</div>
	</div>
{/if}

<style>
	.xp-window {
		position: fixed;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		font-family: Tahoma, 'Pixelated MS Sans Serif', Arial, sans-serif;
		box-shadow: 2px 2px 10px rgba(0, 0, 0, 0.35);
	}

	.xp-window.hidden {
		display: none;
	}

	.xp-window.inactive {
		box-shadow: 1px 1px 4px rgba(0, 0, 0, 0.2);
	}

	/* xp.css already styles active/inactive gradients through :not(:focus-within);
	   force the inactive look based on our own focus tracking instead. */
	.xp-window.inactive .title-bar {
		background: linear-gradient(
			180deg,
			#7697e7 0%,
			#7e9ee3 8%,
			#94afec 40%,
			#97b4e9 88%,
			#82a5e4 100%
		);
	}

	.title-bar {
		cursor: move;
		user-select: none;
		display: flex;
		align-items: center;
		flex: 0 0 auto;
	}

	.title-bar-text {
		display: flex;
		align-items: center;
		gap: 4px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	.title-text {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.title-icon {
		flex: 0 0 16px;
	}

	.xp-menubar {
		display: flex;
		gap: 2px;
		padding: 1px 4px;
		background: #ece9d8;
		border-bottom: 1px solid #aca899;
		font-size: 11px;
		flex: 0 0 auto;
	}

	.xp-menubar :global(button) {
		border: 1px solid transparent;
		background: transparent;
		box-shadow: none;
		min-width: 0;
		padding: 2px 6px;
		font-size: 11px;
		border-radius: 0;
	}

	.xp-menubar :global(button:hover) {
		background: #316ac5;
		color: white;
	}

	.xp-body {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 6px;
		overflow: hidden;
	}

	:global(.xp-window .resize-handle) {
		position: absolute;
		bottom: 0;
		right: 0;
		width: 15px !important;
		height: 15px !important;
		cursor: se-resize !important;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='15' height='15'%3E%3Cpath d='M11 11v-2h2v2h-2zm0-4h2v2h-2V7zm-2 2V7h2v2H9zm0 2v-2h2v2H9zm-2 0v-2h2v2H7z' fill='%23555'/%3E%3C/svg%3E");
		background-position: bottom right;
		background-repeat: no-repeat;
	}

	@media (max-width: 768px) {
		.xp-window.mobile {
			left: 0 !important;
			top: 0 !important;
			width: 100vw !important;
			height: calc(100vh - 30px) !important;
			border-radius: 0;
		}
	}
</style>
