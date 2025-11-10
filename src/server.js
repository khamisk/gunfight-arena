const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '../public')));

const COLORS = ['blue', 'red', 'yellow', 'green'];
let lobby = null;
let gameRooms = new Map();
let playerConnections = new Map();
let playerStats = new Map(); // Persistent stats: name -> {kills, wins}

function getOrCreateLobby() {
    if (!lobby) {
        lobby = {
            id: Math.random().toString(36).substr(2, 9),
            players: [],
            startTimer: null,
            startTime: null
        };
    }
    return lobby;
}

class GameRoom {
    constructor(roomId, players) {
        this.roomId = roomId;
        this.players = players;
        this.gameState = {
            players: {},
            bullets: [],
            walls: this.generateWalls(),
            powerups: [],
            gameTime: 0,
            winner: null,
            zone: {
                x: 0,
                y: 0,
                width: 800,
                height: 600,
                active: false,
                startTime: null
            }
        };

        // Better spawn positions for up to 4 players (far corners)
        const potentialSpawns = [
            { x: 100, y: 100 },
            { x: 700, y: 100 },
            { x: 100, y: 500 },
            { x: 700, y: 500 }
        ];

        players.forEach((player, idx) => {
            // Find a spawn position that doesn't collide with walls
            let spawn = potentialSpawns[idx % 4];
            for (let attempt = 0; attempt < 20; attempt++) {
                let collides = false;
                const testPlayer = { x: spawn.x, y: spawn.y };

                for (let wall of this.gameState.walls) {
                    if (this.isCollidingWithWall(testPlayer, wall)) {
                        collides = true;
                        break;
                    }
                }

                if (!collides) break;

                // Try random position
                spawn = {
                    x: 100 + Math.random() * 600,
                    y: 100 + Math.random() * 400
                };
            }

            this.gameState.players[player.id] = {
                id: player.id,
                name: player.name,
                color: player.color,
                x: spawn.x,
                y: spawn.y,
                angle: 0,
                vx: 0,
                vy: 0,
                health: 100,
                kills: 0,
                wins: 0,
                lastShot: 0,
                powerup: null // 'machinegun' or 'ricochet'
            };
        });
    }

    generateWalls() {
        const walls = [];

        // Border walls (always present)
        walls.push(
            { x: 50, y: 50, width: 700, height: 15 },
            { x: 50, y: 535, width: 700, height: 15 },
            { x: 50, y: 50, width: 15, height: 500 },
            { x: 735, y: 50, width: 15, height: 500 }
        );

        // Strategic cover walls - L-shapes and boxes for better cover
        const coverSpots = [
            // Top left area
            { x: 150, y: 150, width: 80, height: 20 },
            { x: 150, y: 150, width: 20, height: 80 },

            // Top right area
            { x: 570, y: 150, width: 80, height: 20 },
            { x: 630, y: 150, width: 20, height: 80 },

            // Bottom left area
            { x: 150, y: 430, width: 80, height: 20 },
            { x: 150, y: 370, width: 20, height: 80 },

            // Bottom right area
            { x: 570, y: 430, width: 80, height: 20 },
            { x: 630, y: 370, width: 20, height: 80 },

            // Center cover
            { x: 350, y: 250, width: 100, height: 20 },
            { x: 350, y: 330, width: 100, height: 20 },
            { x: 340, y: 270, width: 20, height: 60 },
            { x: 440, y: 270, width: 20, height: 60 },
        ];

        walls.push(...coverSpots);

        // Add some random cover pieces (10-15)
        const randomCount = 10 + Math.floor(Math.random() * 6);
        for (let i = 0; i < randomCount; i++) {
            const isHorizontal = Math.random() > 0.5;
            const width = isHorizontal ? 50 + Math.floor(Math.random() * 70) : 15 + Math.floor(Math.random() * 20);
            const height = isHorizontal ? 15 + Math.floor(Math.random() * 20) : 50 + Math.floor(Math.random() * 70);

            const x = 120 + Math.floor(Math.random() * 560);
            const y = 120 + Math.floor(Math.random() * 360);

            walls.push({ x, y, width, height });
        }

        return walls;
    }

    update(deltaTime) {
        const mapWidth = 800;
        const mapHeight = 600;

        Object.values(this.gameState.players).forEach(player => {
            if (player.health <= 0) return;

            // Store old position
            const oldX = player.x;
            const oldY = player.y;

            // Try moving X
            player.x += player.vx * deltaTime;
            let xCollision = false;
            this.gameState.walls.forEach(wall => {
                if (this.isCollidingWithWall(player, wall)) {
                    xCollision = true;
                }
            });
            if (xCollision) player.x = oldX;

            // Try moving Y
            player.y += player.vy * deltaTime;
            let yCollision = false;
            this.gameState.walls.forEach(wall => {
                if (this.isCollidingWithWall(player, wall)) {
                    yCollision = true;
                }
            });
            if (yCollision) player.y = oldY;

            // Clamp to map bounds
            player.x = Math.max(20, Math.min(mapWidth - 20, player.x));
            player.y = Math.max(20, Math.min(mapHeight - 20, player.y));
        });

        this.gameState.bullets = this.gameState.bullets.filter(bullet => {
            bullet.x += bullet.vx * deltaTime;
            bullet.y += bullet.vy * deltaTime;

            if (bullet.x < 0 || bullet.x > mapWidth || bullet.y < 0 || bullet.y > mapHeight) {
                return false;
            }

            for (let wall of this.gameState.walls) {
                if (this.bulletCollidesWithWall(bullet, wall)) {
                    return false;
                }
            }

            for (let playerId in this.gameState.players) {
                const player = this.gameState.players[playerId];
                if (player.id !== bullet.playerId && player.health > 0) {
                    if (this.bulletCollidesWithPlayer(bullet, player)) {
                        player.health -= 50; // 2-shot kill (100 health / 50 damage)
                        if (player.health <= 0) {
                            const shooter = this.gameState.players[bullet.playerId];
                            if (shooter) {
                                shooter.kills = (shooter.kills || 0) + 1;
                            }
                        }
                        return false;
                    }
                }
            }

            return true;
        });

        this.gameState.gameTime += deltaTime;

        // Activate zone after 5 seconds
        if (!this.gameState.zone.active && this.gameState.gameTime >= 5) {
            this.gameState.zone.active = true;
            this.gameState.zone.startTime = this.gameState.gameTime;
        }

        // Update zone - shrink over 30 seconds
        if (this.gameState.zone.active) {
            const zoneDuration = 30;
            const elapsed = this.gameState.gameTime - this.gameState.zone.startTime;
            const progress = Math.min(elapsed / zoneDuration, 1);

            // Shrink to center (400, 300) - final size 200x200
            const targetX = 300;
            const targetY = 250;
            const targetWidth = 200;
            const targetHeight = 200;

            this.gameState.zone.x = targetX * progress;
            this.gameState.zone.y = targetY * progress;
            this.gameState.zone.width = 800 - (600 * progress);
            this.gameState.zone.height = 600 - (400 * progress);

            // Damage players outside zone
            Object.values(this.gameState.players).forEach(player => {
                if (player.health <= 0) return;

                const inZone = player.x >= this.gameState.zone.x &&
                    player.x <= this.gameState.zone.x + this.gameState.zone.width &&
                    player.y >= this.gameState.zone.y &&
                    player.y <= this.gameState.zone.y + this.gameState.zone.height;

                if (!inZone) {
                    player.health -= 10 * deltaTime; // 10 damage per second
                }
            });
        }
    }

    isCollidingWithWall(player, wall) {
        // Reduced player radius from 10 to 8 for tighter hitboxes
        return player.x + 8 > wall.x &&
            player.x - 8 < wall.x + wall.width &&
            player.y + 8 > wall.y &&
            player.y - 8 < wall.y + wall.height;
    }

    bulletCollidesWithWall(bullet, wall) {
        return bullet.x > wall.x &&
            bullet.x < wall.x + wall.width &&
            bullet.y > wall.y &&
            bullet.y < wall.y + wall.height;
    }

    bulletCollidesWithPlayer(bullet, player) {
        const dx = bullet.x - player.x;
        const dy = bullet.y - player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        return distance < 12; // Reduced from 18 to 12
    }

    shoot(playerId, angle) {
        const player = this.gameState.players[playerId];
        if (!player || player.health <= 0) return;

        // Cooldown check - 0.5 second between shots
        const now = Date.now();
        if (now - player.lastShot < 500) return;
        player.lastShot = now;

        const speed = 900; // Increased from 500 to 900
        const bullet = {
            x: player.x + Math.cos(angle) * 25,
            y: player.y + Math.sin(angle) * 25,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            playerId: playerId
        };
        this.gameState.bullets.push(bullet);
    }
}

wss.on('connection', (ws) => {
    let playerId = Math.random().toString(36).substr(2, 9);
    let playerInfo = null;
    let currentLobby = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'join_lobby') {
                playerInfo = {
                    id: playerId,
                    name: data.name,
                    color: data.color
                };
                playerConnections.set(playerId, { ws, playerInfo });

                currentLobby = getOrCreateLobby();

                // Only add if not already in lobby
                if (!currentLobby.players.find(p => p.id === playerId)) {
                    currentLobby.players.push(playerInfo);
                }

                console.log(`Player ${data.name} joined. Lobby count: ${currentLobby.players.length}`);

                // Set start time on first player ONLY
                if (!currentLobby.startTime) {
                    currentLobby.startTime = Date.now();
                    console.log(`⏲️ Setting 5 second timer for game start`);

                    // Start timer only once when first player joins
                    currentLobby.startTimer = setTimeout(() => {
                        console.log(`⏰ TIMER FIRED! Starting game with ${currentLobby.players.length} players`);
                        if (currentLobby.players.length >= 1) {
                            startGame(currentLobby);
                            lobby = null; // Reset for next game
                        } else {
                            console.log(`❌ No players in lobby, not starting`);
                        }
                    }, 5000);
                }

                broadcastLobbyUpdate();
            }

            if (data.type === 'move') {
                const room = Array.from(gameRooms.values()).find(r =>
                    r.gameState.players[playerId]
                );
                if (room) {
                    const player = room.gameState.players[playerId];
                    if (player) {
                        player.vx = data.vx * 120; // Slower movement
                        player.vy = data.vy * 120;
                        player.angle = data.angle;
                    }
                }
            }

            if (data.type === 'shoot') {
                const room = Array.from(gameRooms.values()).find(r =>
                    r.gameState.players[playerId]
                );
                if (room) {
                    room.shoot(playerId, data.angle);
                }
            }

        } catch (e) {
            console.error('Error processing message:', e);
        }
    });

    ws.on('close', () => {
        console.log(`Player disconnected. ID: ${playerId}`);
        playerConnections.delete(playerId);

        if (currentLobby) {
            currentLobby.players = currentLobby.players.filter(p => p.id !== playerId);
            console.log(`Lobby now has ${currentLobby.players.length} players`);

            if (currentLobby.players.length === 0) {
                if (currentLobby.startTimer) {
                    clearTimeout(currentLobby.startTimer);
                }
                lobby = null;
            }
        }
        broadcastLobbyUpdate();
    });
});

function broadcastLobbyUpdate() {
    const lobbyData = lobby ? {
        id: lobby.id,
        playerCount: lobby.players.length,
        maxPlayers: 4,
        players: lobby.players.map(p => {
            const stats = playerStats.get(p.name) || { kills: 0, wins: 0 };
            return {
                name: p.name,
                color: p.color,
                kills: stats.kills,
                wins: stats.wins
            };
        }),
        timeRemaining: lobby.startTime ? Math.max(0, 5 - (Date.now() - lobby.startTime) / 1000) : 5
    } : null;

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'lobby_update',
                lobby: lobbyData,
                playerCount: lobbyData ? lobbyData.playerCount : 0
            }));
        }
    });
}

function startGame(currentLobby) {
    console.log(`🎮 GAME STARTING with ${currentLobby.players.length} players`);
    const room = new GameRoom(currentLobby.id, currentLobby.players);
    gameRooms.set(currentLobby.id, room);

    const players = currentLobby.players;
    let lastUpdateTime = Date.now();
    let frameCount = 0;

    // Send initial game state to all players immediately
    console.log(`📤 Sending game start to ${players.length} players`);
    players.forEach(player => {
        const connection = playerConnections.get(player.id);
        if (connection && connection.ws && connection.ws.readyState === WebSocket.OPEN) {
            try {
                connection.ws.send(JSON.stringify({
                    type: 'game_state',
                    state: room.gameState
                }));
                console.log(`✅ Game state sent to ${player.name}`);
            } catch (e) {
                console.error(`Error sending initial state to ${player.name}:`, e);
            }
        } else {
            console.log(`❌ Cannot reach ${player.name} - connection not ready`);
        }
    });

    const gameLoop = setInterval(() => {
        const now = Date.now();
        const deltaTime = (now - lastUpdateTime) / 1000;
        lastUpdateTime = now;

        room.update(deltaTime);

        const gameState = {
            players: room.gameState.players,
            bullets: room.gameState.bullets,
            walls: room.gameState.walls
        };

        players.forEach(player => {
            const connection = playerConnections.get(player.id);
            if (connection && connection.ws && connection.ws.readyState === WebSocket.OPEN) {
                try {
                    connection.ws.send(JSON.stringify({
                        type: 'game_state',
                        state: gameState
                    }));
                } catch (e) {
                    console.error(`Error sending to player ${player.name}:`, e);
                }
            }
        });

        frameCount++;
        if (frameCount % 60 === 0) {
            console.log(`Game running... frame ${frameCount}, ${players.length} players`);
        }

        // Check if game should end (all but one player dead or time up)
        const alivePlayers = Object.values(room.gameState.players).filter(p => p.health > 0);
        if (alivePlayers.length <= 1) {
            console.log(`🏁 GAME ENDED - Only ${alivePlayers.length} player(s) alive`);
            endGame(room, players, gameLoop);
        }
    }, 1000 / 60);

    setTimeout(() => {
        console.log(`🏁 GAME ENDED - Time expired`);
        endGame(room, players, gameLoop);
    }, 120000);
}

function endGame(room, players, gameLoop) {
    clearInterval(gameLoop);

    // Find winner (last alive or most kills)
    const alivePlayers = Object.values(room.gameState.players).filter(p => p.health > 0);
    const winner = alivePlayers.length === 1 ? alivePlayers[0] :
        Object.values(room.gameState.players).reduce((a, b) => (a.kills > b.kills ? a : b));

    // Save stats
    Object.values(room.gameState.players).forEach(player => {
        const stats = playerStats.get(player.name) || { kills: 0, wins: 0 };
        stats.kills += player.kills || 0;
        if (winner && player.id === winner.id) {
            stats.wins += 1;
        }
        playerStats.set(player.name, stats);
        console.log(`💾 Saved stats for ${player.name}: ${stats.kills} kills, ${stats.wins} wins`);
    });

    gameRooms.delete(room.roomId);

    // Send all players back to lobby
    players.forEach(player => {
        const connection = playerConnections.get(player.id);
        if (connection && connection.ws && connection.ws.readyState === WebSocket.OPEN) {
            connection.ws.send(JSON.stringify({
                type: 'game_end',
                winner: winner ? winner.name : 'None',
                finalStats: Object.values(room.gameState.players).map(p => {
                    const stats = playerStats.get(p.name) || { kills: 0, wins: 0 };
                    return {
                        name: p.name,
                        kills: p.kills || 0,
                        totalKills: stats.kills,
                        totalWins: stats.wins
                    };
                })
            }));
        }
    });

    broadcastLobbyUpdate();
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
