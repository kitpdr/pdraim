import pino from 'pino';

// Pino without transports works in Cloudflare Workers (no worker threads)
// transports like pino-pretty use worker threads which don't exist in CF Workers
// Use 'debug' level - filtering happens at log time based on env
const logger = pino({
	level: 'debug',
	formatters: {
		level: (label) => ({ level: label })
	}
});

export interface Logger {
	debug: (msg: string, obj?: object) => void;
	info: (msg: string, obj?: object) => void;
	warn: (msg: string, obj?: object) => void;
	error: (msg: string, obj?: object) => void;
}

export const createLogger = (module: string): Logger => ({
	debug: (msg: string, obj = {}) => logger.debug({ module, ...obj }, msg),
	info: (msg: string, obj = {}) => logger.info({ module, ...obj }, msg),
	warn: (msg: string, obj = {}) => logger.warn({ module, ...obj }, msg),
	error: (msg: string, obj = {}) => logger.error({ module, ...obj }, msg)
});
