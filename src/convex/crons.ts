import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

// Run every minute to check for stale online users
crons.interval('cleanup stale users', { minutes: 1 }, internal.usersInternal.cleanupStaleUsers);

export default crons;
