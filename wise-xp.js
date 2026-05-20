/**
 * WISE English Portal - Shared XP SDK
 * Drop this into any game to connect to the shared XP system.
 *
 * Usage:
 *   <script src="https://wise-xp-sdk.vercel.app/wise-xp.js"></script>
 *
 *   // Initialize (call once on page load)
 *   await WiseXP.init('eiken-game');
 *
 *   // Report game result
 *   await WiseXP.reportGame({ score: 1500, correct: 8, total: 10, maxCombo: 5, grade: '5' });
 *
 *   // Report wrong answer
 *   await WiseXP.reportWrong({ question: '"apple" means?', correct: 'apple', playerAnswer: 'orange' });
 *
 *   // Get player stats
 *   const stats = await WiseXP.getStats();
 */

(function (root) {
  'use strict';

  const SUPABASE_URL = 'https://nrkhfkxzfaycehaxfdek.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ya2hma3h6ZmF5Y2VoYXhmZGVrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNjY0MTEsImV4cCI6MjA5NDg0MjQxMX0.-GC_51aIDQGleMaWqa4Q7Y6qSynZiVZcSWnSYOMHfZw';
  const STORAGE_KEY = 'wise_xp_player_id';
  const XP_PER_LEVEL = 500;

  let playerId = null;
  let gameSlug = null;
  let initialized = false;

  // ---- Supabase REST helpers ----
  const headers = () => ({
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation'
  });

  const api = async (table, method, body, query = '') => {
    const url = `${SUPABASE_URL}/rest/v1/${table}${query}`;
    const opts = { method, headers: headers() };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) {
      const text = await res.text();
      console.error(`[WiseXP] API error: ${method} ${table}${query}`, text);
      return null;
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };

  // ---- Player management ----
  const getOrCreatePlayer = async () => {
    // Check localStorage for existing player ID
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const rows = await api('players', 'GET', null, `?id=eq.${stored}&select=*`);
      if (rows && rows.length > 0) {
        playerId = stored;
        return rows[0];
      }
    }

    // Create new player
    const names = ['ひよこ', 'こねこ', 'こいぬ', 'パンダ', 'うさぎ', 'くま', 'ペンギン', 'きつね'];
    const emojis = ['🐥', '🐱', '🐶', '🐼', '🐰', '🐻', '🐧', '🦊'];
    const idx = Math.floor(Math.random() * names.length);
    const num = Math.floor(Math.random() * 1000);

    const result = await api('players', 'POST', {
      display_name: `${names[idx]}${num}`,
      avatar_emoji: emojis[idx]
    });

    if (result && result.length > 0) {
      playerId = result[0].id;
      localStorage.setItem(STORAGE_KEY, playerId);
      return result[0];
    }
    return null;
  };

  // ---- Streak management ----
  const updateStreak = async (player) => {
    const today = new Date().toISOString().slice(0, 10);
    if (player.streak_last_date === today) return player;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    const newCurrent = player.streak_last_date === yesterdayStr ? player.streak_current + 1 : 1;
    const newBest = Math.max(player.streak_best, newCurrent);

    await api('players', 'PATCH', {
      streak_current: newCurrent,
      streak_best: newBest,
      streak_last_date: today,
      updated_at: new Date().toISOString()
    }, `?id=eq.${playerId}`);

    return { ...player, streak_current: newCurrent, streak_best: newBest, streak_last_date: today };
  };

  // ---- Achievement checking ----
  const checkAchievements = async (player) => {
    const earned = await api('player_achievements', 'GET', null, `?player_id=eq.${playerId}&select=achievement_id`);
    const earnedIds = new Set((earned || []).map(e => e.achievement_id));
    const toEarn = [];

    if (player.games_played >= 1 && !earnedIds.has('first_game')) toEarn.push('first_game');
    if (player.games_played >= 10 && !earnedIds.has('games_10')) toEarn.push('games_10');
    if (player.games_played >= 50 && !earnedIds.has('games_50')) toEarn.push('games_50');
    if (player.games_played >= 100 && !earnedIds.has('games_100')) toEarn.push('games_100');
    if (player.streak_current >= 3 && !earnedIds.has('streak_3')) toEarn.push('streak_3');
    if (player.streak_current >= 7 && !earnedIds.has('streak_7')) toEarn.push('streak_7');
    if (player.streak_current >= 30 && !earnedIds.has('streak_30')) toEarn.push('streak_30');
    if (player.level >= 5 && !earnedIds.has('level_5')) toEarn.push('level_5');
    if (player.level >= 10 && !earnedIds.has('level_10')) toEarn.push('level_10');
    if (player.level >= 25 && !earnedIds.has('level_25')) toEarn.push('level_25');

    let bonusXP = 0;
    for (const id of toEarn) {
      await api('player_achievements', 'POST', { player_id: playerId, achievement_id: id });
      // Get achievement XP reward
      const ach = await api('achievements', 'GET', null, `?id=eq.${id}&select=xp_reward`);
      if (ach && ach[0]) bonusXP += ach[0].xp_reward;
    }

    if (bonusXP > 0) {
      const newXP = player.total_xp + bonusXP;
      const newLevel = Math.floor(newXP / XP_PER_LEVEL) + 1;
      await api('players', 'PATCH', { total_xp: newXP, level: newLevel }, `?id=eq.${playerId}`);
    }

    return toEarn;
  };

  // ---- XP Status Widget ----
  const renderWidget = (player) => {
    let widget = document.getElementById('wise-xp-widget');
    if (!widget) {
      widget = document.createElement('div');
      widget.id = 'wise-xp-widget';
      widget.style.cssText = `
        position:fixed;top:8px;right:8px;z-index:9999;
        background:rgba(15,15,26,0.95);border-radius:16px;padding:8px 14px;
        display:flex;align-items:center;gap:8px;
        border:2px solid rgba(255,217,61,0.3);
        box-shadow:0 4px 20px rgba(0,0,0,0.4);
        font-family:'M PLUS Rounded 1c',sans-serif;font-size:13px;
        cursor:pointer;transition:all 0.3s;
      `;
      widget.addEventListener('mouseenter', () => { widget.style.transform = 'scale(1.05)'; });
      widget.addEventListener('mouseleave', () => { widget.style.transform = 'scale(1)'; });
      document.body.appendChild(widget);
    }

    const pct = ((player.total_xp % XP_PER_LEVEL) / XP_PER_LEVEL * 100).toFixed(0);
    widget.innerHTML = `
      <span style="font-size:18px">${player.avatar_emoji}</span>
      <div style="display:flex;flex-direction:column;gap:2px">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="background:linear-gradient(135deg,#ffd93d,#ff8e53);color:#1a1a2e;
            border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;
            font-weight:900;font-size:11px">${player.level}</span>
          <span style="color:#ffd93d;font-weight:700;font-size:12px">${player.total_xp.toLocaleString()} XP</span>
          ${player.streak_current > 0 ? `<span style="color:#ff6b9d;font-size:11px">🔥${player.streak_current}</span>` : ''}
        </div>
        <div style="height:3px;background:#333;border-radius:2px;width:80px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#ffd93d,#ff8e53);border-radius:2px;transition:width 0.5s"></div>
        </div>
      </div>
    `;
  };

  // ---- Public API ----
  const WiseXP = {
    /**
     * Initialize the SDK. Call once per page.
     * @param {string} slug - Game identifier (e.g. 'eiken-game')
     */
    init: async function (slug) {
      if (initialized && gameSlug === slug) return;
      gameSlug = slug;
      const player = await getOrCreatePlayer();
      if (player) {
        const updated = await updateStreak(player);
        renderWidget(updated);
        initialized = true;
      }
    },

    /**
     * Report a completed game session.
     * @returns {{ xpEarned, newLevel, achievements, player }}
     */
    reportGame: async function ({ score = 0, correct = 0, total = 0, maxCombo = 0, grade = '', durationSeconds = 0 } = {}) {
      if (!playerId || !gameSlug) { console.warn('[WiseXP] Not initialized'); return null; }

      const xpEarned = score;

      // Insert game session
      await api('game_sessions', 'POST', {
        player_id: playerId,
        game_slug: gameSlug,
        grade: String(grade),
        score,
        xp_earned: xpEarned,
        correct_count: correct,
        total_questions: total,
        max_combo: maxCombo,
        duration_seconds: durationSeconds
      });

      // Update player stats
      const rows = await api('players', 'GET', null, `?id=eq.${playerId}&select=*`);
      if (!rows || !rows[0]) return null;
      const player = rows[0];

      const newXP = player.total_xp + xpEarned;
      const newLevel = Math.floor(newXP / XP_PER_LEVEL) + 1;
      const newGames = player.games_played + 1;

      await api('players', 'PATCH', {
        total_xp: newXP,
        level: newLevel,
        games_played: newGames,
        updated_at: new Date().toISOString()
      }, `?id=eq.${playerId}`);

      const updatedPlayer = { ...player, total_xp: newXP, level: newLevel, games_played: newGames };

      // Check achievements
      const newAchievements = await checkAchievements(updatedPlayer);

      // Check perfect game achievement
      if (correct === total && total > 0) {
        const earned = await api('player_achievements', 'GET', null, `?player_id=eq.${playerId}&achievement_id=eq.perfect_game`);
        if (!earned || earned.length === 0) {
          await api('player_achievements', 'POST', { player_id: playerId, achievement_id: 'perfect_game' });
          newAchievements.push('perfect_game');
        }
      }

      // Check combo achievement
      if (maxCombo >= 10) {
        const earned = await api('player_achievements', 'GET', null, `?player_id=eq.${playerId}&achievement_id=eq.combo_10`);
        if (!earned || earned.length === 0) {
          await api('player_achievements', 'POST', { player_id: playerId, achievement_id: 'combo_10' });
          newAchievements.push('combo_10');
        }
      }

      // Update widget
      renderWidget(updatedPlayer);

      return { xpEarned, newLevel, achievements: newAchievements, player: updatedPlayer };
    },

    /**
     * Report a wrong answer for cross-game review.
     */
    reportWrong: async function ({ question, correct, playerAnswer } = {}) {
      if (!playerId || !gameSlug) return;

      // Upsert: increment wrong_count if exists
      const existing = await api('wrong_answers', 'GET', null,
        `?player_id=eq.${playerId}&game_slug=eq.${gameSlug}&question_text=eq.${encodeURIComponent(question)}&select=id,wrong_count`);

      if (existing && existing.length > 0) {
        await api('wrong_answers', 'PATCH', {
          wrong_count: existing[0].wrong_count + 1,
          player_answer: playerAnswer,
          last_wrong_at: new Date().toISOString(),
          mastered: false
        }, `?id=eq.${existing[0].id}`);
      } else {
        await api('wrong_answers', 'POST', {
          player_id: playerId,
          game_slug: gameSlug,
          question_text: question,
          correct_answer: correct,
          player_answer: playerAnswer
        });
      }
    },

    /**
     * Mark a previously wrong answer as mastered.
     */
    markMastered: async function (question) {
      if (!playerId || !gameSlug) return;
      await api('wrong_answers', 'PATCH', { mastered: true },
        `?player_id=eq.${playerId}&game_slug=eq.${gameSlug}&question_text=eq.${encodeURIComponent(question)}`);
    },

    /**
     * Get current player stats.
     */
    getStats: async function () {
      if (!playerId) return null;
      const rows = await api('players', 'GET', null, `?id=eq.${playerId}&select=*`);
      return rows && rows[0] ? rows[0] : null;
    },

    /**
     * Get player's game history.
     */
    getHistory: async function (limit = 20) {
      if (!playerId) return [];
      const rows = await api('game_sessions', 'GET', null,
        `?player_id=eq.${playerId}&order=played_at.desc&limit=${limit}&select=*`);
      return rows || [];
    },

    /**
     * Get player's wrong answers for review.
     */
    getWrongAnswers: async function (gameOnly = false) {
      if (!playerId) return [];
      let query = `?player_id=eq.${playerId}&mastered=eq.false&order=wrong_count.desc&select=*`;
      if (gameOnly && gameSlug) query += `&game_slug=eq.${gameSlug}`;
      const rows = await api('wrong_answers', 'GET', null, query);
      return rows || [];
    },

    /**
     * Get player's achievements.
     */
    getAchievements: async function () {
      if (!playerId) return { earned: [], all: [] };
      const [earned, all] = await Promise.all([
        api('player_achievements', 'GET', null, `?player_id=eq.${playerId}&select=achievement_id,earned_at`),
        api('achievements', 'GET', null, '?select=*')
      ]);
      return { earned: earned || [], all: all || [] };
    },

    /**
     * Get leaderboard for a specific game.
     */
    getLeaderboard: async function (gameSlugOverride, limit = 10) {
      const slug = gameSlugOverride || gameSlug;
      const rows = await api('game_sessions', 'GET', null,
        `?game_slug=eq.${slug}&order=score.desc&limit=${limit}&select=score,player_id,played_at,correct_count,total_questions`);
      if (!rows) return [];

      // Fetch player names
      const playerIds = [...new Set(rows.map(r => r.player_id))];
      const players = await api('players', 'GET', null,
        `?id=in.(${playerIds.join(',')})&select=id,display_name,avatar_emoji,level`);
      const playerMap = {};
      (players || []).forEach(p => { playerMap[p.id] = p; });

      return rows.map(r => ({
        ...r,
        player: playerMap[r.player_id] || { display_name: '???', avatar_emoji: '?', level: 1 }
      }));
    },

    /** Get the player ID */
    getPlayerId: () => playerId,

    /** Check if initialized */
    isInitialized: () => initialized
  };

  // Expose globally
  root.WiseXP = WiseXP;

})(typeof window !== 'undefined' ? window : globalThis);
