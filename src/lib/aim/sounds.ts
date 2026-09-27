/**
 * AIM sound effects.
 *
 * If a sample exists in /static/sounds/<name>.(mp3|wav|ogg) it is played;
 * otherwise a Web Audio sketch is synthesized. No audio files are shipped
 * in the repository so the project stays free of copyrighted samples.
 * Each synthesized sound evokes the original:
 *  - doorOpen  : "buddy in"  — creak + soft thud
 *  - doorSlam  : "buddy out" — sharp slam
 *  - imReceive : incoming IM "ding"
 *  - imSend    : outgoing IM "tick"
 *  - welcome   : sign-on chime
 *  - modem     : dial-up handshake (long, for the sign-on screen)
 */
import { browser } from '$app/environment';

export type AimSound = 'doorOpen' | 'doorSlam' | 'imReceive' | 'imSend' | 'welcome' | 'modem';

const STORAGE_KEY = 'pdraim-sounds-enabled';

let ctx: AudioContext | null = null;
let enabled = true;

if (browser) {
	const stored = localStorage.getItem(STORAGE_KEY);
	enabled = stored === null ? true : stored === 'true';
}

export function soundsEnabled() {
	return enabled;
}

export function setSoundsEnabled(value: boolean) {
	enabled = value;
	if (browser) localStorage.setItem(STORAGE_KEY, String(value));
}

function getContext(): AudioContext | null {
	if (!browser) return null;
	if (!ctx) {
		try {
			ctx = new AudioContext();
		} catch {
			return null;
		}
	}
	if (ctx.state === 'suspended') void ctx.resume();
	return ctx;
}

/** Call once from a user gesture so the browser allows playback. */
export function unlockAudio() {
	if (getContext()) preloadSounds();
}

function noiseBuffer(ac: AudioContext, seconds: number) {
	const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * seconds), ac.sampleRate);
	const data = buffer.getChannelData(0);
	for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
	return buffer;
}

function tone(
	ac: AudioContext,
	dest: AudioNode,
	opts: {
		type?: OscillatorType;
		freq: number;
		freqEnd?: number;
		start: number;
		duration: number;
		gain?: number;
		attack?: number;
	}
) {
	const osc = ac.createOscillator();
	const g = ac.createGain();
	osc.type = opts.type ?? 'sine';
	osc.frequency.setValueAtTime(opts.freq, opts.start);
	if (opts.freqEnd) {
		osc.frequency.exponentialRampToValueAtTime(opts.freqEnd, opts.start + opts.duration);
	}
	const peak = opts.gain ?? 0.3;
	const attack = opts.attack ?? 0.005;
	g.gain.setValueAtTime(0.0001, opts.start);
	g.gain.exponentialRampToValueAtTime(peak, opts.start + attack);
	g.gain.exponentialRampToValueAtTime(0.0001, opts.start + opts.duration);
	osc.connect(g).connect(dest);
	osc.start(opts.start);
	osc.stop(opts.start + opts.duration + 0.05);
}

function thud(ac: AudioContext, dest: AudioNode, start: number, gain = 0.8, duration = 0.18) {
	// Low body knock: filtered noise burst + pitched sine drop
	const src = ac.createBufferSource();
	src.buffer = noiseBuffer(ac, duration);
	const filter = ac.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.setValueAtTime(900, start);
	filter.frequency.exponentialRampToValueAtTime(120, start + duration);
	const g = ac.createGain();
	g.gain.setValueAtTime(gain, start);
	g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
	src.connect(filter).connect(g).connect(dest);
	src.start(start);
	tone(ac, dest, {
		freq: 160,
		freqEnd: 45,
		start,
		duration: duration * 0.9,
		gain: gain * 0.7,
		attack: 0.002
	});
}

function creak(ac: AudioContext, dest: AudioNode, start: number, duration = 0.35) {
	// Hinge creak: sawtooth wobble with resonant bandpass
	const osc = ac.createOscillator();
	osc.type = 'sawtooth';
	osc.frequency.setValueAtTime(420, start);
	osc.frequency.linearRampToValueAtTime(560, start + duration * 0.6);
	osc.frequency.linearRampToValueAtTime(380, start + duration);
	const lfo = ac.createOscillator();
	lfo.frequency.value = 28;
	const lfoGain = ac.createGain();
	lfoGain.gain.value = 60;
	lfo.connect(lfoGain).connect(osc.frequency);
	const filter = ac.createBiquadFilter();
	filter.type = 'bandpass';
	filter.frequency.value = 1400;
	filter.Q.value = 6;
	const g = ac.createGain();
	g.gain.setValueAtTime(0.0001, start);
	g.gain.exponentialRampToValueAtTime(0.12, start + 0.04);
	g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
	osc.connect(filter).connect(g).connect(dest);
	osc.start(start);
	lfo.start(start);
	osc.stop(start + duration + 0.05);
	lfo.stop(start + duration + 0.05);
}

const players: Record<AimSound, (ac: AudioContext, dest: AudioNode, t: number) => void> = {
	doorOpen(ac, dest, t) {
		creak(ac, dest, t, 0.32);
		thud(ac, dest, t + 0.3, 0.5, 0.14);
	},
	doorSlam(ac, dest, t) {
		thud(ac, dest, t, 1.0, 0.22);
		// door frame rattle
		tone(ac, dest, {
			type: 'square',
			freq: 90,
			freqEnd: 60,
			start: t + 0.02,
			duration: 0.12,
			gain: 0.12
		});
	},
	imReceive(ac, dest, t) {
		// Two-note ding, bright
		tone(ac, dest, { type: 'triangle', freq: 1046, start: t, duration: 0.18, gain: 0.25 });
		tone(ac, dest, { type: 'sine', freq: 1568, start: t + 0.06, duration: 0.32, gain: 0.2 });
	},
	imSend(ac, dest, t) {
		tone(ac, dest, { type: 'triangle', freq: 880, start: t, duration: 0.09, gain: 0.18 });
	},
	welcome(ac, dest, t) {
		// Ascending three-note chime
		tone(ac, dest, { freq: 523, start: t, duration: 0.25, gain: 0.22 });
		tone(ac, dest, { freq: 659, start: t + 0.14, duration: 0.25, gain: 0.22 });
		tone(ac, dest, { freq: 784, start: t + 0.28, duration: 0.5, gain: 0.25 });
	},
	modem(ac, dest, t) {
		// Dial tone
		tone(ac, dest, { freq: 350, start: t, duration: 0.5, gain: 0.08 });
		tone(ac, dest, { freq: 440, start: t, duration: 0.5, gain: 0.08 });
		// DTMF-ish dialing
		const digits = [
			[697, 1209],
			[770, 1336],
			[852, 1477],
			[941, 1336],
			[697, 1477],
			[770, 1209],
			[852, 1336]
		];
		digits.forEach(([lo, hi], i) => {
			const s = t + 0.6 + i * 0.13;
			tone(ac, dest, { freq: lo, start: s, duration: 0.09, gain: 0.08 });
			tone(ac, dest, { freq: hi, start: s, duration: 0.09, gain: 0.08 });
		});
		// Handshake: answer tone, then chirps
		const h = t + 1.7;
		tone(ac, dest, { freq: 2100, start: h, duration: 0.6, gain: 0.07 });
		tone(ac, dest, {
			type: 'square',
			freq: 1200,
			freqEnd: 2400,
			start: h + 0.7,
			duration: 0.35,
			gain: 0.05
		});
		tone(ac, dest, {
			type: 'square',
			freq: 2400,
			freqEnd: 1200,
			start: h + 1.1,
			duration: 0.35,
			gain: 0.05
		});
		// Noise burst (training)
		const src = ac.createBufferSource();
		src.buffer = noiseBuffer(ac, 1.2);
		const filter = ac.createBiquadFilter();
		filter.type = 'bandpass';
		filter.frequency.value = 1800;
		filter.Q.value = 0.7;
		const g = ac.createGain();
		g.gain.setValueAtTime(0.0001, h + 1.5);
		g.gain.exponentialRampToValueAtTime(0.09, h + 1.6);
		g.gain.exponentialRampToValueAtTime(0.0001, h + 2.7);
		src.connect(filter).connect(g).connect(dest);
		src.start(h + 1.5);
	}
};

export const SOUND_DURATIONS_MS: Record<AimSound, number> = {
	doorOpen: 500,
	doorSlam: 300,
	imReceive: 400,
	imSend: 120,
	welcome: 800,
	modem: 4500
};

// Sample cache: one in-flight/resolved promise per sound (null = no file available)
const samples = new Map<AimSound, Promise<AudioBuffer | null>>();
const SAMPLE_EXTENSIONS = ['mp3', 'wav', 'ogg'];

function loadSample(ac: AudioContext, name: AimSound): Promise<AudioBuffer | null> {
	let pending = samples.get(name);
	if (!pending) {
		pending = (async () => {
			for (const ext of SAMPLE_EXTENSIONS) {
				try {
					const res = await fetch(`/sounds/${name}.${ext}`, { cache: 'force-cache' });
					if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('audio/')) continue;
					return await ac.decodeAudioData(await res.arrayBuffer());
				} catch {
					// try next extension
				}
			}
			return null;
		})();
		samples.set(name, pending);
	}
	return pending;
}

/** Warm the sample cache so the first playback is not delayed by a fetch. */
export function preloadSounds() {
	const ac = getContext();
	if (!ac) return;
	for (const name of Object.keys(players) as AimSound[]) void loadSample(ac, name);
}

export function playSound(name: AimSound) {
	if (!enabled) return;
	const ac = getContext();
	if (!ac) return;
	// Always wait for the sample probe so the first play never falls back to the
	// synthesized sketch while the real file is still downloading.
	void loadSample(ac, name).then((buffer) => {
		if (buffer) {
			const src = ac.createBufferSource();
			src.buffer = buffer;
			src.connect(ac.destination);
			src.start();
			return;
		}
		const master = ac.createGain();
		master.gain.value = 0.9;
		master.connect(ac.destination);
		try {
			players[name](ac, master, ac.currentTime);
		} catch (err) {
			console.warn('Sound playback failed', err);
		}
	});
}
