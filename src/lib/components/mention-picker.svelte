<script lang="ts">
	import type { SafeUser } from '../types/chat';

	// Props
	let {
		suggestions,
		selectedIndex,
		activeId,
		listBoxId,
		listStyle,
		isPortal = false,
		emptyMessage = 'Aucun utilisateur',
		onSelect,
		onMouseDown
	} = $props<{
		suggestions: SafeUser[];
		selectedIndex: number;
		activeId: string | null;
		listBoxId: string;
		listStyle: string;
		isPortal?: boolean;
		emptyMessage?: string;
		onSelect: (user: SafeUser) => void;
		onMouseDown?: (event: MouseEvent) => void;
	}>();

	// Generate option ID from user ID
	function getOptionId(userId: string): string {
		return `${listBoxId}-${userId}`;
	}

	function handleOptionMouseDown(event: MouseEvent, user: SafeUser) {
		event.preventDefault();
		onSelect(user);
	}

	function handleContainerMouseDown(event: MouseEvent) {
		event.preventDefault();
		onMouseDown?.(event);
	}
</script>

<div
	id={listBoxId}
	class="mention-picker"
	class:mention-picker-portal={isPortal}
	role="listbox"
	aria-label="Suggestions de mentions"
	aria-activedescendant={activeId}
	tabindex="-1"
	style={`z-index: ${isPortal ? 3000 : 10}; ${listStyle}`}
	onmousedown={handleContainerMouseDown}
>
	{#if suggestions.length > 0}
		{#each suggestions as user, index (user.id)}
			<div
				id={getOptionId(user.id)}
				role="option"
				class="mention-option"
				class:selected={index === selectedIndex}
				aria-selected={index === selectedIndex}
				tabindex="-1"
				onmousedown={(event) => handleOptionMouseDown(event, user)}
			>
				<span class="mention-name">{user.nickname}</span>
				<span class="mention-status {user.status}">{user.status}</span>
			</div>
		{/each}
	{:else}
		<div
			class="mention-empty"
			role="option"
			aria-disabled="true"
			aria-selected="false"
			tabindex="-1"
		>
			{emptyMessage}
		</div>
	{/if}
</div>

<style>
	.mention-picker {
		position: absolute;
		padding: 0.35rem;
		max-height: 220px;
		overflow-y: auto;
		background: #fffef5;
		border: 2px inset #dfdfdf;
		box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.15);
		font-family: 'Pixelated MS Sans Serif', Tahoma, sans-serif;
		font-size: 0.85rem;
		min-width: 220px;
	}

	.mention-picker-portal {
		position: fixed;
	}

	.mention-option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.25rem 0.4rem;
		border: 1px solid transparent;
		cursor: pointer;
	}

	.mention-option.selected {
		background: #dbe8ff;
		border-color: #2d31a6;
	}

	.mention-name {
		font-weight: bold;
		color: #1e2a72;
	}

	.mention-status {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #5b5b5b;
	}

	.mention-status.online {
		color: #1f7a1f;
	}

	.mention-status.away,
	.mention-status.busy {
		color: #b06a00;
	}

	.mention-status.offline {
		color: #8a8a8a;
	}

	.mention-empty {
		padding: 0.35rem 0.5rem;
		color: #777;
		font-style: italic;
	}
</style>
