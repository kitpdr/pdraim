<script lang="ts">
	import ChatRoom from '../chat-room.svelte';
	import XpWindow from './xp-window.svelte';
	import { desktop, CHAT_WINDOW_ID } from '$lib/states/desktop.svelte';
	import { chatState } from '$lib/states/chat.svelte';
	import type { TextStyle } from '$lib/types/text-formatting';
	import { useQuery } from 'convex-svelte';
	import { api } from '../../../convex/_generated/api';
	import { convexAvailable } from '$lib/aim/client';

	let { initialTextStyle }: { initialTextStyle?: TextStyle } = $props();

	const currentUser = $derived(chatState.getCurrentUser());
	let showUserList = $state(false);

	// Room topics show as tab tooltips
	const roomsQuery = convexAvailable ? useQuery(api.aim.getGroupRooms, {}) : null;
	const topicOf = (roomId: string | null) =>
		roomsQuery?.data?.find((r) => (roomId ? r.id === roomId : r.isDefault))?.topic;

	const tabKey = (roomId: string | null) => roomId ?? 'default';
</script>

<XpWindow
	id={CHAT_WINDOW_ID}
	width={800}
	height={600}
	minWidth={420}
	minHeight={420}
	showMaximize
	bodyClass="chat-rooms-body"
>
	{#snippet menu()}
		<button type="button" onclick={() => desktop.openBuddyList()}>Contacts</button>
		<button type="button" onclick={() => desktop.openNewRoom()}>Nouveau salon</button>
		<button type="button" onclick={() => (showUserList = !showUserList)}>Participants</button>
		{#if !currentUser}
			<button type="button" onclick={() => desktop.openLogin('signin')}>Se connecter</button>
		{/if}
	{/snippet}

	<menu role="tablist" class="room-tabs">
		{#each desktop.roomTabs as tab (tabKey(tab.roomId))}
			{@const active = tab.roomId === desktop.activeRoomId}
			<button
				type="button"
				role="tab"
				aria-selected={active}
				aria-controls="room-panel-{tabKey(tab.roomId)}"
				title={topicOf(tab.roomId) ?? tab.roomName}
				onclick={() => desktop.selectRoomTab(tab.roomId)}
				onauxclick={(e) => {
					if (e.button === 1 && desktop.roomTabs.length > 1) desktop.closeRoomTab(tab.roomId);
				}}
			>
				<img src="/aim/chat-room-16.png" alt="" width="14" height="14" />
				<span>{tab.roomName}</span>
				{#if desktop.roomTabs.length > 1}
					<span
						class="tab-close"
						role="button"
						tabindex="-1"
						aria-label="Fermer {tab.roomName}"
						onclick={(e) => {
							e.stopPropagation();
							desktop.closeRoomTab(tab.roomId);
						}}
						onkeydown={() => {}}>×</span
					>
				{/if}
			</button>
		{/each}
	</menu>

	<div class="tab-panels">
		{#each desktop.roomTabs as tab (tabKey(tab.roomId))}
			<!-- Every open room stays mounted so switching tabs keeps scroll and draft -->
			<div
				id="room-panel-{tabKey(tab.roomId)}"
				role="tabpanel"
				class="tab-panel"
				hidden={tab.roomId !== desktop.activeRoomId}
			>
				<ChatRoom roomId={tab.roomId} {initialTextStyle} {showUserList} />
			</div>
		{/each}
	</div>
</XpWindow>

<style>
	.room-tabs {
		flex: 0 0 auto;
		margin-top: 2px;
	}

	.room-tabs button {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px 3px;
		font:
			11px Tahoma,
			'Pixelated MS Sans Serif',
			sans-serif;
		max-width: 180px;
	}

	.room-tabs button span:first-of-type {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tab-close {
		margin-left: 2px;
		padding: 0 3px;
		line-height: 12px;
		color: #555;
		cursor: default;
	}

	.tab-close:hover {
		background: #c75050;
		color: #fff;
	}

	.tab-panels {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
		background: #fcfcfe;
		border: 1px solid #919b9c;
		padding: 4px;
		position: relative;
		z-index: 2;
	}

	/* xp.css frames every [role=tabpanel]; the outer .tab-panels is the frame here */
	.tab-panel {
		padding: 0;
		margin: 0;
		border: 0;
		background: transparent;
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.tab-panel[hidden] {
		display: none;
	}
</style>
