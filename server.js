import { Server, routePartykitRequest } from "partyserver";
import { CITIES_DATA } from "./data.js";

const cityIndex = new Map();
CITIES_DATA.forEach(entry => {
  const key = entry.a.toLowerCase().trim();
  if (!cityIndex.has(key)) cityIndex.set(key, []);
  cityIndex.get(key).push(entry);
});

// Extend the new Server class
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
      message: "Waiting for opponent to join..."
    };
    this.timerId = null;
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
    this.gameState.currentTurn = 0;
    this.gameState.usedKeys = [];
    this.gameState.usedCitiesData = [];
    this.gameState.rematchVotes = [];
    const pool = CITIES_DATA.slice(0, 500); 
    this.gameState.currentCityEntry = pool[Math.floor(Math.random() * pool.length)];
    const startKey = this.gameState.currentCityEntry.a.toLowerCase().trim();
    this.gameState.usedKeys.push(startKey);
    this.gameState.usedCitiesData.push(this.gameState.currentCityEntry);
    this.gameState.requiredLetter = this.getLastLetter(startKey);
    this.gameState.message = "Game Started! " + this.gameState.players[0].name + " goes first.";
    this.startTurnTimer();
  }

  startTurnTimer() {
    if (this.timerId) clearTimeout(this.timerId);
    this.gameState.turnExpires = Date.now() + 15000;
    this.broadcastState();
    this.timerId = setTimeout(() => {
      this.gameState.status = "game_over";
      const winningIndex = this.gameState.currentTurn === 0 ? 1 : 0;
      this.gameState.scores[winningIndex]++;
      const winner = this.gameState.players[winningIndex]?.name || "Opponent";
      this.gameState.message = `Time's up! ${winner} wins!`;
      this.broadcastState();
    }, 15000);
  }

  // Note: 'connection' is now the first argument in partyserver
  onMessage(connection, messageString) {
    const data = JSON.parse(messageString);

    if (data.action === "set_name") {
      const player = this.gameState.players.find(p => p.id === connection.id);
      if (player && data.name) {
        player.name = data.name.substring(0, 15).trim();
        player.isReady = true; 

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
    // partyserver provides this.broadcast natively
    this.broadcast(JSON.stringify({ type: "state_update", state: this.gameState })); 
  }
  
  getFirstLetter(n) { const c = n.replace(/[^a-zA-Z]/g, ''); return c ? c.charAt(0).toLowerCase() : ''; }
  getLastLetter(n) { const c = n.replace(/[^a-zA-Z]/g, ''); return c.charAt(c.length - 1).toLowerCase(); }
  levenshtein(a, b) { const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0)); for (let i = 0; i <= a.length; i++) dp[i][0] = i; for (let j = 0; j <= b.length; j++) dp[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]); return dp[a.length][b.length]; }
  findClosestSuggestion(g, r) { let best = null, bestDist = Infinity; for (const k of cityIndex.keys()) { if (this.getFirstLetter(k) === r && !this.gameState.usedKeys.includes(k)) { let d = this.levenshtein(g, k); if (d < bestDist) { bestDist = d; best = k; } } } return (best && bestDist <= 2 && g.length >= 5) ? cityIndex.get(best)[0] : null; }
}

// Tell Cloudflare how to route incoming HTTP/WebSocket requests to your game room
export default {
  async fetch(request, env, ctx) {
    return routePartykitRequest(request, env, {
      CityChainServer
    });
  }
}