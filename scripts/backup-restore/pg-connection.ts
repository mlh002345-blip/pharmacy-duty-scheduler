// Splits a PostgreSQL connection URL into discrete components so pg_dump/
// pg_restore can be invoked with individual -h/-p/-U/-d flags and the
// password passed via the PGPASSWORD environment variable, rather than
// embedding the full connection string (including the password) as a
// single CLI argument. This matters because a CLI argument containing a
// password is briefly visible to any other process on the same machine
// via `ps`/`/proc` — the environment-variable approach avoids that
// exposure and is `pg_dump`/`pg_restore`'s own documented mechanism for
// supplying a password non-interactively.

export type PgConnectionParts = {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
};

export function parsePgConnection(url: string): PgConnectionParts {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ""),
  };
}

/** Env for spawning pg_dump/pg_restore/psql — PGPASSWORD only, never on the command line. */
export function pgEnv(parts: PgConnectionParts): NodeJS.ProcessEnv {
  return { ...process.env, PGPASSWORD: parts.password };
}
