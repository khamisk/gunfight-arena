const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '../public')));

const COLORS = ['blue', 'red', 'yellow', 'green'];
let lobbies = new Map();
let gameRooms = new Map();
let playerConnections = new Map();

class GameRoom {
    constructor(roomId, players) {
        this.roomId = roomId;
        this.players = players;
        this.gameState = {
            players: {},
            bullets: [],
            walls: this.generateWalls(),
            gameTime: 0,
            winner: null
        };

        players.forEach((player, idx) => {
            this.gameState.players[player.id] = {
                id: player.id,
                name: player.name,
                color: player.color,
                x: 100 + idx * 150,
                y: 100 + idx * 150,
                angle: 0,
                vx: 0,
                vy: 0,
                health: 100,
                score: 0
            };
        });
    }

    generateWalls() {
        return [
            { x: 200, y: 200, width: 100, height: 20 },
            { x: 400, y: 250, width: 20, height: 150 },
            { x: 300, y: 400, width: 150, height: 20 },
            { x: 100, y: 350, width: 20, height: 100 },
            { x: 500, y: 100, width: 100, height: 20 },
            { x: 350, y: 550, width: 150, height: 20 }
        ];
    }

    update(deltaTime) {
        const mapWidth = 800;
        const mapHeight = 600;

        Object.values(this.gameState.players).forEach(player => {
            if (player.health <= 0) return;

            player.x += player.vx * deltaTime;
            player.y += player.vy * deltaTime;

            player.x = Math.max(20, Math.min(mapWidth - 20, player.x));
            player.y = Math.max(20, Math.min(mapHeight - 20, player.y));

            this.gameState.walls.forEach(wall => {
                if (this.isCollidingWithWall(player, wall)) {
                    player.x -= player.vx * deltaTime;
                    player.y -= player.vy * deltaTime;
                }
            });
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
                        player.health -= 10;
                        if (player.health <= 0) {
                            const shooter = this.gameState.players[bullet.playerId];
                            if (shooter) shooter.score += 1;
                        }
                        return false;
                    }
                }
            }

            return true;
        });

        this.gameState.gameTime += deltaTime;
    }

    isCollidingWithWall(player, wall) {
        return player.x + 15 > wall.x &&
            player.x - 15 < wall.x + wall.width &&
            player.y + 15 > wall.y &&
            player.y - 15 < wall.y + wall.height;
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
        return distance < 25;
    }

    shoot(playerId, angle) {
        const player = this.gameState.players[playerId];
        if (!player || player.health <= 0) return;

        const speed = 400;
        const bullet = {
            x: player.x + Math.cos(angle) * 20,
            y: player.y + Math.sin(angle) * 20,
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

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'join_lobby') {
                playerInfo = {
                    id: playerId,
                    name: data.name,
                    color: data.color
                };
                playerConnections.set(playerId, ws);

                let lobby = Array.from(lobbies.values()).find(l => l.players.length < 4);
                if (!lobby) {
                    lobby = {
                        id: Math.random().toString(36).substr(2, 9),
                        players: []
                    };
                    lobbies.set(lobby.id, lobby);
                }

                lobby.players.push(playerInfo);

                broadcastLobbyUpdate();

                if (!lobby.startTimer) {
                    lobby.startTimer = setTimeout(() => {
                        if (lobby.players.length >= 1) {
                            startGame(lobby);
                        }
                    }, 10000);
                }
            }

            if (data.type === 'move') {
                const room = Array.from(gameRooms.values()).find(r =>
                    r.gameState.players[playerId]
                );
                if (room) {
                    const player = room.gameState.players[playerId];
                    if (player) {
                        player.vx = data.vx * 200;
                        player.vy = data.vy * 200;
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
        playerConnections.delete(playerId);
        lobbies.forEach((lobby, lobbyId) => {
            lobby.players = lobby.players.filter(p => p.id !== playerId);
            if (lobby.players.length === 0) {
                lobbies.delete(lobbyId);
            }
        });
        broadcastLobbyUpdate();
    });
});

function broadcastLobbyUpdate() {
    const lobbyData = Array.from(lobbies.values()).map(lobby => ({
        id: lobby.id,
        playerCount: lobby.players.length,
        maxPlayers: 4
    }));

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'lobby_update',
                lobbies: lobbyData
            }));
        }
    });
}

function startGame(lobby) {
    const room = new GameRoom(lobby.id, lobby.players);
    gameRooms.set(lobby.id, room);
    lobbies.delete(lobby.id);

    const players = lobby.players;
    let lastUpdateTime = Date.now();

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
            const conn = playerConnections.get(player.id);
            if (conn && conn.readyState === WebSocket.OPEN) {
                conn.send(JSON.stringify({
                    type: 'game_state',
                    state: gameState
                }));
            }
        });
    }, 1000 / 60);

    setTimeout(() => {
        clearInterval(gameLoop);
        gameRooms.delete(lobby.id);
        broadcastLobbyUpdate();
    }, 120000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
