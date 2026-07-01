import { Server } from "partyserver";
import { CITIES_DATA } from "./data.js";

const cityIndex = new Map();
CITIES_DATA.forEach(entry => {
  const key = entry.a.toLowerCase().trim();
  if (!cityIndex.has(key)) cityIndex.set(key, []);
  cityIndex.get(key).push(entry);
});

const RECONNECT_GRACE_MS = 20000; // 20 seconds background forfeit timer

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
      settings: { turnDuration: 15 } // strict default
    };
    this.timerId = null;
    this.lastLoserIndex = null;
    this.disconnectTimers = {}; 
  }

  onConnect(connection, ctx) {
    const url = new URL(ctx.request.url);
    const token = url.searchParams.get('token');

    const existingPlayer = token ? this.gameState.players.find(p => p.token === token) : null;
    
    if (existingPlayer) {
      // If they refresh or open a new tab, explicitly tell the OLD tab to shut down 
      // so it doesn't become a confusing "zombie" tab on their screen.
      this.broadcast(JSON.stringify({ type: "superseded", oldId: existingPlayer.id }));

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

    // Permanent Room Lock: Reject any 3rd token. Ghosts live forever.
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
    // Only process disconnects from active socket owners (ignores closed zombie tabs)
    const player = this.gameState.players.find(p => p.id === connection.id);
    if (!player) return;

    player.disconnectedAt = Date.now();
    this.gameState.rematchVotes = this.gameState.rematchVotes.filter(id => id !== connection.id);

    if (this.gameState.status === "playing") {
      this.gameState.message = `${player.name} disconnected. Waiting for them...`;
      this.broadcastState();

      // CHESS CLOCK LOGIC: We do NOT clear `this.timerId`. The game clock keeps ticking natively.
      
      // Start a background forfeit timer in case they drop when it's NOT their turn,
      // or if they are on infinite mode.
      const token = player.token;
      this.disconnectTimers[token] = setTimeout(() => {
        delete this.disconnectTimers[token];
        const stillGone = this.gameState.players.find(p => p.token === token);
        if (stillGone && stillGone.disconnectedAt && this.gameState.status === "playing") {
          const leavingIdx = this.gameState.players.indexOf(stillGone);
          const winningIndex = leavingIdx === 0 ? 1 : 0;
          this.gameState.scores[winningIndex]++;
          this.lastLoserIndex = leavingIdx;
          this.gameState.status = "game_over";
          this.gameState.turnExpires = null;
          if (this.timerId) clearTimeout(this.timerId);
          
          const winnerName = this.gameState.players[winningIndex]?.name || "Opponent";
          this.gameState.message = `${stillGone.name} abandoned the match. ${winnerName} wins!`;
          this.broadcastState();
        }
      }, RECONNECT_GRACE_MS);

    } else {
      this.broadcastState();
    }
  }

  startGame() {
    this.gameState.status = "playing";
    this.gameState.currentTurn = (this.lastLoserIndex === 0 || this.lastLoserIndex === 1) ? this.lastLoserIndex : 0;
    this.gameState.usedKeys = [];
    this.gameState.usedCitiesData = [];
    this.gameState.rematchVotes = [];

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
    
    // Handle Infinite mode strictly
    if (duration === -1) {
      this.gameState.turnExpires = null;
      this.broadcastState();
      return;
    }

    const msToRun = duration * 1000;
    this.gameState.turnExpires = Date.now() + msToRun;
    this.broadcastState();

    this.timerId = setTimeout(() => {
      this.gameState.status = "game_over";
      this.gameState.turnExpires = null;
      const losingIndex = this.gameState.currentTurn;
      const winningIndex = losingIndex === 0 ? 1 : 0;
      this.gameState.scores[winningIndex]++;
      this.lastLoserIndex = losingIndex;
      const winner = this.gameState.players[winningIndex]?.name || "Opponent";
      this.gameState.message = `Time's up! ${winner} wins!`;
      this.broadcastState();
    }, msToRun);
  }

  onMessage(connection, messageString) {
    const data = JSON.parse(messageString);
    if (data.action === "ping") return;

    if (data.action === "set_name") {
      const player = this.gameState.players.find(p => p.id === connection.id);
      if (player && data.name) {
        player.name = data.name.substring(0, 15).trim();
        player.isReady = true;

        // CRITICAL FIX: Force the room to update its settings if the game hasn't started.
        // This stops old rooms from being permanently stuck on Infinite Mode.
        if (data.settings && this.gameState.status !== "playing") {
          const parsed = parseInt(data.settings.turnDuration);
          this.gameState.settings = {
            turnDuration: isNaN(parsed) ? 15 : parsed
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
      
      if (!activePlayer || connection.id !== activePlayer.id) {
        connection.send(JSON.stringify({ type: "error", message: "It's not your turn, or you are connected in another tab." }));
        return;
      }

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
    const stateToSend = { ...this.gameState };
    // Pass the exact relative ms to the client so the UI timer syncs flawlessly
    if (stateToSend.turnExpires) {
      stateToSend.syncRemainingMs = Math.max(0, stateToSend.turnExpires - Date.now());
    }
    this.broadcast(JSON.stringify({ type: "state_update", state: stateToSend }));
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