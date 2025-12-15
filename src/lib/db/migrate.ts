import { migrate } from 'drizzle-orm/libsql/migrator';
import { sql } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import { createLogger } from '$lib/utils/logger.server';

const log = createLogger('db-migrate');

// Existing migrations that were applied via db:push before migration tracking
const BASELINE_MIGRATIONS = [
	{ tag: '0000_shallow_ghost_rider', created_at: 1739208055141 },
	{ tag: '0001_blushing_jean_grey', created_at: 1739432549447 },
	{ tag: '0002_organic_randall_flagg', created_at: 1765829628211 }
];

/**
 * Check if the __drizzle_migrations table exists
 */
async function migrationTableExists(db: LibSQLDatabase<Record<string, unknown>>): Promise<boolean> {
	try {
		const result = await db.run(sql`
			SELECT name FROM sqlite_master
			WHERE type='table' AND name='__drizzle_migrations'
		`);
		return result.rows.length > 0;
	} catch {
		return false;
	}
}

/**
 * Check if a specific table exists (to detect if baseline is needed)
 */
async function tableExists(
	db: LibSQLDatabase<Record<string, unknown>>,
	tableName: string
): Promise<boolean> {
	try {
		const result = await db.run(sql`
			SELECT name FROM sqlite_master
			WHERE type='table' AND name=${tableName}
		`);
		return result.rows.length > 0;
	} catch {
		return false;
	}
}

/**
 * Create baseline migration records for existing production database.
 * This marks old migrations as "already applied" so they won't run again.
 */
async function createBaseline(db: LibSQLDatabase<Record<string, unknown>>): Promise<void> {
	log.info('Creating migration baseline for existing database...');

	// Create the migrations table
	await db.run(sql`
		CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			hash TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)
	`);

	// Insert baseline migrations
	for (const migration of BASELINE_MIGRATIONS) {
		await db.run(sql`
			INSERT INTO "__drizzle_migrations" (hash, created_at)
			VALUES (${migration.tag}, ${migration.created_at})
		`);
		log.info(`Marked migration as applied: ${migration.tag}`);
	}

	log.info('Baseline created successfully');
}

/**
 * Run database migrations with baseline detection.
 *
 * This function handles the transition from db:push to proper migrations:
 * 1. If __drizzle_migrations table doesn't exist but schema tables do,
 *    it creates a baseline marking existing migrations as applied.
 * 2. Then runs any pending migrations normally.
 *
 * This is idempotent - safe to run multiple times.
 */
export async function runMigrations(db: LibSQLDatabase<Record<string, unknown>>): Promise<void> {
	log.info('Checking database migrations...');

	const hasMigrationTable = await migrationTableExists(db);
	const hasUsersTable = await tableExists(db, 'users');

	// Detect existing production database without migration tracking
	if (!hasMigrationTable && hasUsersTable) {
		log.info('Detected existing database without migration tracking');
		await createBaseline(db);
	}

	// Run pending migrations
	log.info('Running pending migrations...');
	await migrate(db, { migrationsFolder: './drizzle' });
	log.info('Migrations complete');
}
