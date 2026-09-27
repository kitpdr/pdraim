<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import ChatRoom from '$lib/components/chat-room.svelte';
	import DesktopIcons from '$lib/components/desktop-icons.svelte';
	import Taskbar from '$lib/components/desktop/taskbar.svelte';
	import BuddyList from '$lib/components/desktop/buddy-list.svelte';
	import ImWindow from '$lib/components/desktop/im-window.svelte';
	import SignOnWindow from '$lib/components/desktop/sign-on-window.svelte';
	import ProfileWindow from '$lib/components/desktop/profile-window.svelte';
	import AwayWindow from '$lib/components/desktop/away-window.svelte';
	import NewRoomWindow from '$lib/components/desktop/new-room-window.svelte';
	import AboutWindow from '$lib/components/desktop/about-window.svelte';
	import PreferencesWindow from '$lib/components/desktop/preferences-window.svelte';
	import {
		desktop,
		type ChatRoomWindowProps,
		type ImWindowProps,
		type ProfileWindowProps
	} from '$lib/states/desktop.svelte';
	import { chatState } from '$lib/states/chat.svelte';

	const props = $props();
	const pageData = $derived(props.data);

	const currentUser = $derived(chatState.getCurrentUser());

	// Initial desktop layout: the General room, plus the buddy list when signed in.
	onMount(() => {
		if (!browser) return;
		desktop.openChatRoom(null, 'General');
		if (pageData.user) {
			desktop.openBuddyList();
		} else {
			desktop.openLogin('signin');
		}
		desktop.focus('room-default');
	});

	// When the session appears (login) make sure the buddy list is around;
	// when it disappears (logout) close private windows.
	let lastUserId: string | null = null;
	$effect(() => {
		const id = currentUser?.id ?? null;
		if (id === lastUserId) return;
		lastUserId = id;
		if (id) {
			if (!desktop.has('buddy-list')) desktop.openBuddyList();
		} else {
			for (const w of desktop.windows) {
				if (w.kind === 'im' || w.kind === 'buddy-list' || w.kind === 'away') desktop.close(w.id);
			}
		}
	});

	function onDesktopClick(e: MouseEvent) {
		if (e.target === e.currentTarget) desktop.blurAll();
	}
</script>

<div
	class="desktop"
	class:signing-on={desktop.signingOn}
	onmousedown={onDesktopClick}
	role="presentation"
>
	<DesktopIcons />

	{#each desktop.windows as win (win.id)}
		{#if win.kind === 'chat-room'}
			{@const p = win.props as unknown as ChatRoomWindowProps}
			<ChatRoom roomId={p.roomId} roomName={p.roomName} initialTextStyle={pageData.textStyle} />
		{:else if win.kind === 'buddy-list'}
			<BuddyList />
		{:else if win.kind === 'im'}
			{@const p = win.props as unknown as ImWindowProps}
			<ImWindow roomId={p.roomId} otherUserId={p.otherUserId} otherNickname={p.otherNickname} />
		{:else if win.kind === 'login'}
			<SignOnWindow tab={(win.props.tab as 'signin' | 'signup') ?? 'signin'} />
		{:else if win.kind === 'profile'}
			{@const p = win.props as unknown as ProfileWindowProps}
			<ProfileWindow userId={p.userId} nickname={p.nickname} />
		{:else if win.kind === 'away'}
			<AwayWindow />
		{:else if win.kind === 'new-room'}
			<NewRoomWindow />
		{:else if win.kind === 'about'}
			<AboutWindow />
		{:else if win.kind === 'preferences'}
			<PreferencesWindow />
		{/if}
	{/each}

	<Taskbar />
</div>

<style>
	.desktop {
		position: absolute;
		inset: 0;
		box-sizing: border-box;
		overflow: hidden;
	}
</style>
