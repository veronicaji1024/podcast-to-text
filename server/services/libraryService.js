/**
 * libraryService.js
 * Persistent SQLite storage for processed podcasts.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DB_DIR, 'podcasts.db');

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Initialize schema
db.exec(`
    CREATE TABLE IF NOT EXISTS podcasts (
        id          TEXT PRIMARY KEY,
        title       TEXT,
        author      TEXT,
        cover_url   TEXT,
        description TEXT,
        duration    INTEGER,
        platform    TEXT,
        language    TEXT,
        detail_level TEXT,
        transcript  TEXT,
        summary     TEXT,
        created_at  INTEGER
    )
`);

// Migration: add category column if not present (safe for existing DBs)
try {
    db.exec(`ALTER TABLE podcasts ADD COLUMN category TEXT`);
} catch (_) { /* column already exists — ignore */ }

/**
 * Save a processed podcast to the library.
 * @param {object} opts
 * @param {string} opts.id            - Job UUID
 * @param {object} [opts.metadata]    - { title, author, cover, description, duration, platform }
 * @param {string} [opts.language]    - Output language
 * @param {string} [opts.detailLevel] - 'brief' | 'standard' | 'detailed'
 * @param {string} [opts.transcript]  - Full transcript text
 * @param {string} [opts.summary]     - Structured notes markdown
 * @param {string} [opts.category]    - Auto-classified category label
 */
function save({ id, metadata = {}, language, detailLevel, transcript, summary, category }) {
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO podcasts
            (id, title, author, cover_url, description, duration, platform,
             language, detail_level, transcript, summary, category, created_at)
        VALUES
            (@id, @title, @author, @cover_url, @description, @duration, @platform,
             @language, @detail_level, @transcript, @summary, @category, @created_at)
    `);
    stmt.run({
        id,
        title:        metadata.title       || null,
        author:       metadata.author      || null,
        cover_url:    metadata.cover       || null,
        description:  metadata.description || null,
        duration:     metadata.duration    || null,
        platform:     metadata.platform    || null,
        language:     language             || null,
        detail_level: detailLevel          || null,
        transcript:   transcript           || null,
        summary:      summary              || null,
        category:     category             || null,
        created_at:   Math.floor(Date.now() / 1000)
    });
}

/**
 * List all podcasts (metadata only, no transcript/summary for performance).
 * @returns {Array}
 */
function list() {
    return db.prepare(`
        SELECT id, title, author, cover_url, description, duration,
               platform, language, detail_level, category, created_at
        FROM podcasts
        ORDER BY created_at DESC
    `).all();
}

/**
 * Return categories with counts (including 'All').
 * Items with no category are counted under '其他'.
 * @returns {Array<{category: string, count: number}>}
 */
function listCategories() {
    const rows = db.prepare(`
        SELECT COALESCE(category, '其他') AS category, COUNT(*) AS count
        FROM podcasts
        GROUP BY COALESCE(category, '其他')
        ORDER BY count DESC
    `).all();
    const total = rows.reduce((s, r) => s + r.count, 0);
    return [{ category: 'All', count: total }, ...rows];
}

/**
 * Get a single podcast with full content.
 * @param {string} id
 * @returns {object|undefined}
 */
function get(id) {
    return db.prepare('SELECT * FROM podcasts WHERE id = ?').get(id);
}

/**
 * Delete a podcast entry.
 * @param {string} id
 * @returns {boolean} - true if deleted
 */
function remove(id) {
    return db.prepare('DELETE FROM podcasts WHERE id = ?').run(id).changes > 0;
}

/**
 * Update category for a podcast.
 * @param {string} id
 * @param {string|null} category
 * @returns {boolean}
 */
function updateCategory(id, category) {
    return db.prepare('UPDATE podcasts SET category = ? WHERE id = ?').run(category || null, id).changes > 0;
}

module.exports = { save, list, get, remove, listCategories, updateCategory };
