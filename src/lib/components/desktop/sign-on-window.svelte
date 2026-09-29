<script lang="ts">
	/**
	 * AIM "Sign On" window: screen name + password, "Save password" checkbox,
	 * and the classic three-step connection sequence (modem, chime).
	 * Also hosts the sign-up tab.
	 */
	import { invalidate } from '$app/navigation';
	import { z } from 'zod';
	import XpWindow from './xp-window.svelte';
	import PasswordStrengthIndicator from '../password-strength-indicator.svelte';
	import { desktop } from '$lib/states/desktop.svelte';
	import { chatState } from '$lib/states/chat.svelte';
	import { createSafeUser } from '$lib/types/chat';
	import { playSound, unlockAudio, SOUND_DURATIONS_MS } from '$lib/aim/sounds.svelte';
	import {
		loginSchema,
		createRegistrationSchema,
		DEFAULT_PASSWORD_CONSTRAINTS
	} from '$lib/validation/password';
	import type { RegisterResponse, RegisterResponseError } from '$lib/types/payloads';

	let { tab = 'signin' } = $props<{ tab?: 'signin' | 'signup' }>();

	const WINDOW_ID = 'login';
	const REMEMBER_KEY = 'pdraim-screen-name';

	// svelte-ignore state_referenced_locally
	let activeTab = $state<'signin' | 'signup'>(tab);

	// Sign in
	let username = $state('');
	let password = $state('');
	let rememberName = $state(true);
	let error = $state('');

	// Sign-on sequence: 0 idle, 1 connecting, 2 verifying, 3 starting
	let step = $state(0);
	let signedOnAs = $state<string | null>(null);

	// Sign up
	let suUsername = $state('');
	let suPassword = $state('');
	let suConfirmPassword = $state('');
	let captchaAnswer = $state('');
	let signupError = $state('');
	let signupBusy = $state(false);
	let showStrength = $state(false);

	$effect(() => {
		const saved = localStorage.getItem(REMEMBER_KEY);
		if (saved && !username) username = saved;
	});

	const STEP_LABELS = [
		'',
		'Connexion en cours…',
		'Vérification du nom et du mot de passe…',
		'Démarrage des services…'
	];

	// Aborted by "Annuler": stops the login request and every later step of the sequence.
	let signOnAbort: AbortController | null = null;

	function wait(ms: number, signal: AbortSignal) {
		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(resolve, ms);
			signal.addEventListener(
				'abort',
				() => {
					clearTimeout(timer);
					reject(signal.reason);
				},
				{ once: true }
			);
		});
	}

	async function login(
		name: string,
		pass: string,
		signal: AbortSignal
	): Promise<{ ok: boolean; error?: string }> {
		const res = await fetch('/api/session/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: name, password: pass }),
			signal
		});
		const data = await res.json();
		if (!res.ok) return { ok: false, error: data.error || 'Connexion impossible.' };
		signal.throwIfAborted();
		chatState.setCurrentUser(data.user ? createSafeUser(data.user) : null);
		await invalidate('app:session');
		await invalidate('app:chat');
		return { ok: true };
	}

	async function runSignOn(name: string, pass: string) {
		signOnAbort?.abort();
		const controller = new AbortController();
		signOnAbort = controller;
		const { signal } = controller;
		unlockAudio();
		error = '';
		step = 1;
		desktop.signingOn = true;
		playSound('modem');
		const modemStart = Date.now();
		try {
			await wait(900, signal);
			step = 2;
			const result = await login(name, pass, signal);
			if (!result.ok) {
				error = result.error ?? 'Connexion impossible.';
				step = 0;
				return;
			}
			if (rememberName) localStorage.setItem(REMEMBER_KEY, name);
			else localStorage.removeItem(REMEMBER_KEY);
			step = 3;
			// Let the modem "handshake" finish before the welcome chime
			const remaining = SOUND_DURATIONS_MS.modem - (Date.now() - modemStart);
			await wait(Math.max(400, Math.min(remaining, 2500)), signal);
			playSound('welcome');
			signedOnAs = name;
			desktop.openBuddyList();
			desktop.focus(WINDOW_ID);
			await wait(1200, signal);
			desktop.close(WINDOW_ID);
		} catch (err) {
			if (!signal.aborted) throw err;
			// Cancelled after the credentials were sent: the server may have created a
			// session, so honour "Annuler" by signing out (a no-op without a session).
			if (step >= 2 && signOnAbort === controller) {
				const loggedOut = await fetch('/api/session/logout', { method: 'POST' })
					.then((res) => res.ok)
					.catch(() => false);
				// Re-sync client auth with the server either way; only claim success if the logout worked.
				await invalidate('app:session');
				if (!loggedOut) error = 'Annulation impossible : tu es peut-être connecté.';
			}
		} finally {
			if (signOnAbort === controller) {
				signOnAbort = null;
				desktop.signingOn = false;
				if (signal.aborted) {
					step = 0;
					signedOnAs = null;
				}
			}
		}
	}

	async function handleSignin(e: Event) {
		e.preventDefault();
		const parsed = loginSchema.safeParse({ username: username.trim(), password: password.trim() });
		if (!parsed.success) {
			error = parsed.error.issues[0]?.message ?? 'Saisie invalide';
			return;
		}
		try {
			await runSignOn(username.trim(), password.trim());
		} catch (err) {
			console.debug('Sign-on error', err);
			error = 'Erreur de connexion. Réessaie.';
			step = 0;
		}
	}

	async function handleSignup(e: Event) {
		e.preventDefault();
		signupError = '';
		const schema = createRegistrationSchema(DEFAULT_PASSWORD_CONSTRAINTS);
		try {
			schema.parse({
				suUsername: suUsername.trim(),
				suPassword: suPassword.trim(),
				suConfirmPassword: suConfirmPassword.trim(),
				captchaAnswer: captchaAnswer.trim(),
				turnstileToken: ''
			});
		} catch (err) {
			signupError =
				err instanceof z.ZodError
					? (err.issues[0]?.message ?? 'Saisie invalide')
					: 'Saisie invalide';
			return;
		}
		signupBusy = true;
		try {
			const res = await fetch('/api/register', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ suUsername, suPassword, suConfirmPassword, captchaAnswer })
			});
			const data = (await res.json()) as RegisterResponse;
			if (!res.ok) {
				signupError = (data as RegisterResponseError).error || 'Inscription impossible.';
				return;
			}
			username = suUsername.trim();
			password = suPassword.trim();
			activeTab = 'signin';
			await runSignOn(username, password);
		} catch (err) {
			console.debug('Signup error', err);
			signupError = "Erreur d'inscription. Réessaie.";
		} finally {
			signupBusy = false;
		}
	}

	function cancelSignOn() {
		// runSignOn's catch/finally resets the sequence state
		signOnAbort?.abort();
	}
</script>

<XpWindow
	id={WINDOW_ID}
	width={300}
	height={activeTab === 'signin' ? 380 : 600}
	resizableWindow={false}
>
	<div class="signon">
		<div class="banner">
			<img src="/aim/running-man-48.png" alt="" width="44" height="44" />
			<div class="brand">
				<div class="brand-aol">
					<img src="/aim/aol-logo-16.png" alt="" width="14" height="14" /> PDR
				</div>
				<div class="brand-title">Instant</div>
				<div class="brand-title">Messenger</div>
			</div>
		</div>

		{#if signedOnAs}
			<div class="progress">
				<p class="welcome">Bienvenue, <b>{signedOnAs}</b> !</p>
				<p class="hint">Ouverture de la liste de contacts…</p>
			</div>
		{:else if step > 0}
			<div class="progress">
				<p class="step-title">Connexion à PDR AIM</p>
				<ol class="steps">
					{#each [1, 2, 3] as n (n)}
						<li class:done={step > n} class:active={step === n}>{STEP_LABELS[n]}</li>
					{/each}
				</ol>
				<div class="bar"><div class="bar-fill" style="width: {step * 33}%"></div></div>
				<button type="button" onclick={cancelSignOn}>Annuler</button>
			</div>
		{:else}
			<div class="tabs">
				<button
					type="button"
					class:active={activeTab === 'signin'}
					onclick={() => (activeTab = 'signin')}>Connexion</button
				>
				<button
					type="button"
					class:active={activeTab === 'signup'}
					onclick={() => (activeTab = 'signup')}>Inscription</button
				>
			</div>

			{#if activeTab === 'signin'}
				<form onsubmit={handleSignin}>
					<div class="field-row-stacked">
						<label for="so-name">Pseudo</label>
						<input id="so-name" type="text" bind:value={username} autocomplete="username" />
					</div>
					<div class="field-row-stacked">
						<label for="so-pass">Mot de passe</label>
						<input
							id="so-pass"
							type="password"
							bind:value={password}
							autocomplete="current-password"
						/>
					</div>
					<div class="field-row">
						<input id="so-remember" type="checkbox" bind:checked={rememberName} />
						<label for="so-remember">Se souvenir du pseudo</label>
					</div>
					{#if error}
						<div class="error">{error}</div>
					{/if}
					<div class="actions">
						<button type="submit" class="primary">Se connecter</button>
					</div>
					<p class="hint">
						Pas encore de compte ?
						<button type="button" class="link" onclick={() => (activeTab = 'signup')}
							>Inscris-toi</button
						>
					</p>
				</form>
			{:else}
				<form onsubmit={handleSignup}>
					<div class="field-row-stacked">
						<label for="su-name">Pseudo</label>
						<input id="su-name" type="text" bind:value={suUsername} autocomplete="username" />
					</div>
					<div class="field-row-stacked">
						<label for="su-pass">Mot de passe</label>
						<input
							id="su-pass"
							type="password"
							bind:value={suPassword}
							autocomplete="new-password"
							onfocus={() => (showStrength = true)}
						/>
						{#if showStrength}
							<PasswordStrengthIndicator password={suPassword} showDetails={false} />
						{/if}
					</div>
					<div class="field-row-stacked">
						<label for="su-confirm">Confirmer le mot de passe</label>
						<input
							id="su-confirm"
							type="password"
							bind:value={suConfirmPassword}
							autocomplete="new-password"
						/>
					</div>
					<div class="field-row-stacked">
						<label for="su-captcha">Que signifie PDR ?</label>
						<input id="su-captcha" type="text" bind:value={captchaAnswer} />
					</div>
					{#if signupError}
						<div class="error">{signupError}</div>
					{/if}
					<div class="actions">
						<button type="submit" class="primary" disabled={signupBusy}>
							{signupBusy ? 'Inscription…' : "S'inscrire"}
						</button>
					</div>
				</form>
			{/if}
		{/if}
	</div>
</XpWindow>

<style>
	.signon {
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 11px;
		height: 100%;
		overflow: hidden;
	}

	.banner {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		background: #1b2a9a;
		border: 1px solid #0f1a66;
		color: #fff;
	}

	.brand-aol {
		display: flex;
		align-items: center;
		gap: 4px;
		font-weight: bold;
		font-size: 12px;
		letter-spacing: 1px;
	}

	.brand-title {
		font-style: italic;
		font-size: 17px;
		line-height: 1;
		color: #fff;
	}

	.tabs {
		display: flex;
		border-bottom: 1px solid #919b9c;
	}

	.tabs button {
		flex: 1;
		border: 1px solid #919b9c;
		border-bottom: none;
		background: #ece9d8;
		box-shadow: none;
		border-radius: 3px 3px 0 0;
		min-width: 0;
		padding: 4px;
		font-size: 11px;
	}

	.tabs button.active {
		background: #fff;
		font-weight: bold;
		position: relative;
		top: 1px;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 4px 2px;
	}

	.field-row-stacked input[type='text'],
	.field-row-stacked input[type='password'] {
		width: 100%;
	}

	.actions {
		display: flex;
		justify-content: center;
		margin-top: 4px;
	}

	.primary {
		font-weight: bold;
		min-width: 120px;
	}

	.error {
		color: #c00000;
		background: #fff0f0;
		border: 1px solid #e0a0a0;
		padding: 4px 6px;
	}

	.hint {
		color: #555;
		text-align: center;
		margin: 4px 0 0;
	}

	.link {
		background: none;
		border: none;
		box-shadow: none;
		color: #0000c0;
		text-decoration: underline;
		padding: 0;
		min-width: 0;
		font-size: 11px;
		cursor: pointer;
	}

	.progress {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 10px 6px;
		align-items: center;
	}

	.step-title {
		font-weight: bold;
		margin: 0;
	}

	.steps {
		list-style: none;
		padding: 0;
		margin: 0;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.steps li {
		color: #888;
		padding-left: 18px;
		position: relative;
	}

	.steps li::before {
		content: '○';
		position: absolute;
		left: 2px;
	}

	.steps li.active {
		color: #000;
		font-weight: bold;
	}

	.steps li.active::before {
		content: '●';
		color: #f6c700;
		animation: blink 0.8s steps(2, start) infinite;
	}

	.steps li.done {
		color: #2a7a2a;
	}

	.steps li.done::before {
		content: '✓';
		color: #2a7a2a;
	}

	.bar {
		width: 100%;
		height: 14px;
		border: 1px solid #919b9c;
		background: #fff;
		padding: 1px;
	}

	.bar-fill {
		height: 100%;
		background: repeating-linear-gradient(90deg, #2c6ed5 0 8px, transparent 8px 10px);
		transition: width 0.4s ease;
	}

	.welcome {
		font-size: 14px;
		margin: 8px 0 0;
	}

	@keyframes blink {
		to {
			visibility: hidden;
		}
	}
</style>
