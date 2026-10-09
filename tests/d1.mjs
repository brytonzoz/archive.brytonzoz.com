// Just enough of Cloudflare D1 over node:sqlite (same SQLite dialect) to run the Worker's real SQL in tests.
import { DatabaseSync } from 'node:sqlite';

const returnsRows = (sql) => /^\s*(select|with|pragma)\b/i.test(sql) || /\breturning\b/i.test(sql);

export function memoryD1() {
  const db = new DatabaseSync(':memory:');
  const prepare = (sql) => {
    let args = [];
    const statement = {
      bind(...values) {
        args = values.map((value) => (typeof value === 'boolean' ? Number(value) : value));
        return statement;
      },
      async first() {
        try {
          return db.prepare(sql).get(...args) ?? null;
        } catch (error) {
          throw new Error(`D1_ERROR: ${error.message}`);
        }
      },
      async all() {
        try {
          if (returnsRows(sql)) {
            const results = db.prepare(sql).all(...args);
            return { results, meta: { changes: results.length } };
          }
          const info = db.prepare(sql).run(...args);
          return { results: [], meta: { changes: Number(info.changes) } };
        } catch (error) {
          throw new Error(`D1_ERROR: ${error.message}`);
        }
      },
      async run() {
        return statement.all();
      },
    };
    return statement;
  };
  return {
    prepare,
    async batch(statements) {
      const out = [];
      for (const statement of statements) out.push(await statement.all());
      return out;
    },
    raw: db,
  };
}

/** A browser-looking request from one address. */
export function requestFrom(ip, init = {}) {
  return new Request('https://shipped.example.org/api/shipped/print', {
    method: 'POST',
    ...init,
    headers: {
      'cf-connecting-ip': ip,
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
      ...(init.headers ?? {}),
    },
  });
}
