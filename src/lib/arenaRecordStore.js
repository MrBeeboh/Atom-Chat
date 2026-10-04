/**
 * Append-only master record of judged arena rounds.
 * Scores are copied from the judge. Missing numbers stay null.
 * Capability tags and context buckets are written after the fight and never used to pick models.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('../../scripts/arena-sqlite.cjs');

export const ARENA_RECORD_PATH = '/home/mike/atom-chat/arena-reports/arena-models.sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT,
  question_count INTEGER,
  layout TEXT,
  arena TEXT,
  question TEXT,
  test_type TEXT
);
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id INTEGER NOT NULL,
  model_id TEXT,
  model_name TEXT,
  opponent_ids TEXT,
  question TEXT,
  score REAL,
  tokens_in INTEGER,
  tokens_out INTEGER,
  tokens_cache INTEGER,
  cost REAL,
  had_svg INTEGER,
  test_type TEXT,
  tag_thinking INTEGER,
  tag_tools INTEGER,
  tag_vision INTEGER,
  context_bucket TEXT
);
DROP VIEW IF EXISTS master_ranking;
DROP VIEW IF EXISTS model_strength_by_type;
DROP VIEW IF EXISTS model_strength;
CREATE VIEW model_strength AS
WITH scored AS (
  SELECT id, test_id, model_id, score
  FROM scores
  WHERE score IS NOT NULL
    AND model_id IS NOT NULL
    AND trim(model_id) != ''
),
placed AS (
  SELECT
    s.test_id,
    s.model_id,
    s.score,
    1 + (
      SELECT COUNT(*)
      FROM scored o
      WHERE o.test_id = s.test_id AND o.score > s.score
    ) AS place
  FROM scored s
)
SELECT
  p.model_id AS model_id,
  (
    SELECT e.model_name
    FROM scores e
    WHERE e.model_id = p.model_id
      AND e.model_name IS NOT NULL
      AND trim(e.model_name) != ''
    ORDER BY e.id DESC
    LIMIT 1
  ) AS model_name,
  AVG(p.score) AS mean_score,
  AVG(p.place) AS mean_rank,
  AVG(CASE WHEN p.place = 1 THEN 1.0 ELSE 0.0 END) AS win_rate,
  COUNT(*) AS test_count
FROM placed p
GROUP BY p.model_id;
CREATE VIEW model_strength_by_type AS
WITH scored AS (
  SELECT id, test_id, model_id, score, test_type
  FROM scores
  WHERE score IS NOT NULL
    AND model_id IS NOT NULL
    AND trim(model_id) != ''
    AND test_type IS NOT NULL
    AND trim(test_type) != ''
),
placed AS (
  SELECT
    s.test_id,
    s.model_id,
    s.score,
    s.test_type,
    1 + (
      SELECT COUNT(*)
      FROM scored o
      WHERE o.test_id = s.test_id
        AND o.test_type = s.test_type
        AND o.score > s.score
    ) AS place
  FROM scored s
)
SELECT
  p.model_id AS model_id,
  (
    SELECT e.model_name
    FROM scores e
    WHERE e.model_id = p.model_id
      AND e.model_name IS NOT NULL
      AND trim(e.model_name) != ''
    ORDER BY e.id DESC
    LIMIT 1
  ) AS model_name,
  p.test_type AS test_type,
  AVG(p.score) AS mean_score,
  AVG(p.place) AS mean_rank,
  AVG(CASE WHEN p.place = 1 THEN 1.0 ELSE 0.0 END) AS win_rate,
  COUNT(*) AS test_count
FROM placed p
GROUP BY p.model_id, p.test_type;
CREATE VIEW master_ranking AS
SELECT
  DENSE_RANK() OVER (ORDER BY mean_score DESC) AS rank,
  model_id,
  model_name,
  mean_score,
  mean_rank,
  win_rate,
  test_count
FROM model_strength
ORDER BY mean_score DESC, test_count DESC, model_name;
`;

export { rowsForJudgedRound } from './arenaRecordRows.js';

export function readArenaRows(dbPath, sql) {
  const db = openArenaRecordDb(dbPath);
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}

export function openArenaRecordDb(dbPath = ARENA_RECORD_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  return db;
}

/** Insert one test and its score rows. Never deletes existing rows. */
export function appendArenaRecord(dbPath, record) {
  if (!record || !Array.isArray(record.entries)) return null;
  const db = openArenaRecordDb(dbPath);
  try {
    const run = db.prepare(
      'INSERT INTO tests (started_at, question_count, layout, arena, question, test_type) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      record.started_at ?? null,
      record.question_count ?? null,
      record.layout ?? null,
      record.arena ?? null,
      record.question ?? null,
      record.test_type ?? null,
    );
    const testId = Number(run.lastInsertRowid);
    const ins = db.prepare(
      `INSERT INTO scores (
        test_id, model_id, model_name, opponent_ids, question, score,
        tokens_in, tokens_out, tokens_cache, cost, had_svg, test_type,
        tag_thinking, tag_tools, tag_vision, context_bucket
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of record.entries) {
      ins.run(
        testId,
        row.model_id ?? null,
        row.model_name ?? null,
        row.opponent_ids ?? null,
        row.question ?? null,
        row.score ?? null,
        row.tokens_in ?? null,
        row.tokens_out ?? null,
        row.tokens_cache ?? null,
        row.cost ?? null,
        row.had_svg ?? null,
        row.test_type ?? null,
        row.tag_thinking ?? null,
        row.tag_tools ?? null,
        row.tag_vision ?? null,
        row.context_bucket ?? null,
      );
    }
    return testId;
  } finally {
    db.close();
  }
}
