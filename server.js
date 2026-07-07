import { Server, routePartykitRequest } from "partyserver";
import { CITIES_DATA } from "./data.js";

// Collapses apostrophe variants (' ' ` ´), accents, spaces, hyphens, etc. so
// mobile autocorrect/curly-quote input still matches the stored key.
// Strips apostrophes, hyphens, and accents so mobile autocorrect/curly-quote
// input still matches the stored key. Spaces are kept as meaningful
// characters (e.g. "georgetown" vs "george town").
function normalizeKey(s) {
  return s
    .normalize('NFKD')          // splits accented chars into base + diacritic (é -> e + ´)
    .replace(/[\u0300-\u036f]/g, '') // strips the diacritic marks
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // strips everything except letters, digits, and spaces
    .trim()
    .replace(/\s+/g, ' ');       // collapses repeated/stray whitespace to a single space
}

const cityIndex = new Map();
CITIES_DATA.forEach(entry => {
  const key = normalizeKey(entry.a);
  if (!cityIndex.has(key)) cityIndex.set(key, []);
  cityIndex.get(key).push(entry);
});
const allKeys = Array.from(cityIndex.keys());

const DEFAULT_TURN_DURATION = 15;
const DEFAULT_LIFELINE_INTERVALS = { country: 25, letters: 50, freefill: 100 };
const DEFAULT_LIFELINES_ENABLED = { country: true, letters: true, freefill: true };

function sanitizeTurnDuration(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TURN_DURATION;
  return Math.floor(n);
}

function sanitizeLifelineIntervals(value) {
  const result = { ...DEFAULT_LIFELINE_INTERVALS };
  if (value && typeof value === "object") {
    for (const key of Object.keys(DEFAULT_LIFELINE_INTERVALS)) {
      const n = Number(value[key]);
      if (Number.isFinite(n) && n > 0) result[key] = Math.floor(n);
    }
  }
  return result;
}

function sanitizeLifelinesEnabled(value) {
  const result = { ...DEFAULT_LIFELINES_ENABLED };
  if (value && typeof value === "object") {
    for (const key of Object.keys(DEFAULT_LIFELINES_ENABLED)) {
      if (typeof value[key] === "boolean") result[key] = value[key];
    }
  }
  return result;
}

export class CityChainServer extends Server {
  constructor(ctx, env) {
    super(ctx, env);
    this.gameState = {
      status: "waiting",
      players: [],
      scores: [0, 0],
      currentTurn: 0,
      usedKeys: [],
      usedCitiesData: [],
      currentCityEntry: null,
      requiredLetter: null,
      turnExpires: null,
      winner: null,
      rematchVotes: [],
      message: "Waiting for opponent to join...",
      settings: null, // Locked in when first player connects
      // Per-player lifeline tracking, keyed by player index (0/1)
      lifelineState: [
        { guessCount: 0, consumed: { country: 0, letters: 0, freefill: 0 }, freefillArmed: false },
        { guessCount: 0, consumed: { country: 0, letters: 0, freefill: 0 }, freefillArmed: false }
      ]
    };
    this.timerId = null;
    this.lastLoserIndex = null;
  }

  onConnect(connection) {
    if (this.gameState.players.length >= 2) {
      connection.send(JSON.stringify({ type: "error", message: "Room is full!" }));
      return;
    }
    
    this.gameState.players.push({ id: connection.id, name: "Joining...", isReady: false });
    connection.send(JSON.stringify({ type: "welcome", playerId: connection.id }));
    this.broadcastState();
  }

  onClose(connection) {
    const leavingIndex = this.gameState.players.findIndex(p => p.id === connection.id);
    this.gameState.players = this.gameState.players.filter(p => p.id !== connection.id);
    this.gameState.rematchVotes = this.gameState.rematchVotes.filter(id => id !== connection.id);
    
    if (this.gameState.status === "playing") {
      if (leavingIndex === 0 || leavingIndex === 1) {
        const winningIndex = leavingIndex === 0 ? 1 : 0;
        this.gameState.scores[winningIndex]++;
        this.lastLoserIndex = leavingIndex;
      }
      this.gameState.status = "game_over";
      this.gameState.message = "Opponent disconnected. You win!";
      this.broadcastState();
    } else if (this.gameState.status === "waiting") {
      this.gameState.message = "Waiting for an opponent to join...";
      this.broadcastState();
    }
  }

  startGame() {
    this.gameState.status = "playing";
    this.gameState.currentTurn = (this.lastLoserIndex === 0 || this.lastLoserIndex === 1) ? this.lastLoserIndex : 0;
    this.gameState.usedKeys = [];
    this.gameState.usedCitiesData = [];
    this.gameState.rematchVotes = [];
    this.gameState.lifelineState = [
      { guessCount: 0, consumed: { country: 0, letters: 0, freefill: 0 }, freefillArmed: false },
      { guessCount: 0, consumed: { country: 0, letters: 0, freefill: 0 }, freefillArmed: false }
    ];
    const pool = CITIES_DATA.slice(0, 500); 
    this.gameState.currentCityEntry = pool[Math.floor(Math.random() * pool.length)];
    const startKey = normalizeKey(this.gameState.currentCityEntry.a);
    this.gameState.usedKeys.push(startKey);
    this.gameState.usedCitiesData.push(this.gameState.currentCityEntry);
    this.gameState.requiredLetter = this.getLastLetter(startKey);
    this.gameState.message = "Game Started! " + this.gameState.players[this.gameState.currentTurn].name + " goes first.";
    this.startTurnTimer();
  }

  // Centralized time-up logic to end the game reliably
  handleTimeUp() {
    if (this.gameState.status !== "playing") return;
    
    if (this.timerId) clearTimeout(this.timerId);
    
    this.gameState.status = "game_over";
    const losingIndex = this.gameState.currentTurn;
    const winningIndex = losingIndex === 0 ? 1 : 0;
    this.gameState.scores[winningIndex]++;
    this.lastLoserIndex = losingIndex;
    const winner = this.gameState.players[winningIndex]?.name || "Opponent";
    this.gameState.message = `Time's up! ${winner} wins!`;
    this.broadcastState();
  }

  startTurnTimer() {
    if (this.timerId) clearTimeout(this.timerId);

    const duration = sanitizeTurnDuration(this.gameState.settings?.turnDuration);
    this.gameState.turnExpires = Date.now() + (duration * 1000);
    this.broadcastState();

    // Server backup timer
    this.timerId = setTimeout(() => this.handleTimeUp(), duration * 1000);
  }

  getPlayerIndex(connectionId) {
    return this.gameState.players.findIndex(p => p.id === connectionId);
  }

  lifelineEarned(playerIndex, key) {
    const interval = this.gameState.settings.lifelineIntervals[key];
    const guessCount = this.gameState.lifelineState[playerIndex].guessCount;
    return Math.floor(guessCount / interval) + 1;
  }

  lifelineAvailable(playerIndex, key) {
    const consumed = this.gameState.lifelineState[playerIndex].consumed[key];
    return this.lifelineEarned(playerIndex, key) - consumed;
  }

  getTopCandidates(requiredLetter, count) {
    const matches = [];
    for (const key of allKeys) {
      if (this.getFirstLetter(key) !== requiredLetter || this.gameState.usedKeys.includes(key)) continue;
      matches.push(cityIndex.get(key)[0]);
    }
    matches.sort((a, b) => b.p - a.p);
    return matches.slice(0, count);
  }

  onMessage(connection, messageString) {
    const data = JSON.parse(messageString);

    // Intercept ping and keep the connection alive
    if (data.action === "ping") {
      connection.send(JSON.stringify({ type: "pong" }));
      return;
    }

    // Client acts as a fail-safe to force the game over if the server slept
    if (data.action === "time_up" && this.gameState.status === "playing") {
      if (this.gameState.turnExpires && Date.now() >= this.gameState.turnExpires) {
        this.handleTimeUp();
      }
      return;
    }

    if (data.action === "set_name") {
      const player = this.gameState.players.find(p => p.id === connection.id);
      if (player && data.name) {
        player.name = data.name.substring(0, 15).trim();
        player.isReady = true; 

        // Initialize settings from the first connected player, with validation
        if (!this.gameState.settings) {
          this.gameState.settings = {
            turnDuration: sanitizeTurnDuration(data.settings?.turnDuration),
            lifelinesEnabled: sanitizeLifelinesEnabled(data.settings?.lifelinesEnabled),
            lifelineIntervals: sanitizeLifelineIntervals(data.settings?.lifelineIntervals)
          };
        }

        if (this.gameState.status === "waiting" && this.gameState.players.length === 2 && this.gameState.players.every(p => p.isReady)) {
          this.startGame();
        } else {
          this.broadcastState();
        }
      }
      return;
    }

    if (data.action === "use_lifeline" && this.gameState.status === "playing") {
      const playerIndex = this.getPlayerIndex(connection.id);
      if (playerIndex === -1) return;
      const key = data.lifeline; // 'country' | 'letters' | 'freefill'
      if (!["country", "letters", "freefill"].includes(key)) return;
      if (!this.gameState.settings.lifelinesEnabled[key]) return;

      const playerState = this.gameState.lifelineState[playerIndex];

      if (key === "freefill") {
        if (playerState.freefillArmed) {
          playerState.freefillArmed = false;
          connection.send(JSON.stringify({ type: "lifeline_result", lifeline: "freefill", result: "" }));
          this.broadcastState();
          return;
        }
        if (this.lifelineAvailable(playerIndex, "freefill") <= 0) return;
        playerState.freefillArmed = true;
        connection.send(JSON.stringify({ type: "lifeline_result", lifeline: "freefill", result: "armed — your next guess can be any valid, unused city." }));
        this.broadcastState();
        return;
      }

      if (this.lifelineAvailable(playerIndex, key) <= 0) return;

      const [top] = this.getTopCandidates(this.gameState.requiredLetter, 1);
      let resultText;
      if (key === "country") {
        resultText = top ? (top.iso + " " + top.co) : "no valid cities left for that letter.";
      } else if (key === "letters") {
        if (!top) resultText = "no valid cities left for that letter.";
        else {
          const cleaned = top.a.replace(/[^a-zA-Z]/g, "");
          const thirdLen = Math.max(1, Math.ceil(cleaned.length / 3));
          resultText = cleaned.split("").map((ch, i) => i < thirdLen ? ch.toUpperCase() : "_").join(" ");
        }
      }

      playerState.consumed[key] += 1;
      connection.send(JSON.stringify({ type: "lifeline_result", lifeline: key, result: resultText }));
      this.broadcastState();
      return;
    }

    if (data.action === "guess" && this.gameState.status === "playing") {
      const activePlayer = this.gameState.players[this.gameState.currentTurn];
      if (!activePlayer || connection.id !== activePlayer.id) return;

      // Reject guesses if the client timer desynced
      if (this.gameState.turnExpires && Date.now() > this.gameState.turnExpires) {
         return; 
      }

      const playerIndex = this.gameState.currentTurn;
      const playerState = this.gameState.lifelineState[playerIndex];
      const usingFreefill = playerState.freefillArmed;

      const guessKey = normalizeKey(data.city);

      if (!usingFreefill && this.getFirstLetter(guessKey) !== this.gameState.requiredLetter) {
        connection.send(JSON.stringify({ type: "error", message: `Needs to start with '${this.gameState.requiredLetter.toUpperCase()}'.` }));
        return;
      }
      if (this.gameState.usedKeys.includes(guessKey)) {
        connection.send(JSON.stringify({ type: "error", message: "Already used that one!" }));
        return;
      }
      if (!cityIndex.has(guessKey)) {
        const suggestion = usingFreefill ? null : this.findClosestSuggestion(guessKey, this.gameState.requiredLetter);
        connection.send(JSON.stringify({ type: "error", message: suggestion ? `Typo? Did you mean "${suggestion.c}"?` : "That doesn't match a city in the list." }));
        return;
      }

      if (usingFreefill) {
        playerState.consumed.freefill += 1;
        playerState.freefillArmed = false;
      }

      connection.send(JSON.stringify({ type: "guess_success", key: guessKey }));
      this.gameState.usedKeys.push(guessKey);
      this.gameState.currentCityEntry = cityIndex.get(guessKey)[0];
      this.gameState.usedCitiesData.unshift(this.gameState.currentCityEntry);
      this.gameState.requiredLetter = this.getLastLetter(guessKey);
      this.gameState.message = `${activePlayer.name} played ${this.gameState.currentCityEntry.c}.`;
      playerState.guessCount += 1;
      this.gameState.currentTurn = this.gameState.currentTurn === 0 ? 1 : 0;
      this.startTurnTimer();
    }

    if (data.action === "rematch" && this.gameState.status === "game_over") {
      if (!this.gameState.rematchVotes.includes(connection.id)) this.gameState.rematchVotes.push(connection.id);
      if (this.gameState.rematchVotes.length === 2) this.startGame();
      else { this.gameState.message = "Waiting for opponent to accept rematch..."; this.broadcastState(); }
    }
  }

  broadcastState() { 
    this.broadcast(JSON.stringify({ type: "state_update", state: this.gameState })); 
  }
  
  getFirstLetter(n) { const c = n.replace(/[^a-zA-Z]/g, ''); return c ? c.charAt(0).toLowerCase() : ''; }
  getLastLetter(n) { const c = n.replace(/[^a-zA-Z]/g, ''); return c.charAt(c.length - 1).toLowerCase(); }
  levenshtein(a, b) { const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0)); for (let i = 0; i <= a.length; i++) dp[i][0] = i; for (let j = 0; j <= b.length; j++) dp[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]); return dp[a.length][b.length]; }
  findClosestSuggestion(g, r) { let best = null, bestDist = Infinity; for (const k of cityIndex.keys()) { if (this.getFirstLetter(k) === r && !this.gameState.usedKeys.includes(k)) { let d = this.levenshtein(g, k); if (d < bestDist) { bestDist = d; best = k; } } } return (best && bestDist <= 2 && g.length >= 5) ? cityIndex.get(best)[0] : null; }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/parties/CityChainServer/")) {
      const roomId = url.pathname.split('/').pop();
      const id = env.CityChainServer.idFromName(roomId);
      const roomInstance = env.CityChainServer.get(id);
      return roomInstance.fetch(request);
    }
    return new Response("Not found", { status: 404 });
  }
}