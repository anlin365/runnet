const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { URL } = require("node:url");
const { Pool } = require("pg");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3001);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(ROOT, "db.sqlite3");
const LEGACY_DB_FILE = path.join(DATA_DIR, "runnet-data.sqlite");
const LEGACY_RUNNERS_FILE = path.join(DATA_DIR, "runners.json");
const LEGACY_RACES_FILE = path.join(DATA_DIR, "races.json");
const ITRA_SEARCH_PAGE = "https://itra.run/Runners/FindARunner";
const ITRA_SEARCH_API = "https://itra.run/api/runner/find";
const DB_DRIVER = process.env.DATABASE_URL ? "postgres" : "sqlite";
const DEFAULT_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

let db;
let pgPool;

async function ensureDataStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  if (DB_DRIVER === "postgres") {
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "true" || process.env.PGSSLMODE === "require"
        ? { rejectUnauthorized: false }
        : undefined,
    });

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS runners (
        runner_id BIGINT PRIMARY KEY,
        first_name TEXT,
        last_name TEXT,
        full_name TEXT NOT NULL,
        nationality TEXT,
        flag_url TEXT,
        gender TEXT,
        age_group TEXT,
        recent_races_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        profile_pic_url TEXT,
        performance_index INTEGER,
        performance_level TEXT,
        color_code TEXT,
        profile_url TEXT,
        imported_at TIMESTAMPTZ,
        saved_at TIMESTAMPTZ,
        analytics_json JSONB NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE TABLE IF NOT EXISTS races (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        country TEXT,
        city TEXT,
        distance_km REAL,
        elevation_gain INTEGER,
        surface TEXT,
        popularity INTEGER,
        best_score TEXT
      );
    `);

    await migrateLegacyStorageIfNeeded();
    return;
  }

  db = new DatabaseSync(DB_FILE);
  db.exec(`
    PRAGMA journal_mode=MEMORY;
    CREATE TABLE IF NOT EXISTS runners (
      runner_id INTEGER PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      full_name TEXT NOT NULL,
      nationality TEXT,
      flag_url TEXT,
      gender TEXT,
      age_group TEXT,
      recent_races_json TEXT NOT NULL,
      profile_pic_url TEXT,
      performance_index INTEGER,
      performance_level TEXT,
      color_code TEXT,
      profile_url TEXT,
      imported_at TEXT,
      saved_at TEXT,
      analytics_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS races (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      country TEXT,
      city TEXT,
      distance_km REAL,
      elevation_gain INTEGER,
      surface TEXT,
      popularity INTEGER,
      best_score TEXT
    );
  `);

  pruneDatabaseSchema();
  await migrateLegacyStorageIfNeeded();
}

function pruneDatabaseSchema() {
  if (DB_DRIVER !== "sqlite") {
    return;
  }

  const allowedTables = new Set(["runners", "races"]);
  const objects = db.prepare(`
    SELECT type, name
    FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%'
      AND type IN ('table', 'view', 'trigger', 'index')
  `).all();

  db.exec("PRAGMA foreign_keys = OFF;");
  try {
    for (const object of objects) {
      if (object.type === "table" && allowedTables.has(object.name)) {
        continue;
      }

      const dropSql = {
        table: `DROP TABLE IF EXISTS "${object.name}"`,
        view: `DROP VIEW IF EXISTS "${object.name}"`,
        trigger: `DROP TRIGGER IF EXISTS "${object.name}"`,
        index: `DROP INDEX IF EXISTS "${object.name}"`,
      }[object.type];

      if (dropSql) {
        db.exec(dropSql);
      }
    }
  } finally {
    db.exec("PRAGMA foreign_keys = ON;");
  }
}

function parseJsonColumn(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (Array.isArray(value) || typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toIsoString(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

function rowToRunner(row) {
  return ensureRunnerAnalytics({
    runnerId: Number(row.runner_id),
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: row.full_name,
    nationality: row.nationality,
    flagUrl: row.flag_url,
    gender: row.gender,
    ageGroup: row.age_group,
    recentRaces: parseJsonColumn(row.recent_races_json, []),
    profilePicUrl: row.profile_pic_url,
    performanceIndex: row.performance_index,
    performanceLevel: row.performance_level,
    colorCode: row.color_code,
    profileUrl: row.profile_url,
    importedAt: toIsoString(row.imported_at),
    savedAt: toIsoString(row.saved_at),
    analytics: parseJsonColumn(row.analytics_json, {}),
  });
}

function rowToRace(row) {
  return {
    id: row.id,
    name: row.name,
    country: row.country,
    city: row.city,
    distanceKm: row.distance_km,
    elevationGain: row.elevation_gain,
    surface: row.surface,
    popularity: row.popularity,
    bestScore: row.best_score,
  };
}

async function getDataCounts() {
  if (DB_DRIVER === "postgres") {
    const [runnerResult, raceResult] = await Promise.all([
      pgPool.query("SELECT COUNT(*)::int AS count FROM runners"),
      pgPool.query("SELECT COUNT(*)::int AS count FROM races"),
    ]);

    return {
      runnerCount: Number(runnerResult.rows[0]?.count || 0),
      raceCount: Number(raceResult.rows[0]?.count || 0),
    };
  }

  return {
    runnerCount: Number(db.prepare("SELECT COUNT(*) AS count FROM runners").get().count || 0),
    raceCount: Number(db.prepare("SELECT COUNT(*) AS count FROM races").get().count || 0),
  };
}

async function readRunnersFromSqliteFile(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    return [];
  }

  const sqliteDb = new DatabaseSync(filePath);
  try {
    const hasRunnerTable = sqliteDb.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='runners'
    `).get().count;

    if (!hasRunnerTable) {
      return [];
    }

    return sqliteDb.prepare(`
      SELECT
        runner_id, first_name, last_name, full_name, nationality, flag_url, gender, age_group,
        recent_races_json, profile_pic_url, performance_index, performance_level, color_code,
        profile_url, imported_at, saved_at, analytics_json
      FROM runners
    `).all().map(rowToRunner);
  } finally {
    sqliteDb.close();
  }
}

async function readRacesFromSqliteFile(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    return [];
  }

  const sqliteDb = new DatabaseSync(filePath);
  try {
    const hasRaceTable = sqliteDb.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='races'
    `).get().count;

    if (!hasRaceTable) {
      return [];
    }

    return sqliteDb.prepare(`
      SELECT id, name, country, city, distance_km, elevation_gain, surface, popularity, best_score
      FROM races
    `).all().map(rowToRace);
  } finally {
    sqliteDb.close();
  }
}

async function migrateLegacyStorageIfNeeded() {
  const { runnerCount, raceCount } = await getDataCounts();

  if (runnerCount === 0) {
    let legacyRunners = [];

    const sqliteSources = DB_DRIVER === "postgres" ? [DB_FILE, LEGACY_DB_FILE] : [LEGACY_DB_FILE];
    for (const source of sqliteSources) {
      legacyRunners = await readRunnersFromSqliteFile(source);
      if (legacyRunners.length) {
        break;
      }
    }

    if (!legacyRunners.length) {
      try {
        const raw = await fs.readFile(LEGACY_RUNNERS_FILE, "utf8");
        const items = JSON.parse(raw);
        if (Array.isArray(items)) {
          legacyRunners = items;
        }
      } catch {
        legacyRunners = [];
      }
    }

    if (legacyRunners.length) {
      await upsertRunners(legacyRunners);
    }
  }

  if (raceCount === 0) {
    let races = null;

    const sqliteSources = DB_DRIVER === "postgres" ? [DB_FILE, LEGACY_DB_FILE] : [LEGACY_DB_FILE];
    for (const source of sqliteSources) {
      const sqliteRaces = await readRacesFromSqliteFile(source);
      if (sqliteRaces.length) {
        races = sqliteRaces;
        break;
      }
    }

    if (!races) {
      try {
        const raw = await fs.readFile(LEGACY_RACES_FILE, "utf8");
        const items = JSON.parse(raw);
        if (Array.isArray(items) && items.length) {
          races = items;
        }
      } catch {
        races = null;
      }
    }

    await upsertRaces(races || defaultRaceDataset());
  }
}

async function upsertRunners(items) {
  if (DB_DRIVER === "postgres") {
    const client = await pgPool.connect();
    try {
      await client.query("BEGIN");
      for (const runner of items.map(ensureRunnerAnalytics)) {
        await client.query(`
          INSERT INTO runners (
            runner_id, first_name, last_name, full_name, nationality, flag_url, gender, age_group,
            recent_races_json, profile_pic_url, performance_index, performance_level, color_code,
            profile_url, imported_at, saved_at, analytics_json
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, $16, $17::jsonb
          )
          ON CONFLICT(runner_id) DO UPDATE SET
            first_name = excluded.first_name,
            last_name = excluded.last_name,
            full_name = excluded.full_name,
            nationality = excluded.nationality,
            flag_url = excluded.flag_url,
            gender = excluded.gender,
            age_group = excluded.age_group,
            recent_races_json = excluded.recent_races_json,
            profile_pic_url = excluded.profile_pic_url,
            performance_index = excluded.performance_index,
            performance_level = excluded.performance_level,
            color_code = excluded.color_code,
            profile_url = excluded.profile_url,
            imported_at = excluded.imported_at,
            saved_at = excluded.saved_at,
            analytics_json = excluded.analytics_json
        `, [
          runner.runnerId,
          runner.firstName || null,
          runner.lastName || null,
          runner.fullName,
          runner.nationality || null,
          runner.flagUrl || null,
          runner.gender || null,
          runner.ageGroup || null,
          JSON.stringify(runner.recentRaces || []),
          runner.profilePicUrl || null,
          runner.performanceIndex || null,
          runner.performanceLevel || null,
          runner.colorCode || null,
          runner.profileUrl || null,
          runner.importedAt || null,
          runner.savedAt || null,
          JSON.stringify(runner.analytics || {}),
        ]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  const insert = db.prepare(`
    INSERT INTO runners (
      runner_id, first_name, last_name, full_name, nationality, flag_url, gender, age_group,
      recent_races_json, profile_pic_url, performance_index, performance_level, color_code,
      profile_url, imported_at, saved_at, analytics_json
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
    ON CONFLICT(runner_id) DO UPDATE SET
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      full_name = excluded.full_name,
      nationality = excluded.nationality,
      flag_url = excluded.flag_url,
      gender = excluded.gender,
      age_group = excluded.age_group,
      recent_races_json = excluded.recent_races_json,
      profile_pic_url = excluded.profile_pic_url,
      performance_index = excluded.performance_index,
      performance_level = excluded.performance_level,
      color_code = excluded.color_code,
      profile_url = excluded.profile_url,
      imported_at = excluded.imported_at,
      saved_at = excluded.saved_at,
      analytics_json = excluded.analytics_json
  `);

  db.exec("BEGIN");
  try {
    items.map(ensureRunnerAnalytics).forEach((runner) => {
      insert.run(
        runner.runnerId,
        runner.firstName || null,
        runner.lastName || null,
        runner.fullName,
        runner.nationality || null,
        runner.flagUrl || null,
        runner.gender || null,
        runner.ageGroup || null,
        JSON.stringify(runner.recentRaces || []),
        runner.profilePicUrl || null,
        runner.performanceIndex || null,
        runner.performanceLevel || null,
        runner.colorCode || null,
        runner.profileUrl || null,
        runner.importedAt || null,
        runner.savedAt || null,
        JSON.stringify(runner.analytics || {}),
      );
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function upsertRaces(items) {
  if (DB_DRIVER === "postgres") {
    const client = await pgPool.connect();
    try {
      await client.query("BEGIN");
      for (const race of items) {
        await client.query(`
          INSERT INTO races (
            id, name, country, city, distance_km, elevation_gain, surface, popularity, best_score
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            country = excluded.country,
            city = excluded.city,
            distance_km = excluded.distance_km,
            elevation_gain = excluded.elevation_gain,
            surface = excluded.surface,
            popularity = excluded.popularity,
            best_score = excluded.best_score
        `, [
          race.id,
          race.name,
          race.country || null,
          race.city || null,
          race.distanceKm || null,
          race.elevationGain || null,
          race.surface || null,
          race.popularity || null,
          race.bestScore || null,
        ]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  const insert = db.prepare(`
    INSERT INTO races (
      id, name, country, city, distance_km, elevation_gain, surface, popularity, best_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      country = excluded.country,
      city = excluded.city,
      distance_km = excluded.distance_km,
      elevation_gain = excluded.elevation_gain,
      surface = excluded.surface,
      popularity = excluded.popularity,
      best_score = excluded.best_score
  `);

  db.exec("BEGIN");
  try {
    items.forEach((race) => {
      insert.run(
        race.id,
        race.name,
        race.country || null,
        race.city || null,
        race.distanceKm || null,
        race.elevationGain || null,
        race.surface || null,
        race.popularity || null,
        race.bestScore || null,
      );
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
  });
  res.end(message);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJsonBody(rawBody) {
  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}

function decryptItraPayload(payload) {
  if (!payload?.response1 || !payload?.response2 || !payload?.response3) {
    throw new Error("ITRA returned an unexpected encrypted payload.");
  }

  const encrypted = Buffer.from(payload.response1, "base64");
  const iv = Buffer.from(payload.response2, "base64");
  const key = Buffer.from(payload.response3, "base64");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}

async function readItraJsonResponse(response) {
  const rawBody = await response.text();

  if (!rawBody.trim()) {
    throw new Error("ITRA search returned an empty response. Please try again later.");
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error("ITRA search returned a non-JSON response. Please try again later.");
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseAgeGroup(ageGroup) {
  const match = String(ageGroup || "").match(/(\d+)\s*-\s*(\d+)/);
  if (!match) {
    return { min: null, max: null, label: ageGroup || "" };
  }

  return {
    min: Number(match[1]),
    max: Number(match[2]),
    label: ageGroup,
  };
}

function buildTrendSeries(performanceIndex, raceCount) {
  const base = Number(performanceIndex || 600);
  const points = [];

  for (let i = 0; i < 6; i += 1) {
    const season = `S${i + 1}`;
    const swing = ((i % 2 === 0 ? 1 : -1) * (12 + i * 3)) + raceCount * 2;
    const value = clamp(Math.round(base - 34 + i * 11 + swing), 380, 990);
    points.push({ label: season, value });
  }

  return points;
}

function normalizeRecentRaceEntries(rawRecentRaces) {
  if (!rawRecentRaces) {
    return [];
  }

  if (Array.isArray(rawRecentRaces)) {
    return rawRecentRaces.map((item) => String(item || "").trim()).filter(Boolean);
  }

  return String(rawRecentRaces)
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildRaceHistory(rawRunner, performanceIndex, recentRaceCount) {
  const names = normalizeRecentRaceEntries(rawRunner.RecentRaces);
  const fallbackNames = [
    "Recent mountain race sample",
    "Trail endurance sample",
    "Ultra distance sample",
  ];
  const basePi = Number(performanceIndex || 620);
  const raceNames = (names.length ? names : fallbackNames).slice(0, 6);

  return raceNames.map((name, index) => {
    const distanceKm = [42, 55, 80, 100, 120, 160][index % 6];
    const elevationGain = Math.round(distanceKm * (42 + index * 5));
    const score = clamp(Math.round(basePi - 28 + index * 9 + recentRaceCount * 3), 350, 990);
    const pace = clamp(Number((8.4 - score / 170 + distanceKm / 180).toFixed(2)), 3.8, 9.5);
    const finishMinutes = Math.round(distanceKm * pace);
    const hours = Math.floor(finishMinutes / 60);
    const minutes = String(finishMinutes % 60).padStart(2, "0");
    const totalRank = clamp(Math.round(420 - score / 3 + index * 18), 1, 600);
    const categoryRank = clamp(Math.round(totalRank / 5), 1, 120);
    const previousScore = index === 0 ? score - 8 : clamp(score - 12 + index * 2, 350, 990);

    return {
      id: `${rawRunner.RunnerId || rawRunner.runnerId || "runner"}-${index + 1}`,
      name,
      date: new Date(Date.UTC(2025 - Math.floor(index / 3), Math.max(0, 10 - index), 12 - index)).toISOString().slice(0, 10),
      distanceKm,
      elevationGain,
      resultTime: `${hours}:${minutes}`,
      overallRank: totalRank,
      categoryRank,
      itraScore: score,
      pace: `${pace} min/km`,
      scoreChange: score - previousScore,
      source: names.length ? "itra_recent_races" : "platform_estimated",
      details: {
        finishRate: `${clamp(Math.round(92 - index * 3 + score / 120), 68, 99)}%`,
        terrain: elevationGain / distanceKm >= 55 ? "High-climb trail" : "Runnable trail",
        note: names.length
          ? "Race name comes from ITRA search result; split metrics are platform estimates."
          : "Placeholder race generated from runner PI until detailed history is synced.",
      },
    };
  });
}

function buildAbilityProfile(performanceIndex, finishCount, climbScore, consistency, raceHistory) {
  const shortDistance = clamp(Math.round(performanceIndex / 10 + 6), 40, 99);
  const midDistance = clamp(Math.round(performanceIndex / 10 + finishCount / 8), 38, 98);
  const longDistance = clamp(Math.round(performanceIndex / 11 + raceHistory.length * 3), 32, 96);
  const climbing = clamp(Math.round(climbScore / 68), 35, 98);
  const stable = clamp(Math.round(consistency), 45, 98);

  return [
    { key: "shortDistance", label: "短距离", value: shortDistance, source: "platform_estimated" },
    { key: "midDistance", label: "中距离", value: midDistance, source: "platform_estimated" },
    { key: "longDistance", label: "长距离", value: longDistance, source: "platform_estimated" },
    { key: "climbing", label: "爬升能力", value: climbing, source: "platform_estimated" },
    { key: "stability", label: "稳定性", value: stable, source: "platform_estimated" },
  ];
}

function buildRunnerAnalytics(rawRunner) {
  const recentRaceCount = normalizeRecentRaceEntries(rawRunner.RecentRaces).length;
  const performanceIndex = Number(rawRunner.Pi || 0);
  const trendSeries = buildTrendSeries(performanceIndex, recentRaceCount);
  const avgPi = trendSeries.reduce((sum, item) => sum + item.value, 0) / Math.max(trendSeries.length, 1);
  const progressDelta = trendSeries.at(-1).value - trendSeries[0].value;
  const age = parseAgeGroup(rawRunner.AgeGroup);
  const utmbIndex = clamp(Math.round(performanceIndex * 0.96 + recentRaceCount * 4), 300, 950);
  const finishCount = Math.max(recentRaceCount * 4, 6);
  const avgPace = clamp(Number((360 / Math.max(performanceIndex, 420)).toFixed(2)), 3.7, 8.2);
  const climbScore = clamp(Math.round(performanceIndex * 5.6 + recentRaceCount * 110), 1800, 6200);
  const consistency = clamp(Math.round(72 + recentRaceCount * 4 + Math.max(progressDelta, 0) / 8), 60, 96);
  const worldRanking = clamp(Math.round(5000 - performanceIndex * 4.2), 1, 12000);
  const countryRanking = clamp(Math.round(worldRanking / 18), 1, 900);
  const raceHistory = buildRaceHistory(rawRunner, performanceIndex, recentRaceCount);
  const abilityProfile = buildAbilityProfile(performanceIndex, finishCount, climbScore, consistency, raceHistory);

  const radar = [
    { label: "速度", value: clamp(Math.round(performanceIndex / 10), 45, 98) },
    { label: "爬升", value: clamp(Math.round(climbScore / 70), 38, 96) },
    { label: "耐力", value: clamp(Math.round(consistency), 55, 98) },
    { label: "稳定性", value: clamp(Math.round(consistency - 6), 48, 95) },
    { label: "赛事经验", value: clamp(Math.round(finishCount * 2.4), 25, 95) },
  ];

  return {
    age,
    utmbIndex,
    finishCount,
    avgPace,
    climbScore,
    consistency,
    worldRanking,
    countryRanking,
    progressDelta,
    trendSeries,
    raceHistory,
    abilityProfile,
    dataSources: {
      itra: ["runnerId", "fullName", "nationality", "gender", "ageGroup", "performanceIndex", "performanceLevel", "recentRaces"],
      estimated: ["utmbIndex", "rankings", "finishCount", "avgPace", "climbScore", "consistency", "trendSeries", "raceHistory.metrics", "abilityProfile"],
      notes: [
        "ITRA search currently returns runner profile fields and recent race names.",
        "Race metrics, rankings, pace, score change and ability profile are platform estimates until detailed history sync is added.",
      ],
    },
    radar,
    summary: {
      scoreBand:
        performanceIndex >= 900
          ? "精英组"
          : performanceIndex >= 780
            ? "高水平组"
            : performanceIndex >= 650
              ? "进阶组"
              : "发展组",
      trend:
        progressDelta >= 18
          ? "近阶段能力上升明显"
          : progressDelta >= 4
            ? "近阶段表现稳中有升"
            : progressDelta <= -10
              ? "近阶段表现有回落"
              : "近阶段表现整体稳定",
      recommendation:
        performanceIndex >= 850
          ? "适合冲击高竞争度山地超马和国际积分赛。"
          : performanceIndex >= 720
            ? "适合布局 50K-100K 的技术型越野赛。"
            : "建议从中短距离爬升赛逐步积累完赛经验。",
    },
    averageTrendScore: Math.round(avgPi),
  };
}

function ensureRunnerAnalytics(runner) {
  if (
    runner?.analytics?.trendSeries?.length
    && runner.analytics.raceHistory?.length
    && runner.analytics.abilityProfile?.length
    && runner.analytics.dataSources
  ) {
    return runner;
  }

  const syntheticRawRunner = {
    RecentRaces: Array.isArray(runner.recentRaces) ? runner.recentRaces.join(" | ") : "",
    Pi: runner.performanceIndex || 0,
    AgeGroup: runner.ageGroup || "",
  };

  return {
    ...runner,
    analytics: {
      ...buildRunnerAnalytics(syntheticRawRunner),
      ...(runner.analytics || {}),
      raceHistory: runner.analytics?.raceHistory?.length
        ? runner.analytics.raceHistory
        : buildRunnerAnalytics(syntheticRawRunner).raceHistory,
      abilityProfile: runner.analytics?.abilityProfile?.length
        ? runner.analytics.abilityProfile
        : buildRunnerAnalytics(syntheticRawRunner).abilityProfile,
      dataSources: runner.analytics?.dataSources || buildRunnerAnalytics(syntheticRawRunner).dataSources,
    },
  };
}

function normalizeRunner(rawRunner) {
  const analytics = buildRunnerAnalytics(rawRunner);

  return {
    runnerId: rawRunner.RunnerId,
    firstName: rawRunner.FirstName,
    lastName: rawRunner.LastName,
    fullName: [rawRunner.FirstName, rawRunner.LastName].filter(Boolean).join(" "),
    nationality: rawRunner.Nationality,
    flagUrl: rawRunner.Code ? `https://itra.run${rawRunner.Code}` : null,
    gender: rawRunner.Gender,
    ageGroup: rawRunner.AgeGroup ? rawRunner.AgeGroup.trim() : "",
    recentRaces: rawRunner.RecentRaces
      ? rawRunner.RecentRaces.split("|").map((item) => item.trim()).filter(Boolean)
      : [],
    profilePicUrl: rawRunner.ProfilePic ? `https://itra.run${rawRunner.ProfilePic}` : null,
    performanceIndex: rawRunner.Pi,
    performanceLevel: rawRunner.PiIndex,
    colorCode: rawRunner.ColorCode,
    profileUrl: `https://itra.run/RunnerSpace/${encodeURIComponent(rawRunner.LastName)}.${encodeURIComponent(rawRunner.FirstName)}/${rawRunner.RunnerId}`,
    importedAt: new Date().toISOString(),
    analytics,
  };
}

async function getItraSession() {
  const response = await fetch(ITRA_SEARCH_PAGE, {
    headers: DEFAULT_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`Failed to open ITRA search page: ${response.status}`);
  }

  const html = await response.text();
  const csrfToken = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/i)?.[1];
  const cookieHeader = response.headers.get("set-cookie");

  if (!csrfToken || !cookieHeader) {
    throw new Error("Unable to establish ITRA session.");
  }

  return { csrfToken, cookieHeader };
}

async function searchItraRunner(name, nationality = "", start = 1, count = 10) {
  const cleanedName = String(name || "").trim();

  if (cleanedName.length < 2) {
    throw new Error("Runner name must be at least 2 characters.");
  }

  const { csrfToken, cookieHeader } = await getItraSession();
  const requestBody = new URLSearchParams({
    name: cleanedName,
    nationality: nationality.trim(),
    start: String(start),
    count: String(count),
    echoToken: "0",
  });

  const response = await fetch(ITRA_SEARCH_API, {
    method: "POST",
    headers: {
      ...DEFAULT_HEADERS,
      accept: "application/json, text/javascript, */*; q=0.01",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      "x-csrf-token": csrfToken,
      cookie: cookieHeader,
      origin: "https://itra.run",
      referer: ITRA_SEARCH_PAGE,
    },
    body: requestBody,
  });

  if (!response.ok) {
    throw new Error(`ITRA search failed with status ${response.status}.`);
  }

  const encryptedPayload = await readItraJsonResponse(response);
  const decryptedPayload = decryptItraPayload(encryptedPayload);
  const items = Array.isArray(decryptedPayload.Results) ? decryptedPayload.Results.map(normalizeRunner) : [];

  return {
    query: cleanedName,
    resultCount: decryptedPayload.ResultCount || items.length,
    items,
    fetchedAt: new Date().toISOString(),
  };
}

function applyRunnerFilters(items, filters) {
  const minPiRaw = String(filters.minPi ?? "").trim();
  const ageMinRaw = String(filters.ageMin ?? "").trim();
  const ageMaxRaw = String(filters.ageMax ?? "").trim();
  const minPi = minPiRaw ? Number(minPiRaw) : 0;
  const ageMin = ageMinRaw ? Number(ageMinRaw) : null;
  const ageMax = ageMaxRaw ? Number(ageMaxRaw) : null;
  const chinaOnly = String(filters.chinaOnly || "").toLowerCase() === "true";

  return items.filter((runner) => {
    if (chinaOnly && !/china|中国/i.test(runner.nationality || "")) {
      return false;
    }

    if (minPi && Number(runner.performanceIndex || 0) < minPi) {
      return false;
    }

    const age = runner.analytics?.age || {};
    if (ageMin !== null && age.min !== null && age.max < ageMin) {
      return false;
    }

    if (ageMax !== null && age.max !== null && age.min > ageMax) {
      return false;
    }

    return true;
  });
}

function searchSavedRunners(items, query, nationality = "") {
  const keyword = String(query || "").trim().toLowerCase();
  const country = String(nationality || "").trim().toLowerCase();

  return items.filter((runner) => {
    const matchesName = [
      runner.fullName,
      runner.firstName,
      runner.lastName,
      String(runner.runnerId || ""),
    ].some((value) => String(value || "").toLowerCase().includes(keyword));
    const matchesCountry = !country || String(runner.nationality || "").toLowerCase().includes(country);
    return matchesName && matchesCountry;
  });
}

async function listSavedRunners() {
  if (DB_DRIVER === "postgres") {
    const result = await pgPool.query(`
      SELECT
        runner_id, first_name, last_name, full_name, nationality, flag_url, gender, age_group,
        recent_races_json, profile_pic_url, performance_index, performance_level, color_code,
        profile_url, imported_at, saved_at, analytics_json
      FROM runners
      ORDER BY saved_at DESC NULLS LAST, runner_id DESC
    `);

    return result.rows.map(rowToRunner);
  }

  const rows = db.prepare(`
    SELECT
      runner_id, first_name, last_name, full_name, nationality, flag_url, gender, age_group,
      recent_races_json, profile_pic_url, performance_index, performance_level, color_code,
      profile_url, imported_at, saved_at, analytics_json
    FROM runners
    ORDER BY datetime(saved_at) DESC, runner_id DESC
  `).all();

  return rows.map(rowToRunner);
}

async function saveRunner(runner) {
  const nextRunner = {
    ...ensureRunnerAnalytics(runner),
    savedAt: new Date().toISOString(),
  };
  await upsertRunners([nextRunner]);
  return nextRunner;
}

async function listRaces() {
  if (DB_DRIVER === "postgres") {
    const result = await pgPool.query(`
      SELECT id, name, country, city, distance_km, elevation_gain, surface, popularity, best_score
      FROM races
    `);

    return result.rows.map(rowToRace);
  }

  const rows = db.prepare(`
    SELECT id, name, country, city, distance_km, elevation_gain, surface, popularity, best_score
    FROM races
  `).all();

  return rows.map(rowToRace);
}

function filterRaces(items, searchParams) {
  const keyword = String(searchParams.get("q") || "").trim().toLowerCase();
  const country = String(searchParams.get("country") || "").trim().toLowerCase();
  const sort = String(searchParams.get("sort") || "popularity");

  const filtered = items.filter((race) => {
    const matchesKeyword = !keyword
      || [race.name, race.country, race.city, race.surface]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
    const matchesCountry = !country || String(race.country).toLowerCase().includes(country);
    return matchesKeyword && matchesCountry;
  });

  const sorter = {
    popularity: (a, b) => b.popularity - a.popularity,
    distance: (a, b) => b.distanceKm - a.distanceKm,
    elevation: (a, b) => b.elevationGain - a.elevationGain,
  }[sort] || ((a, b) => b.popularity - a.popularity);

  return filtered.sort(sorter);
}

function createAiAnalysis(runner) {
  const analytics = runner.analytics || {};
  const trend = analytics.progressDelta || 0;
  const pi = Number(runner.performanceIndex || 0);
  const raceFocus = analytics.climbScore >= 4200 ? "高爬升技术赛" : "中长距离山地赛";

  return {
    levelAnalysis: `${runner.fullName} 当前 ITRA PI 为 ${pi || "暂无"}，综合判断处于 ${analytics.summary?.scoreBand || "待评估"}。${analytics.summary?.trend || ""}`,
    recommendedRaces: [
      `优先关注 ${raceFocus}，把优势放在爬升和耐力输出上。`,
      pi >= 850 ? "可以布局国际竞争度更高的 50K-100K 积分赛。" : "建议先用区域重点赛事提升稳定输出。",
      analytics.consistency >= 82 ? "适合尝试双峰赛季安排。" : "建议保持单周期备赛，减少高强度赛事密度。",
    ],
    trainingAdvice: [
      `建议每周安排 1 次阈值跑和 1 次长距离爬升训练，目标配速围绕 ${analytics.avgPace || 5.5} min/km 调整。`,
      trend >= 10 ? "近期趋势向上，训练上以巩固专项耐力和下坡技术为主。" : "近期趋势偏稳，优先补足速度耐力和恢复质量。",
      analytics.finishCount >= 12 ? "赛事经验已经具备，下一步重点是周期化安排和峰值状态控制。" : "建议增加 B 级赛事或长距离拉练，补足完赛经验。",
    ],
  };
}

function buildComparePayload(leftRunner, rightRunner) {
  const metrics = {
    performanceIndex: {
      label: "ITRA 积分",
      left: Number(leftRunner.performanceIndex || 0),
      right: Number(rightRunner.performanceIndex || 0),
    },
    utmbIndex: {
      label: "UTMB Index",
      left: Number(leftRunner.analytics?.utmbIndex || 0),
      right: Number(rightRunner.analytics?.utmbIndex || 0),
    },
    avgPace: {
      label: "估算配速",
      left: Number(leftRunner.analytics?.avgPace || 0),
      right: Number(rightRunner.analytics?.avgPace || 0),
    },
    climbScore: {
      label: "爬升能力",
      left: Number(leftRunner.analytics?.climbScore || 0),
      right: Number(rightRunner.analytics?.climbScore || 0),
    },
    finishCount: {
      label: "完赛数",
      left: Number(leftRunner.analytics?.finishCount || 0),
      right: Number(rightRunner.analytics?.finishCount || 0),
    },
  };

  return {
    leftRunner,
    rightRunner,
    metrics,
    radar: {
      left: leftRunner.analytics?.radar || [],
      right: rightRunner.analytics?.radar || [],
    },
    trend: {
      left: leftRunner.analytics?.trendSeries || [],
      right: rightRunner.analytics?.trendSeries || [],
    },
  };
}

function defaultRaceDataset() {
  return [
    {
      id: "utmb-montblanc",
      name: "UTMB Mont-Blanc",
      country: "France",
      city: "Chamonix",
      distanceKm: 171,
      elevationGain: 10000,
      surface: "高山技术越野",
      popularity: 99,
      bestScore: "Elite benchmark",
    },
    {
      id: "canyons-100k",
      name: "Canyons Endurance Runs 100K",
      country: "United States",
      city: "Auburn",
      distanceKm: 100,
      elevationGain: 4200,
      surface: "林道与单轨",
      popularity: 88,
      bestScore: "Fast 100K qualifier",
    },
    {
      id: "chiangmai-thailand",
      name: "Chiang Mai Thailand by UTMB 50K",
      country: "Thailand",
      city: "Chiang Mai",
      distanceKm: 50,
      elevationGain: 2800,
      surface: "热带山地",
      popularity: 80,
      bestScore: "Technical mid-distance",
    },
    {
      id: "gaoligong-100",
      name: "Gaoligong by UTMB 100K",
      country: "China",
      city: "Baoshan",
      distanceKm: 100,
      elevationGain: 5300,
      surface: "高海拔山地",
      popularity: 91,
      bestScore: "China mountain ultra",
    },
    {
      id: "dali-50",
      name: "Dali 50K Mountain Run",
      country: "China",
      city: "Dali",
      distanceKm: 50,
      elevationGain: 2600,
      surface: "山脊越野",
      popularity: 72,
      bestScore: "Climbing-focused 50K",
    },
    {
      id: "ccc-utmb",
      name: "CCC by UTMB",
      country: "France",
      city: "Courmayeur",
      distanceKm: 101,
      elevationGain: 6100,
      surface: "国际山地越野",
      popularity: 95,
      bestScore: "World-class 100K",
    }
  ];
}

async function serveStatic(req, res, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME_TYPES[ext] || "application/octet-stream",
    });
    res.end(content);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      sendText(res, 404, "Not Found");
      return;
    }
    console.error(error);
    sendText(res, 500, "Internal Server Error");
  }
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      service: "runnet",
      now: new Date().toISOString(),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/itra/search") {
    try {
      const result = await searchItraRunner(
        url.searchParams.get("name") || "",
        url.searchParams.get("nationality") || "",
        Number(url.searchParams.get("start") || 1),
        Number(url.searchParams.get("count") || 10),
      );
      result.items = applyRunnerFilters(result.items, {
        minPi: url.searchParams.get("minPi"),
        ageMin: url.searchParams.get("ageMin"),
        ageMax: url.searchParams.get("ageMax"),
        chinaOnly: url.searchParams.get("chinaOnly"),
      });
      result.filteredCount = result.items.length;
      sendJson(res, 200, result);
    } catch (error) {
      if (/ITRA search returned/.test(error.message)) {
        const savedItems = searchSavedRunners(
          await listSavedRunners(),
          url.searchParams.get("name") || "",
          url.searchParams.get("nationality") || "",
        );
        const filteredItems = applyRunnerFilters(savedItems, {
          minPi: url.searchParams.get("minPi"),
          ageMin: url.searchParams.get("ageMin"),
          ageMax: url.searchParams.get("ageMax"),
          chinaOnly: url.searchParams.get("chinaOnly"),
        });
        sendJson(res, 200, {
          query: url.searchParams.get("name") || "",
          resultCount: savedItems.length,
          filteredCount: filteredItems.length,
          source: "saved_runners",
          warning: error.message,
          items: filteredItems,
          fetchedAt: new Date().toISOString(),
        });
      } else {
        sendJson(res, 400, {
          ok: false,
          error: error.message,
        });
      }
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/itra/sync") {
    try {
      const result = await searchItraRunner(
        url.searchParams.get("name") || "",
        url.searchParams.get("nationality") || "",
        Number(url.searchParams.get("start") || 1),
        Number(url.searchParams.get("count") || 10),
      );
      result.items = applyRunnerFilters(result.items, {
        minPi: url.searchParams.get("minPi"),
        ageMin: url.searchParams.get("ageMin"),
        ageMax: url.searchParams.get("ageMax"),
        chinaOnly: url.searchParams.get("chinaOnly"),
      });
      result.filteredCount = result.items.length;
      await upsertRunners(result.items);
      sendJson(res, 200, {
        ...result,
        source: "itra",
        syncedCount: result.items.length,
      });
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error.message,
      });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/runners") {
    const items = await listSavedRunners();
    sendJson(res, 200, {
      count: items.length,
      items,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/runners/search") {
    const savedItems = searchSavedRunners(
      await listSavedRunners(),
      url.searchParams.get("name") || "",
      url.searchParams.get("nationality") || "",
    );
    const filteredItems = applyRunnerFilters(savedItems, {
      minPi: url.searchParams.get("minPi"),
      ageMin: url.searchParams.get("ageMin"),
      ageMax: url.searchParams.get("ageMax"),
      chinaOnly: url.searchParams.get("chinaOnly"),
    });
    sendJson(res, 200, {
      query: url.searchParams.get("name") || "",
      resultCount: savedItems.length,
      filteredCount: filteredItems.length,
      source: "saved_runners",
      items: filteredItems,
      fetchedAt: new Date().toISOString(),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/runners") {
    const body = parseJsonBody(await readBody(req));
    if (!body) {
      sendJson(res, 400, {
        ok: false,
        error: "Request body must be valid JSON.",
      });
      return;
    }

    if (!body.runnerId || !body.fullName) {
      sendJson(res, 400, {
        ok: false,
        error: "runnerId and fullName are required.",
      });
      return;
    }

    const saved = await saveRunner(body);
    sendJson(res, 201, {
      ok: true,
      item: saved,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/races") {
    const items = filterRaces(await listRaces(), url.searchParams);
    sendJson(res, 200, {
      count: items.length,
      items,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/overview") {
    const saved = await listSavedRunners();
    const races = await listRaces();
    const topRunner = [...saved].sort((a, b) => (b.performanceIndex || 0) - (a.performanceIndex || 0))[0] || null;

    sendJson(res, 200, {
      runnerCount: saved.length,
      raceCount: races.length,
      topRunner,
      averagePi: saved.length
        ? Math.round(saved.reduce((sum, item) => sum + Number(item.performanceIndex || 0), 0) / saved.length)
        : 0,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/ai/analyze") {
    const runnerId = Number(url.searchParams.get("runnerId") || 0);
    const saved = await listSavedRunners();
    const runner = saved.find((item) => Number(item.runnerId) === runnerId);

    if (!runner) {
      sendJson(res, 404, {
        ok: false,
        error: "Runner not found in local library.",
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      runnerId,
      analysis: createAiAnalysis(runner),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/compare") {
    const leftId = Number(url.searchParams.get("leftRunnerId") || 0);
    const rightId = Number(url.searchParams.get("rightRunnerId") || 0);
    const saved = await listSavedRunners();
    const leftRunner = saved.find((item) => Number(item.runnerId) === leftId);
    const rightRunner = saved.find((item) => Number(item.runnerId) === rightId);

    if (!leftRunner || !rightRunner) {
      sendJson(res, 400, {
        ok: false,
        error: "Two saved runners are required for comparison.",
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      comparison: buildComparePayload(leftRunner, rightRunner),
    });
    return;
  }

  sendJson(res, 404, {
    ok: false,
    error: "API route not found.",
  });
}

async function start() {
  await ensureDataStore();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url);
        return;
      }

      await serveStatic(req, res, url.pathname);
    } catch (error) {
      console.error(error);
      sendJson(res, 500, {
        ok: false,
        error: "Unexpected server error.",
      });
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`RunNet listening at http://${HOST}:${PORT}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
