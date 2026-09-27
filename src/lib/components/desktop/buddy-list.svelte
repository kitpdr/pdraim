<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet, SvelteMap } from 'svelte/reactivity';
	import { useQuery } from 'convex-svelte';
	import { api } from '../../../convex/_generated/api';
	import type { Id } from '../../../convex/_generated/dataModel';
	import type { Buddy, AimStatus } from '$lib/types/aim';
	import { DEFAULT_BUDDY_GROUPS, STATUS_LABELS_FR } from '$lib/types/aim';
	import { playSound } from '$lib/aim/sounds';
	import { authQuery, useAimClient, convexAvailable } from '$lib/aim/client';
	import { chatState } from '$lib/states/chat.svelte';
	import { desktop } from '$lib/states/desktop.svelte';
	import XpWindow from './xp-window.svelte';
	import { browser } from '$app/environment';

	// Dock top-right like the real AIM buddy list, with breathing room above and
	// above the taskbar (30px) below.
	const BUDDY_LIST_WIDTH = 230;
	const buddyListHeight = browser
		? Math.max(360, Math.min(520, window.innerHeight - 30 - 2 * 40))
		: 520;

	const aim = useAimClient();
	const buddyQuery = authQuery(api.aim.getMyBuddies, () => ({}));
	const directQuery = authQuery(api.aim.getMyDirectRooms, () => ({}));
	const meQuery = authQuery(api.aim.getMe, () => ({}));
	const roomsQuery = convexAvailable ? useQuery(api.aim.getGroupRooms, {}) : null;
	const usersQuery = convexAvailable ? useQuery(api.queries.getUsersPublic, {}) : null;
	const me = $derived(chatState.getCurrentUser());
	const buddies = $derived(buddyQuery?.data ?? []);
	const collapsed = new SvelteSet<string>();
	const flashing = new SvelteSet<string>();
	let selectedId = $state<Id<'users'> | null>(null);
	let editMode = $state(false);
	let panel = $state<'im' | 'add' | null>(null);
	let nickname = $state('');
	let addId = $state('');
	let addGroup = $state<string>('Buddies');
	let customGroup = $state('');
	let error = $state('');
	let dropdownMenu = $state<'aim' | 'contacts' | 'help' | null>(null);
	let context = $state<{ buddy: Buddy; x: number; y: number } | null>(null);
	let menuBar: HTMLDivElement;
	let contextElement = $state<HTMLDivElement>();
	let previous = new SvelteMap<string, AimStatus>();
	let initialized = false;
	const timers = new SvelteMap<string, ReturnType<typeof setTimeout>>();

	const sortedGroups = $derived.by(() => {
		const groups = new SvelteMap<string, Buddy[]>();
		for (const name of DEFAULT_BUDDY_GROUPS) groups.set(name, []);
		for (const buddy of buddies) {
			const name = buddy.group || 'Buddies';
			if (!groups.has(name)) groups.set(name, []);
			if (buddy.status !== 'offline') groups.get(name)!.push(buddy);
		}
		const rank: Record<AimStatus, number> = { online: 0, away: 1, idle: 2, busy: 3, offline: 4 };
		return [...groups.entries()]
			.sort(([a], [b]) => {
				const ai = DEFAULT_BUDDY_GROUPS.indexOf(a as (typeof DEFAULT_BUDDY_GROUPS)[number]);
				const bi = DEFAULT_BUDDY_GROUPS.indexOf(b as (typeof DEFAULT_BUDDY_GROUPS)[number]);
				return ai !== -1 && bi !== -1
					? ai - bi
					: ai !== -1
						? -1
						: bi !== -1
							? 1
							: a.localeCompare(b);
			})
			.map(([name, members]) => ({
				name,
				members: members.sort(
					(a, b) => rank[a.status] - rank[b.status] || a.nickname.localeCompare(b.nickname)
				),
				total: buddies.filter((b) => (b.group || 'Buddies') === name).length
			}));
	});
	const offline = $derived(
		buddies
			.filter((b) => b.status === 'offline')
			.sort((a, b) => a.nickname.localeCompare(b.nickname))
	);
	const availableUsers = $derived(
		(usersQuery?.data ?? [])
			.filter((u) => u.id !== me?.id && !buddies.some((b) => b.id === u.id))
			.sort((a, b) => a.nickname.localeCompare(b.nickname))
	);
	const selectedBuddy = $derived(buddies.find((b) => b.id === selectedId));

	onMount(() => {
		try {
			const stored = JSON.parse(localStorage.getItem('pdraim-buddylist-collapsed') ?? '[]');
			if (Array.isArray(stored))
				for (const name of stored) if (typeof name === 'string') collapsed.add(name);
		} catch {
			/* Ignore malformed saved preferences. */
		}
		return () => {
			for (const timer of timers.values()) clearTimeout(timer);
		};
	});

	$effect(() => {
		const data = buddyQuery?.data;
		if (!me || !data) {
			previous = new SvelteMap<string, AimStatus>();
			initialized = false;
			return;
		}
		const next = new SvelteMap<string, AimStatus>();
		for (const buddy of data) {
			next.set(buddy.id, buddy.status);
			const old = previous.get(buddy.id);
			if (!initialized || old === undefined || old === buddy.status) continue;
			if (old === 'offline' && buddy.status !== 'offline') {
				playSound('doorOpen');
				flashing.add(buddy.id);
				const existing = timers.get(buddy.id);
				if (existing) clearTimeout(existing);
				timers.set(
					buddy.id,
					setTimeout(() => {
						flashing.delete(buddy.id);
						timers.delete(buddy.id);
					}, 1500)
				);
			} else if (old !== 'offline' && buddy.status === 'offline') playSound('doorSlam');
		}
		previous = next;
		initialized = true;
	});

	function toggleGroup(name: string) {
		if (collapsed.has(name)) collapsed.delete(name);
		else collapsed.add(name);
		localStorage.setItem('pdraim-buddylist-collapsed', JSON.stringify([...collapsed]));
	}
	function openPanel(which: 'im' | 'add') {
		panel = panel === which ? null : which;
		error = '';
		dropdownMenu = null;
	}
	async function openIm(id: Id<'users'>, name: string) {
		try {
			const room = await aim.getOrCreateDirectRoom(id);
			desktop.openIm({ roomId: room.id, otherUserId: id, otherNickname: name });
			panel = null;
		} catch {
			error = 'Impossible d’ouvrir la conversation.';
		}
	}
	async function startIm() {
		const user = usersQuery?.data?.find(
			(u) => u.nickname.toLocaleLowerCase() === nickname.trim().toLocaleLowerCase()
		);
		if (!user) {
			error = 'Pseudo introuvable.';
			return;
		}
		await openIm(user.id, user.nickname);
	}
	async function addBuddy() {
		const user = availableUsers.find((u) => u.id === addId);
		const group = addGroup === 'Autre…' ? customGroup.trim() : addGroup;
		if (!user || !group) {
			error = 'Choisissez un contact et un groupe.';
			return;
		}
		try {
			await aim.addBuddy(user.id, group);
			panel = null;
			addId = '';
			error = '';
		} catch {
			error = 'Impossible d’ajouter ce contact.';
		}
	}
	async function removeBuddy(id: Id<'users'>) {
		context = null;
		try {
			await aim.removeBuddy(id);
			if (selectedId === id) selectedId = null;
		} catch {
			error = 'Impossible de retirer ce contact.';
		}
	}
	function showContext(event: MouseEvent, buddy: Buddy) {
		event.preventDefault();
		selectedId = buddy.id;
		dropdownMenu = null;
		context = {
			buddy,
			x: Math.min(event.clientX, window.innerWidth - 190),
			y: Math.min(event.clientY, window.innerHeight - 95)
		};
	}
	function outside(event: MouseEvent) {
		const target = event.target as Node;
		if (dropdownMenu && !menuBar?.contains(target)) dropdownMenu = null;
		if (context && !contextElement?.contains(target)) context = null;
	}
	function escape(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			dropdownMenu = null;
			context = null;
			panel = null;
		}
	}
	async function logout() {
		dropdownMenu = null;
		try {
			await fetch('/api/session/logout', { method: 'POST' });
			window.location.reload();
		} catch {
			error = 'Déconnexion impossible.';
		}
	}
	function tooltip(buddy: Buddy) {
		return `${STATUS_LABELS_FR[buddy.status]}${buddy.status === 'offline' && buddy.lastSeen ? ` — Dernière visite : ${new Date(buddy.lastSeen).toLocaleString('fr-FR')}` : ''}`;
	}
</script>

<svelte:window onclick={outside} onkeydown={escape} />

{#snippet buddyRow(buddy: Buddy)}
	<div class="row" class:selected={selectedId === buddy.id} class:flash={flashing.has(buddy.id)}>
		<button
			class="row-action"
			class:offline={buddy.status === 'offline'}
			class:away={buddy.status === 'away'}
			title={tooltip(buddy)}
			onclick={() => (selectedId = buddy.id)}
			ondblclick={() => openIm(buddy.id, buddy.nickname)}
			oncontextmenu={(e) => showContext(e, buddy)}
		>
			<img src={`/aim/status-${buddy.status}.svg`} alt="" width="12" height="12" />
			<span class="truncate">{buddy.nickname}{buddy.status === 'idle' ? ' (Inactif)' : ''}</span>
			{#if buddy.status === 'away'}<img
					src="/aim/xp-note-16.png"
					alt=""
					width="12"
					height="12"
				/>{/if}
		</button>
		{#if editMode}<button
				class="remove"
				aria-label={`Retirer ${buddy.nickname}`}
				title={`Retirer ${buddy.nickname}`}
				onclick={() => removeBuddy(buddy.id)}>✕</button
			>{/if}
	</div>
{/snippet}

<XpWindow
	id="buddy-list"
	width={BUDDY_LIST_WIDTH}
	height={buddyListHeight}
	minWidth={BUDDY_LIST_WIDTH}
	showMaximize={false}
	x={browser ? Math.max(8, window.innerWidth - BUDDY_LIST_WIDTH - 24) : undefined}
	y={browser ? 40 : undefined}
>
	{#snippet menu()}
		<div class="menus" bind:this={menuBar}>
			<div class="menu-wrap">
				<button
					aria-expanded={dropdownMenu === 'aim'}
					onclick={() => (dropdownMenu = dropdownMenu === 'aim' ? null : 'aim')}>Mon AIM</button
				>
				{#if dropdownMenu === 'aim'}<div class="dropdown">
						<button
							onclick={() => {
								dropdownMenu = null;
								desktop.openAway();
							}}>Message d’absence…</button
						>
						<button
							disabled={!me}
							onclick={() => {
								dropdownMenu = null;
								if (me)
									desktop.openProfile({ userId: me.id as Id<'users'>, nickname: me.nickname });
							}}>Modifier mon profil…</button
						>
						<button
							onclick={() => {
								dropdownMenu = null;
								desktop.openPreferences();
							}}>Préférences…</button
						>
						<hr />
						<button onclick={logout}>Se déconnecter</button>
					</div>{/if}
			</div>
			<div class="menu-wrap">
				<button
					aria-expanded={dropdownMenu === 'contacts'}
					onclick={() => (dropdownMenu = dropdownMenu === 'contacts' ? null : 'contacts')}
					>Contacts</button
				>
				{#if dropdownMenu === 'contacts'}<div class="dropdown">
						<button onclick={() => openPanel('add')}>Ajouter un contact…</button><button
							onclick={() => {
								dropdownMenu = null;
								desktop.openNewRoom();
							}}>Nouveau salon…</button
						>
					</div>{/if}
			</div>
			<div class="menu-wrap">
				<button
					aria-expanded={dropdownMenu === 'help'}
					onclick={() => (dropdownMenu = dropdownMenu === 'help' ? null : 'help')}>Aide</button
				>
				{#if dropdownMenu === 'help'}<div class="dropdown">
						<button
							onclick={() => {
								dropdownMenu = null;
								desktop.openAbout();
							}}>À propos de PDR AIM</button
						>
					</div>{/if}
			</div>
		</div>
	{/snippet}
	<div class="buddy-content">
		<header class="identity">
			{#if me}
				<img class="icon" src="/aim/running-man-32.png" alt="" width="32" height="32" />
				<div class="identity-text">
					<strong>{me.nickname}</strong><span title={meQuery?.data?.awayMessage ?? ''}
						>{meQuery?.data?.status === 'away'
							? `Absent${meQuery.data.awayMessage ? ` : ${meQuery.data.awayMessage}` : ''}`
							: (STATUS_LABELS_FR[(meQuery?.data?.status ?? me.status) as AimStatus] ??
								'En ligne')}</span
					>
				</div>
			{:else}
				<div>
					<button onclick={() => desktop.openLogin('signin')}>Se connecter</button>
					<p>Connectez-vous pour voir vos contacts.</p>
				</div>
			{/if}
		</header>
		<div class="tabs">
			<button class:active={!editMode} aria-pressed={!editMode} onclick={() => (editMode = false)}
				>Online</button
			><button class:active={editMode} aria-pressed={editMode} onclick={() => (editMode = true)}
				>List Setup</button
			>
		</div>
		<div class="sunken-panel tree">
			{#if me}
				{#each sortedGroups as group (group.name)}
					<button
						class="group"
						aria-expanded={!collapsed.has(group.name)}
						onclick={() => toggleGroup(group.name)}
						>{collapsed.has(group.name) ? '▶' : '▼'}
						{group.name} ({group.members.filter((buddy) => buddy.status === 'online')
							.length}/{group.total})</button
					>
					{#if !collapsed.has(group.name)}{#each group.members as buddy (buddy.id)}{@render buddyRow(
								buddy
							)}{/each}{/if}
				{/each}
				<button
					class="group"
					aria-expanded={!collapsed.has('Offline')}
					onclick={() => toggleGroup('Offline')}
					>{collapsed.has('Offline') ? '▶' : '▼'} Offline ({offline.length})</button
				>
				{#if !collapsed.has('Offline')}{#each offline as buddy (buddy.id)}{@render buddyRow(
							buddy
						)}{/each}{/if}
				<button
					class="group"
					aria-expanded={!collapsed.has('Salons')}
					onclick={() => toggleGroup('Salons')}
					>{collapsed.has('Salons') ? '▶' : '▼'} Salons ({roomsQuery?.data?.length ?? 0})</button
				>
				{#if !collapsed.has('Salons')}{#each [...(roomsQuery?.data ?? [])].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)) as room (room.id)}<button
							class="list-entry"
							onclick={() => desktop.openChatRoom(room.id, room.name)}
							><img src="/aim/chat-room-16.png" alt="" width="12" height="12" />
							<span class="truncate">{room.name}</span></button
						>{/each}{/if}
				<button
					class="group"
					aria-expanded={!collapsed.has('Conversations')}
					onclick={() => toggleGroup('Conversations')}
					>{collapsed.has('Conversations') ? '▶' : '▼'} Conversations ({directQuery?.data?.length ??
						0})</button
				>
				{#if !collapsed.has('Conversations')}{#each directQuery?.data ?? [] as room (room.id)}{#if room.other}<button
								class="list-entry"
								class:unread={room.unreadCount > 0}
								onclick={() =>
									desktop.openIm({
										roomId: room.id,
										otherUserId: room.other!.id,
										otherNickname: room.other!.nickname
									})}
								><img src="/aim/running-man-16.png" alt="" width="12" height="12" />
								<span class="truncate"
									>{room.other.nickname}{room.unreadCount ? ` (${room.unreadCount})` : ''}</span
								></button
							>{/if}{/each}{/if}
			{/if}
		</div>
		{#if me && panel === 'im'}<form
				class="inline-panel"
				onsubmit={(e) => {
					e.preventDefault();
					void startIm();
				}}
			>
				<label for="im-nick">Pseudo du contact</label><input
					id="im-nick"
					type="text"
					bind:value={nickname}
					autocomplete="off"
				/><button type="submit">Ouvrir IM</button>
			</form>{/if}
		{#if me && panel === 'add'}<form
				class="inline-panel"
				onsubmit={(e) => {
					e.preventDefault();
					void addBuddy();
				}}
			>
				<label for="add-user">Contact</label><select id="add-user" bind:value={addId}
					><option value="">Choisir…</option>{#each availableUsers as user (user.id)}<option
							value={user.id}>{user.nickname}</option
						>{/each}</select
				><label for="add-group">Groupe</label><select id="add-group" bind:value={addGroup}
					>{#each DEFAULT_BUDDY_GROUPS as group (group)}<option value={group}>{group}</option
						>{/each}<option value="Autre…">Autre…</option></select
				>{#if addGroup === 'Autre…'}<input
						type="text"
						aria-label="Nom du groupe"
						bind:value={customGroup}
					/>{/if}<button type="submit">Ajouter</button>
			</form>{/if}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<div class="toolbar">
			<button disabled={!me} onclick={() => openPanel('im')}
				><img src="/aim/running-man-48.png" alt="" />IM</button
			>
			<button disabled={!me} onclick={() => desktop.openNewRoom()}
				><img src="/aim/chat-room-48.png" alt="" />Chat</button
			>
			<button
				disabled={!selectedBuddy}
				onclick={() => {
					if (selectedBuddy)
						desktop.openProfile({ userId: selectedBuddy.id, nickname: selectedBuddy.nickname });
				}}><img src="/aim/profile-48.png" alt="" />Infos</button
			>
			<button disabled={!me} onclick={() => desktop.openAway()}
				><img src="/aim/xp-note-48.png" alt="" />Absent</button
			>
			<button disabled={!me} onclick={() => openPanel('add')}
				><img src="/aim/add-buddy-48.png" alt="" />Ajouter</button
			>
		</div>
	</div>
</XpWindow>

{#if context}<div
		class="context dropdown"
		bind:this={contextElement}
		style:left={`${Math.max(0, context.x)}px`}
		style:top={`${Math.max(0, context.y)}px`}
	>
		<button
			onclick={() => {
				if (context) void openIm(context.buddy.id, context.buddy.nickname);
				context = null;
			}}>Envoyer un message instantané</button
		>
		<button
			onclick={() => {
				if (context)
					desktop.openProfile({ userId: context.buddy.id, nickname: context.buddy.nickname });
				context = null;
			}}>Infos sur {context.buddy.nickname}</button
		>
		<button
			onclick={() => {
				if (context) void removeBuddy(context.buddy.id);
			}}>Retirer de la liste</button
		>
	</div>{/if}

<style>
	.buddy-content {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		font:
			11px Tahoma,
			'Pixelated MS Sans Serif',
			sans-serif;
	}
	.identity {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 49px;
		padding: 4px;
		background: linear-gradient(#ffe880, #f6c700);
		border-bottom: 1px solid #c59d00;
	}
	.identity p {
		margin: 3px 0 0;
	}
	.icon {
		flex: none;
	}
	.identity-text {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.identity-text strong {
		display: flex;
		align-items: center;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.identity-text span,
	.truncate {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tabs {
		display: flex;
		padding-top: 4px;
	}
	.tabs button {
		border: 1px solid #aaa;
		border-bottom: 0;
		border-radius: 4px 4px 0 0;
		padding: 3px 9px;
		min-width: 0;
		font-size: 11px;
		background: #dedbd0;
	}
	.tabs button.active {
		background: #fff;
		font-weight: bold;
	}
	.tree {
		flex: 1;
		min-height: 0;
		overflow: auto;
		background: #fff;
		padding: 2px;
	}
	.group,
	.list-entry,
	.row-action {
		display: flex;
		align-items: center;
		width: 100%;
		min-width: 0;
		text-align: left;
		border: 0;
		border-radius: 0;
		box-shadow: none;
		font: inherit;
		cursor: default;
	}
	.group {
		background: #ece9d8;
		font-weight: bold;
		padding: 3px 2px;
		margin-top: 2px;
	}
	.list-entry,
	.row-action {
		background: transparent;
		padding: 2px 2px 2px 12px;
		gap: 4px;
	}
	.list-entry:hover,
	.row-action:hover,
	.row.selected .row-action {
		background: #316ac5;
		color: #fff;
	}
	.row {
		display: flex;
		align-items: center;
	}
	.row-action {
		flex: 1;
	}
	.row-action.offline,
	.row-action.away {
		color: #777;
		font-style: italic;
	}
	.row-action:hover,
	.row.selected .row-action {
		color: #fff;
	}
	.row-action img,
	.list-entry img {
		flex: none;
	}
	.remove {
		min-width: 17px;
		padding: 0;
		border: 0;
		box-shadow: none;
		color: #900;
	}
	.unread {
		font-weight: bold;
	}
	.inline-panel {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 4px;
		background: #ece9d8;
	}
	.inline-panel input,
	.inline-panel select {
		width: 100%;
		box-sizing: border-box;
	}
	.error {
		color: #a00;
		margin: 2px;
	}
	.toolbar {
		display: flex;
		justify-content: space-between;
		border-top: 1px solid #aca899;
		padding-top: 3px;
	}
	.toolbar button {
		display: flex;
		align-items: center;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		padding: 2px;
		font: inherit;
	}
	.toolbar img {
		width: 24px;
		height: 24px;
	}
	.menus {
		display: flex;
	}
	.menu-wrap {
		position: relative;
	}
	.dropdown {
		position: absolute;
		z-index: 10000;
		top: 100%;
		left: 0;
		min-width: 170px;
		padding: 2px;
		background: #fff;
		border: 1px solid #aca899;
		box-shadow: 2px 2px 4px #888;
	}
	.dropdown button {
		display: block;
		width: 100%;
		min-width: 0;
		padding: 4px 8px;
		text-align: left;
		border: 0;
		box-shadow: none;
		background: #fff;
		color: #000;
		white-space: nowrap;
		font:
			11px Tahoma,
			sans-serif;
	}
	.dropdown button:hover:not(:disabled) {
		background: #316ac5;
		color: #fff;
	}
	.dropdown hr {
		margin: 2px 4px;
	}
	.context {
		position: fixed;
		top: auto;
		min-width: 185px;
	}
	@keyframes sign-on {
		0%,
		75% {
			background: #fff199;
		}
		100% {
			background: transparent;
		}
	}
	.row.flash {
		animation: sign-on 1.5s ease-out;
	}
</style>
