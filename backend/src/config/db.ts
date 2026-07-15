import { Pool, types } from 'pg';
import { env } from './env';

// By default node-postgres parses DATE columns (OID 1082) into JS Date
// objects at local-timezone midnight, which then shift to the previous
// calendar day once read back in UTC (e.g. under UTC+5). Code across this
// codebase (e.g. users/userRepository.ts's last_active_date/streak_freeze_used_at)
// treats DATE columns as plain 'YYYY-MM-DD' strings, so disable that
// conversion and return the raw string instead.
types.setTypeParser(1082, (value: string) => value);

export const pool = new Pool({ connectionString: env.databaseUrl });

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});
