import { Server, routePartykitRequest } from "partyserver";
import { CITIES_DATA } from "./data.js";

const cityIndex = new Map();
CITIES_DATA.forEach(entry => {
  const key = entry.a.toLowerCase().trim();
  if (!cityIndex.has(key)) cityIndex.set(key, []);
  cityIndex.get(key).push(entry);
});

const RECONNECT_GRACE_MS = 20000; // how long a dropped player's seat stays reserved

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
      settings: null // Locked in when first player connects
    };
    this.timerId = null;
    this.lastLoserIndex = null;
    this.disconnectTimers = {}; // token -> setTimeout handle
  }

  onConnect(connection, ctx) {
    const url = new URL(ctx.request.url);
    const token = url.searchParams.get('token');

    // Reconnect case: this token already has a seat in this room.
    const existingPlayer = token ? this.gameState.players.find(p => p.token === token) : null;
    if (existingPlayer) {
      existingPlayer.id = connection.id;
      existingPlayer.disconnectedAt = null;

      if (this.disconnectTimers[token]) {
        clearTimeout(this.disconnectTimers[token]);
        delete this.disconnectTimers[token];
      }

      connection.send(JSON.stringify({ type: "welcome", playerId: connection.id }));
      if (this.gameState.status === "playing") {
        this.gameState.message = `${existingPlayer.name} reconnected!`;
      }
      this.broadcastState();
      return;
    }

    // Not a known seat — room only ever holds 2 seats, reserved or not.
    if (this.gameState.players.length >= 2) {
      connection.send(JSON.stringify({ type: "error", message: "Room is full!" }));
      connection.close(4001, "Room full");
      return;
    }

    this.gameState.players.push({ id: connection.id, name: "Joining...", isReady: false, token, disconnectedAt: null });
    connection.send(JSON.stringify({ type: "welcome", playerId: connection.id }));
    this.broadcastState();
  }

  onClose(connection) {
    const player = this.gameState.players.find(p => p.id === connection.id);
    this.gameState.rematchVotes = this.gameState.rematchVotes.filter(id => id !== connection.id);
    if (!player) return;

    if (this.gameState.status === "playing") {
      // Don't end the game immediately — hold the seat open for a grace period
      // in case this was a network blip rather than a real departure.
      player.disconnectedAt = Date.now();
      this.gameState.message = `${player.name} disconnected. Waiting for them to reconnect...`;
      this.broadcastState();

      const token = player.token;
      this.disconnectTimers[token] = setTimeout(() => {
        delete this.disconnectTimers[token];
        const stillGone = this.gameState.players.find(p => p.token === token);
        if (stillGone && stillGone.disconnectedAt && this.gameState.status === "playing") {
          const leavingIndex = this.gameState.players.indexOf(stillGone);
          const winningIndex = leavingIndex === 0 ? 1 : 0;
          this.gameState.scores[winningIndex]++;
          this.lastLoserIndex = leavingIndex;
          this.gameState.status = "game_over";
          const winnerName = this.gameState.players[winningIndex]?.name || "Opponent";
          this.gameState.message = `${stillGone.name} didn't reconnect in time. ${winnerName} wins!`;
          this.broadcastState();
        }
      }, RECONNECT_GRACE_MS);
    } else if (this.gameState.status === "waiting") {
      // No game in progress yet, free up the seat immediately.
      this.gameState.players = this.gameState.players.filter(p => p.id !== connection.id);
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

    // Clear any stale disconnect grace timers from a previous round.
    Object.values(this.disconnectTimers).forEach(t => clearTimeout(t));
    this.disconnectTimers = {};
    this.gameState.players.forEach(p => { p.disconnectedAt = null; });

    const pool = CITIES_DATA.slice(0, 500);
    this.gameState.currentCityEntry = pool[Math.floor(Math.random() * pool.length)];
    const startKey = this.gameState.currentCityEntry.a.toLowerCase().trim();
    this.gameState.usedKeys.push(startKey);
    this.gameState.usedCitiesData.push(this.gameState.currentCityEntry);
    this.gameState.requiredLetter = this.getLastLetter(startKey);
    this.gameState.message = "Game Started! " + this.gameState.players[this.gameState.currentTurn].name + " goes first.";
    this.startTurnTimer();
  }

  startTurnTimer() {
    if (this.timerId) clearTimeout(this.timerId);

    const duration = this.gameState.settings.turnDuration;

    // Handle Infinite Timer
    if (duration === -1) {
      this.gameState.turnExpires = null;
      this.broadcastState();
      return;
    }

    this.gameState.turnExpires = Date.now() + (duration * 1000);
    this.broadcastState();

    this.timerId = setTimeout(() => {
      this.gameState.status = "game_over";
      const losingIndex = this.gameState.currentTurn;
      const winningIndex = losingIndex === 0 ? 1 : 0;
      this.gameState.scores[winningIndex]++;
      this.lastLoserIndex = losingIndex;
      const winner = this.gameState.players[winningIndex]?.name || "Opponent";
      this.gameState.message = `Time's up! ${winner} wins!`;
      this.broadcastState();
    }, duration * 1000);
  }

  onMessage(connection, messageString) {
    const data = JSON.parse(messageString);

    if (data.action === "ping") return; // heartbeat keepalive, no-op

    if (data.action === "set_name") {
      const player = this.gameState.players.find(p => p.id === connection.id);
      if (player && data.name) {
        player.name = data.name.substring(0, 15).trim();
        player.isReady = true;

        // Initialize settings from the first connected player
        if (!this.gameState.settings) {
          this.gameState.settings = {
            turnDuration: data.settings?.turnDuration !== undefined ? data.settings.turnDuration : 15
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

    if (data.action === "guess" && this.gameState.status === "playing") {
      const activePlayer = this.gameState.players[this.gameState.currentTurn];
      if (!activePlayer || connection.id !== activePlayer.id) return;

      const guessKey = data.city.trim().toLowerCase();
      if (this.getFirstLetter(guessKey) !== this.gameState.requiredLetter) {
        connection.send(JSON.stringify({ type: "error", message: `Needs to start with '${this.gameState.requiredLetter.toUpperCase()}'.` }));
        return;
      }
      if (this.gameState.usedKeys.includes(guessKey)) {
        connection.send(JSON.stringify({ type: "error", message: "Already used that one!" }));
        return;
      }
      if (!cityIndex.has(guessKey)) {
        const suggestion = this.findClosestSuggestion(guessKey, this.gameState.requiredLetter);
        connection.send(JSON.stringify({ type: "error", message: suggestion ? `Typo? Did you mean "${suggestion.c}"?` : "That doesn't match a city in the list." }));
        return;
      }

      connection.send(JSON.stringify({ type: "guess_success", key: guessKey }));
      this.gameState.usedKeys.push(guessKey);
      this.gameState.currentCityEntry = cityIndex.get(guessKey)[0];
      this.gameState.usedCitiesData.unshift(this.gameState.currentCityEntry);
      this.gameState.requiredLetter = this.getLastLetter(guessKey);
      this.gameState.message = `${activePlayer.name} played ${this.gameState.currentCityEntry.c}.`;
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