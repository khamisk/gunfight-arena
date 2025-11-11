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

        // Spawn one random powerup
        this.spawnPowerup();
    }

    spawnPowerup() {
        const powerupTypes = ['machinegun', 'ricochet', 'speed', 'noclip', 'cannon', 'gravity'];
        const type = powerupTypes[Math.floor(Math.random() * powerupTypes.length)];

        // Random position avoiding walls
        let x, y;
        let validPosition = false;
        for (let attempt = 0; attempt < 50; attempt++) {
            x = 150 + Math.random() * 500;
            y = 150 + Math.random() * 300;

            // Check if position overlaps with walls
            validPosition = true;
            for (let wall of this.gameState.walls) {
                if (x > wall.x - 30 && x < wall.x + wall.width + 30 &&
                    y > wall.y - 30 && y < wall.y + wall.height + 30) {
                    validPosition = false;
                    break;
                }
            }

            if (validPosition) break;
        }

        this.gameState.powerups.push({
            id: Math.random().toString(36).substr(2, 9),
            type: type,
            x: x,
            y: y,
            radius: 15
        });

        console.log(`💊 Spawned ${type} powerup at (${Math.floor(x)}, ${Math.floor(y)})`);
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

        // Strategic cover walls - thinner walls distributed around map
        const coverSpots = [
            // Top left area
            { x: 150, y: 150, width: 70, height: 10 },
            { x: 150, y: 150, width: 10, height: 70 },

            // Top right area
            { x: 580, y: 150, width: 70, height: 10 },
            { x: 640, y: 150, width: 10, height: 70 },

            // Bottom left area
            { x: 150, y: 440, width: 70, height: 10 },
            { x: 150, y: 380, width: 10, height: 70 },

            // Bottom right area
            { x: 580, y: 440, width: 70, height: 10 },
            { x: 640, y: 380, width: 10, height: 70 },

            // Sparse center cover - minimal middle clustering
            { x: 380, y: 270, width: 10, height: 60 },
            { x: 420, y: 270, width: 10, height: 60 },
        ];

        walls.push(...coverSpots);

        // Add scattered thin cover pieces distributed evenly (15-20)
        const randomCount = 15 + Math.floor(Math.random() * 6);
        // Divide map into grid zones to ensure distribution
        const zones = [
            { minX: 120, maxX: 300, minY: 120, maxY: 240 }, // Top-left quadrant
            { minX: 500, maxX: 680, minY: 120, maxY: 240 }, // Top-right quadrant
            { minX: 120, maxX: 300, minY: 360, maxY: 480 }, // Bottom-left quadrant
            { minX: 500, maxX: 680, minY: 360, maxY: 480 }, // Bottom-right quadrant
            { minX: 300, maxX: 500, minY: 120, maxY: 200 }, // Top-mid
            { minX: 300, maxX: 500, minY: 400, maxY: 480 }, // Bottom-mid
        ];

        for (let i = 0; i < randomCount; i++) {
            const zone = zones[i % zones.length];
            const isHorizontal = Math.random() > 0.5;
            // Thinner walls - width 10 for vertical, height 10 for horizontal
            const width = isHorizontal ? (40 + Math.floor(Math.random() * 50)) : 10;
            const height = isHorizontal ? 10 : (40 + Math.floor(Math.random() * 50));

            const x = zone.minX + Math.floor(Math.random() * (zone.maxX - zone.minX - width));
            const y = zone.minY + Math.floor(Math.random() * (zone.maxY - zone.minY - height));

            walls.push({ x, y, width, height });
        }

        return walls;
    }

    update(deltaTime) {
        const mapWidth = 800;
        const mapHeight = 600;

        Object.values(this.gameState.players).forEach(player => {
            if (player.health <= 0) return;

            // Check if any player has active gravity powerup
            const gravityPlayer = Object.values(this.gameState.players).find(p =>
                p.powerup === 'gravity' && p.powerupTime !== undefined &&
                (this.gameState.gameTime - p.powerupTime) < 5
            );

            // Apply gravity effect to all players except the one with the powerup
            if (gravityPlayer && player.id !== gravityPlayer.id) {
                // Pull player downwards (override their velocity)
                player.vy = 300; // Strong downward force
            }

            // Store old position
            const oldX = player.x;
            const oldY = player.y;

            // Check if player has noclip
            const hasNoclip = player.powerup === 'noclip' && player.powerupTime !== undefined &&
                (this.gameState.gameTime - player.powerupTime) < 5;

            // Try moving X
            player.x += player.vx * deltaTime;
            if (!hasNoclip) {
                let xCollision = false;
                this.gameState.walls.forEach(wall => {
                    if (this.isCollidingWithWall(player, wall)) {
                        xCollision = true;
                    }
                });
                if (xCollision) player.x = oldX;
            }

            // Try moving Y
            player.y += player.vy * deltaTime;
            if (!hasNoclip) {
                let yCollision = false;
                this.gameState.walls.forEach(wall => {
                    if (this.isCollidingWithWall(player, wall)) {
                        yCollision = true;
                    }
                });
                if (yCollision) player.y = oldY;
            }

            // Clamp to map bounds (unless noclip is active)
            if (!hasNoclip) {
                player.x = Math.max(20, Math.min(mapWidth - 20, player.x));
                player.y = Math.max(20, Math.min(mapHeight - 20, player.y));
            } else {
                // With noclip, allow movement outside but keep somewhat reasonable bounds
                player.x = Math.max(-100, Math.min(mapWidth + 100, player.x));
                player.y = Math.max(-100, Math.min(mapHeight + 100, player.y));
            }

            // Check powerup collection
            this.gameState.powerups = this.gameState.powerups.filter(powerup => {
                const dx = player.x - powerup.x;
                const dy = player.y - powerup.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < powerup.radius + 5) {
                    // Player collected powerup
                    player.powerup = powerup.type;
                    player.powerupTime = this.gameState.gameTime;
                    console.log(`💊 ${player.name} collected ${powerup.type} powerup!`);
                    return false; // Remove powerup
                }
                return true;
            });
        });

        this.gameState.bullets = this.gameState.bullets.filter(bullet => {
            bullet.x += bullet.vx * deltaTime;
            bullet.y += bullet.vy * deltaTime;

            if (bullet.x < 0 || bullet.x > mapWidth || bullet.y < 0 || bullet.y > mapHeight) {
                return false;
            }

            // Only check wall collisions if bullet doesn't go through walls
            if (!bullet.throughWalls) {
                for (let wall of this.gameState.walls) {
                    if (this.bulletCollidesWithWall(bullet, wall)) {
                        if (bullet.ricochet && bullet.bounces > 0) {
                            // Calculate bounce
                            const centerX = wall.x + wall.width / 2;
                            const centerY = wall.y + wall.height / 2;
                            const hitFromSide = Math.abs(bullet.x - centerX) / wall.width > Math.abs(bullet.y - centerY) / wall.height;

                            if (hitFromSide) {
                                bullet.vx = -bullet.vx; // Bounce horizontally
                            } else {
                                bullet.vy = -bullet.vy; // Bounce vertically
                            }

                            bullet.bounces--;
                            // Move bullet away from wall to prevent re-collision
                            bullet.x += bullet.vx * deltaTime * 2;
                            bullet.y += bullet.vy * deltaTime * 2;
                        } else {
                            return false;
                        }
                    }
                }
            }

            for (let playerId in this.gameState.players) {
                const player = this.gameState.players[playerId];
                if (player.id !== bullet.playerId && player.health > 0) {
                    if (this.bulletCollidesWithPlayer(bullet, player)) {
                        player.health -= bullet.damage; // Use bullet's damage value
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

        // Check for powerup expiration (5 seconds)
        Object.values(this.gameState.players).forEach(player => {
            if (player.powerup && player.powerupTime !== undefined) {
                const elapsed = this.gameState.gameTime - player.powerupTime;
                if (elapsed >= 5) {
                    console.log(`⏰ ${player.name}'s ${player.powerup} powerup expired!`);
                    player.powerup = null;
                    player.powerupTime = undefined;
                }
            }
        });

        // Activate zone after 5 seconds
        if (!this.gameState.zone.active && this.gameState.gameTime >= 5) {
            this.gameState.zone.active = true;
            this.gameState.zone.startTime = this.gameState.gameTime;
        }

        // Update zone - shrink over 30 seconds to fully closed
        if (this.gameState.zone.active) {
            const zoneDuration = 30;
            const elapsed = this.gameState.gameTime - this.gameState.zone.startTime;
            const progress = Math.min(elapsed / zoneDuration, 1);

            // Shrink to center (400, 300) - final size 0x0 (fully closed)
            const targetX = 400;
            const targetY = 300;

            this.gameState.zone.x = targetX * progress;
            this.gameState.zone.y = targetY * progress;
            this.gameState.zone.width = 800 * (1 - progress);
            this.gameState.zone.height = 600 * (1 - progress);

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
        // Hitbox radius of 5 for tight squeezing through gaps
        return player.x + 5 > wall.x &&
            player.x - 5 < wall.x + wall.width &&
            player.y + 5 > wall.y &&
            player.y - 5 < wall.y + wall.height;
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
        // Use bullet size if available (for cannon), otherwise default
        const bulletRadius = bullet.size || 5;
        return distance < (10 + bulletRadius / 2); // 10px player visual + bullet radius
    }

    shoot(playerId, angle) {
        const player = this.gameState.players[playerId];
        if (!player || player.health <= 0) return;

        const now = Date.now();
        let cooldown = 500; // Default cooldown
        let damage = 50; // Default damage (2-shot kill)
        let ricochet = false;
        let throughWalls = false;
        let bulletSpeed = 900;
        let bulletSize = 5;

        // Check for active powerup
        if (player.powerup) {
            if (player.powerup === 'machinegun') {
                cooldown = 100; // 10 shots per second
                damage = 25; // 4 shots to kill
            } else if (player.powerup === 'ricochet') {
                cooldown = 80; // 12.5 shots per second (very fast spray)
                damage = 12.5; // 8 shots to kill
                ricochet = true;
            } else if (player.powerup === 'cannon') {
                cooldown = 1000; // 1 shot per second
                damage = 100; // 1-shot kill
                throughWalls = true;
                bulletSpeed = 400; // Slower
                bulletSize = 20; // HUGE cannonball
            } else if (player.powerup === 'speed' || player.powerup === 'noclip' || player.powerup === 'gravity') {
                // These powerups don't affect shooting
            }
        }

        // Cooldown check
        if (now - player.lastShot < cooldown) return;
        player.lastShot = now;

        const bullet = {
            x: player.x, // Spawn from center for perfect aim
            y: player.y,
            vx: Math.cos(angle) * bulletSpeed,
            vy: Math.sin(angle) * bulletSpeed,
            playerId: playerId,
            damage: damage,
            ricochet: ricochet,
            bounces: ricochet ? 3 : 0,
            throughWalls: throughWalls,
            size: bulletSize
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
                        // Check if player has speed powerup
                        const hasSpeed = player.powerup === 'speed' && player.powerupTime !== undefined &&
                            (room.gameState.gameTime - player.powerupTime) < 5;

                        const speedMultiplier = hasSpeed ? 300 : 120; // 2.5x faster with speed powerup
                        player.vx = data.vx * speedMultiplier;
                        player.vy = data.vy * speedMultiplier;
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

        // Add persistent stats (wins) to player data
        const playersWithStats = {};
        Object.keys(room.gameState.players).forEach(playerId => {
            const player = room.gameState.players[playerId];
            const stats = playerStats.get(player.name) || { kills: 0, wins: 0 };
            playersWithStats[playerId] = {
                ...player,
                wins: stats.wins
            };
        });

        const gameState = {
            players: playersWithStats,
            bullets: room.gameState.bullets,
            walls: room.gameState.walls,
            zone: room.gameState.zone,
            powerups: room.gameState.powerups,
            gameTime: room.gameState.gameTime
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
            stats.wins += 1; // +1 win for winning only
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
