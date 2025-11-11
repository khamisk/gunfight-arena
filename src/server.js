const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '../public')));

const COLORS = ['blue', 'red', 'yellow', 'green', 'purple', 'orange', 'cyan', 'pink', 'lime', 'indigo', 'teal', 'magenta'];
let lobbies = new Map(); // lobbyId -> {id, name, hostId, password, players: [], maxPlayers, startTimer}
let gameRooms = new Map();
let playerConnections = new Map(); // playerId -> {ws, playerInfo, currentLobby}
let playerStats = new Map(); // Persistent stats: name -> {kills, wins}

class GameRoom {
    constructor(roomId, players) {
        this.roomId = roomId;
        this.players = players;
        this.gameState = {
            players: {},
            bullets: [],
            walls: this.generateWalls(),
            powerups: [],
            powerupNotifications: [], // {playerName, powerupType, time}
            gameTime: 0,
            winner: null,
            powerupsSpawned: 0,
            lastPowerupSpawn: 0,
            railgunLaser: null, // {startX, startY, angle, length, time}
            zone: {
                x: 0,
                y: 0,
                width: 800,
                height: 600,
                active: false,
                startTime: null
            }
        };

        // Random spawn positions for all players
        players.forEach((player, idx) => {
            let spawn = null;

            // Find a random spawn position that doesn't collide with walls
            for (let attempt = 0; attempt < 50; attempt++) {
                spawn = {
                    x: 100 + Math.random() * 600,
                    y: 100 + Math.random() * 400
                };

                let collides = false;
                const testPlayer = { x: spawn.x, y: spawn.y };

                // Check wall collision
                for (let wall of this.gameState.walls) {
                    if (this.isCollidingWithWall(testPlayer, wall)) {
                        collides = true;
                        break;
                    }
                }

                // Check distance from other players (minimum 100 pixels apart)
                for (let existingPlayerId in this.gameState.players) {
                    const existing = this.gameState.players[existingPlayerId];
                    const dist = Math.hypot(spawn.x - existing.x, spawn.y - existing.y);
                    if (dist < 100) {
                        collides = true;
                        break;
                    }
                }

                if (!collides) break;
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
                powerup: null, // Various powerup types
                railgunCharging: false, // For railgun powerup
                railgunChargeStart: 0, // When charge started
                blinkCooldown: 0, // Blink dash cooldown
                bouncyBallUsed: false, // One-time bouncy ball
                chatMessage: null, // Current chat message
                chatTime: 0, // When chat message was sent
                emoji: null, // Current emoji
                emojiTime: 0 // When emoji was shown
            };
        });

        // Powerups will spawn at 5s and 20s (no initial spawn)
    }

    spawnPowerup() {
        const powerupTypes = ['machinegun', 'ricochet', 'speed', 'noclip', 'cannon', 'gravity', 'railgun', 'blink', 'bouncyball'];
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

        // Add scattered thin cover pieces distributed evenly (40-50 walls for more tactical gameplay)
        const randomCount = 40 + Math.floor(Math.random() * 11);
        // Divide map into grid zones to ensure distribution - more focus on outer-middle areas
        const zones = [
            { minX: 120, maxX: 300, minY: 120, maxY: 240 }, // Top-left quadrant
            { minX: 500, maxX: 680, minY: 120, maxY: 240 }, // Top-right quadrant
            { minX: 120, maxX: 300, minY: 360, maxY: 480 }, // Bottom-left quadrant
            { minX: 500, maxX: 680, minY: 360, maxY: 480 }, // Bottom-right quadrant
            { minX: 250, maxX: 550, minY: 100, maxY: 220 }, // Top-mid (outer)
            { minX: 250, maxX: 550, minY: 380, maxY: 500 }, // Bottom-mid (outer)
            { minX: 100, maxX: 250, minY: 250, maxY: 350 }, // Left-mid (outer)
            { minX: 550, maxX: 700, minY: 250, maxY: 350 }, // Right-mid (outer)
            { minX: 300, maxX: 500, minY: 200, maxY: 400 }, // Center area (more walls)
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
        const updateStartTime = Date.now();

        try {
            // Cap deltaTime to prevent huge jumps from causing issues
            // Max 0.1s (100ms) to prevent extreme position changes
            if (deltaTime > 0.1) {
                console.warn(`⚠️ Large deltaTime capped: ${deltaTime.toFixed(3)}s -> 0.1s`);
                deltaTime = 0.1;
            }

            const mapWidth = 800;
            const mapHeight = 600;

            // Check once for gravity player (optimization - moved outside player loop)
            const gravityPlayer = Object.values(this.gameState.players).find(p =>
                p.powerup === 'gravity' && p.powerupTime !== undefined &&
                (this.gameState.gameTime - p.powerupTime) < 5
            );

            Object.values(this.gameState.players).forEach(player => {
                if (player.health <= 0) return;

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
                    // Use .some() to stop checking once collision found (optimization)
                    const xCollision = this.gameState.walls.some(wall =>
                        this.isCollidingWithWall(player, wall)
                    );
                    if (xCollision) player.x = oldX;
                }

                // Try moving Y
                player.y += player.vy * deltaTime;
                if (!hasNoclip) {
                    // Use .some() to stop checking once collision found (optimization)
                    const yCollision = this.gameState.walls.some(wall =>
                        this.isCollidingWithWall(player, wall)
                    );
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

                // Validate player position - prevent NaN propagation
                if (isNaN(player.x) || isNaN(player.y) || !isFinite(player.x) || !isFinite(player.y)) {
                    console.error(`❌ CRITICAL: Player ${player.name} has invalid position! x:${player.x}, y:${player.y}, vx:${player.vx}, vy:${player.vy}`);
                    // Reset to safe position
                    player.x = 400;
                    player.y = 300;
                    player.vx = 0;
                    player.vy = 0;
                }

                // Validate player velocity
                if (isNaN(player.vx) || isNaN(player.vy) || !isFinite(player.vx) || !isFinite(player.vy)) {
                    console.error(`❌ CRITICAL: Player ${player.name} has invalid velocity! vx:${player.vx}, vy:${player.vy}`);
                    player.vx = 0;
                    player.vy = 0;
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

                        // Add notification for all players to see
                        this.gameState.powerupNotifications.push({
                            playerName: player.name,
                            powerupType: powerup.type,
                            time: this.gameState.gameTime
                        });

                        console.log(`💊 ${player.name} collected ${powerup.type} powerup!`);
                        return false; // Remove powerup
                    }
                    return true;
                });
            });

            this.gameState.bullets = this.gameState.bullets.filter(bullet => {
                bullet.x += bullet.vx * deltaTime;
                bullet.y += bullet.vy * deltaTime;

                // Validate bullet position - prevent NaN propagation
                if (isNaN(bullet.x) || isNaN(bullet.y) || !isFinite(bullet.x) || !isFinite(bullet.y)) {
                    console.error(`❌ CRITICAL: Bullet has invalid position! x:${bullet.x}, y:${bullet.y}, vx:${bullet.vx}, vy:${bullet.vy}`);
                    return false; // Remove invalid bullet
                }

                // Validate bullet velocity
                if (isNaN(bullet.vx) || isNaN(bullet.vy) || !isFinite(bullet.vx) || !isFinite(bullet.vy)) {
                    console.error(`❌ CRITICAL: Bullet has invalid velocity! vx:${bullet.vx}, vy:${bullet.vy}`);
                    return false; // Remove invalid bullet
                }

                // Bounce off map edges for ricochet bullets, remove others
                if (bullet.x < 0 || bullet.x > mapWidth || bullet.y < 0 || bullet.y > mapHeight) {
                    if (bullet.ricochet && bullet.bounces > 0) {
                        // Bounce off edges
                        if (bullet.x < 0 || bullet.x > mapWidth) {
                            bullet.vx = -bullet.vx;
                            bullet.x = Math.max(0, Math.min(mapWidth, bullet.x));
                        }
                        if (bullet.y < 0 || bullet.y > mapHeight) {
                            bullet.vy = -bullet.vy;
                            bullet.y = Math.max(0, Math.min(mapHeight, bullet.y));
                        }
                        bullet.bounces--;
                    } else {
                        return false;
                    }
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
                                break; // Stop checking walls after first collision
                            } else {
                                return false; // Remove bullet
                            }
                        }
                    }
                }

                for (let playerId in this.gameState.players) {
                    const player = this.gameState.players[playerId];

                    // Huge bouncy ball (infiniteBounce) can damage the shooter too, but with 1 second immunity
                    let canHit;
                    if (bullet.bounces === 999999) {
                        // Bouncy ball - check immunity period
                        const immunityTime = bullet.spawnTime ? (this.gameState.gameTime - bullet.spawnTime) : 999;
                        const isShooter = player.id === bullet.playerId;
                        canHit = player.health > 0 && (!isShooter || immunityTime >= 1); // 1 second immunity for shooter
                    } else {
                        // Normal bullets - can't hit shooter
                        canHit = player.id !== bullet.playerId && player.health > 0;
                    }

                    if (canHit) {
                        if (this.bulletCollidesWithPlayer(bullet, player)) {
                            player.health -= bullet.damage; // Use bullet's damage value
                            if (player.health <= 0) {
                                const shooter = this.gameState.players[bullet.playerId];
                                if (shooter) {
                                    shooter.kills = (shooter.kills || 0) + 1;
                                }
                            }
                            // Huge bouncy ball doesn't get removed on hit, keeps bouncing forever
                            return bullet.bounces !== 999999 ? false : true;
                        }
                    }
                }

                return true;
            });

            // Safety: limit total bullets to prevent memory issues
            const MAX_BULLETS = 500;
            if (this.gameState.bullets.length > MAX_BULLETS) {
                console.warn(`⚠️ Too many bullets (${this.gameState.bullets.length}), removing oldest`);
                this.gameState.bullets = this.gameState.bullets.slice(-MAX_BULLETS);
            }

            this.gameState.gameTime += deltaTime;

            // Clean up old notifications (remove after 3 seconds)
            this.gameState.powerupNotifications = this.gameState.powerupNotifications.filter(
                notif => (this.gameState.gameTime - notif.time) < 3
            );

            // Clean up railgun laser after 0.2 seconds
            if (this.gameState.railgunLaser && (this.gameState.gameTime - this.gameState.railgunLaser.time) > 0.2) {
                this.gameState.railgunLaser = null;
            }

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

                // Clean up chat messages after 5 seconds
                if (player.chatMessage && (this.gameState.gameTime - player.chatTime) > 5) {
                    player.chatMessage = null;
                }

                // Clean up emojis after 3 seconds
                if (player.emoji && (this.gameState.gameTime - player.emojiTime) > 3) {
                    player.emoji = null;
                }
            });

            // Spawn powerups at specific times: 5 seconds and 20 seconds
            if (this.gameState.powerupsSpawned === 0 && this.gameState.gameTime >= 5) {
                this.spawnPowerup();
                this.gameState.powerupsSpawned++;
                console.log('🎁 First powerup spawned at 5 seconds!');
            } else if (this.gameState.powerupsSpawned === 1 && this.gameState.gameTime >= 20) {
                this.spawnPowerup();
                this.gameState.powerupsSpawned++;
                console.log('🎁 Second powerup spawned at 20 seconds!');
            }

            // Activate zone after 10 seconds (give players more time)
            if (!this.gameState.zone.active && this.gameState.gameTime >= 10) {
                this.gameState.zone.active = true;
                this.gameState.zone.startTime = this.gameState.gameTime;
            }

            // Update zone - shrink over 50 seconds to fully closed (slower)
            if (this.gameState.zone.active) {
                const zoneDuration = 50;
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

            // Watchdog: warn if update took too long (blocking event loop)
            const updateDuration = Date.now() - updateStartTime;
            if (updateDuration > 16) { // More than 1 frame at 60fps
                console.warn(`⚠️ Slow update: ${updateDuration}ms (players: ${Object.keys(this.gameState.players).length}, bullets: ${this.gameState.bullets.length})`);
            }
        } catch (error) {
            console.error('❌ ERROR in update() - Game may freeze:', error);
            console.error('Game State:', {
                gameTime: this.gameState.gameTime,
                playerCount: Object.keys(this.gameState.players).length,
                bulletCount: this.gameState.bullets.length,
                deltaTime: deltaTime
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

        // Validate angle - prevent NaN or invalid values that can freeze the server
        if (typeof angle !== 'number' || isNaN(angle) || !isFinite(angle)) {
            console.warn(`⚠️ Invalid angle received from ${player.name}: ${angle}`);
            return;
        }

        const now = Date.now();
        let cooldown = 500; // Default cooldown
        let damage = 50; // Default damage (2-shot kill)
        let ricochet = false;
        let throughWalls = false;
        let bulletSpeed = 900;
        let bulletSize = 5;
        let infiniteBounce = false;

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
            } else if (player.powerup === 'bouncyball' && !player.bouncyBallUsed) {
                // One-time huge bouncy ball
                player.bouncyBallUsed = true;
                damage = 50;
                bulletSpeed = 200; // Much slower - dodgeable
                bulletSize = 40; // HUGE ball
                infiniteBounce = true;
            } else if (player.powerup === 'railgun') {
                // Railgun disables normal shooting
                return;
            } else if (player.powerup === 'speed' || player.powerup === 'noclip' || player.powerup === 'gravity' || player.powerup === 'blink') {
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
            ricochet: ricochet || infiniteBounce,
            bounces: infiniteBounce ? 999999 : (ricochet ? 5 : 0), // Ricochet now bounces 5 times
            throughWalls: throughWalls,
            size: bulletSize,
            spawnTime: infiniteBounce ? this.gameState.gameTime : undefined // Track spawn time for bouncy ball immunity
        };
        this.gameState.bullets.push(bullet);
    }

    fireRailgun(playerId, angle) {
        const player = this.gameState.players[playerId];
        if (!player || player.health <= 0) return;
        if (player.powerup !== 'railgun' || !player.railgunCharging) return;

        // Validate angle
        if (typeof angle !== 'number' || isNaN(angle) || !isFinite(angle)) {
            console.warn(`⚠️ Invalid railgun angle from ${player.name}: ${angle}`);
            return;
        }

        const chargeTime = this.gameState.gameTime - player.railgunChargeStart;
        if (chargeTime < 2) return; // Must charge for 2 seconds

        player.railgunCharging = false;

        // Remove railgun powerup after firing (one-time use)
        player.powerup = null;
        player.powerupTime = undefined;

        // Fire railgun beam as a projectile (extremely fast but has travel time)
        const beamSpeed = 2500; // Very fast but barely dodgeable
        const beam = {
            x: player.x,
            y: player.y,
            vx: Math.cos(angle) * beamSpeed,
            vy: Math.sin(angle) * beamSpeed,
            playerId: playerId,
            damage: 100, // Instant kill
            railgun: true,
            size: 15, // Thick beam
            throughWalls: true
        };
        this.gameState.bullets.push(beam);

        console.log(`⚡ ${player.name} fired railgun! (one-time use consumed)`);
    }

    blinkDash(playerId, angle) {
        const player = this.gameState.players[playerId];
        if (!player || player.health <= 0) return;
        if (player.powerup !== 'blink') return;

        // Validate angle
        if (typeof angle !== 'number' || isNaN(angle) || !isFinite(angle)) {
            console.warn(`⚠️ Invalid blink dash angle from ${player.name}: ${angle}`);
            return;
        }

        const now = this.gameState.gameTime;
        const powerupTime = player.powerupTime || 0;
        const powerupElapsed = now - powerupTime;

        if (powerupElapsed >= 5) return; // Powerup expired

        if (now - player.blinkCooldown < 0.5) return; // 0.5s cooldown between dashes

        player.blinkCooldown = now;

        // Dash 150 pixels in direction
        const dashDist = 150;
        const targetX = player.x + Math.cos(angle) * dashDist;
        const targetY = player.y + Math.sin(angle) * dashDist;

        // Check wall collision
        let finalX = targetX;
        let finalY = targetY;

        for (let wall of this.gameState.walls) {
            const closestX = Math.max(wall.x, Math.min(targetX, wall.x + wall.width));
            const closestY = Math.max(wall.y, Math.min(targetY, wall.y + wall.height));
            const dist = Math.hypot(targetX - closestX, targetY - closestY);

            if (dist < 20) { // Collision
                // Stop at wall
                const toWallX = closestX - player.x;
                const toWallY = closestY - player.y;
                const wallDist = Math.hypot(toWallX, toWallY) - 20;
                finalX = player.x + (toWallX / Math.hypot(toWallX, toWallY)) * wallDist;
                finalY = player.y + (toWallY / Math.hypot(toWallX, toWallY)) * wallDist;
                break;
            }
        }

        player.x = finalX;
        player.y = finalY;
    }
}

wss.on('connection', (ws) => {
    let playerId = Math.random().toString(36).substr(2, 9);
    let playerInfo = null;
    let currentLobby = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // Get lobbies list
            if (data.type === 'get_lobbies') {
                const lobbiesList = Array.from(lobbies.values()).map(lobby => ({
                    id: lobby.id,
                    name: lobby.name,
                    playerCount: lobby.players.length,
                    maxPlayers: lobby.maxPlayers,
                    hasPassword: !!lobby.password,
                    hostName: lobby.players.find(p => p.id === lobby.hostId)?.name || 'Host'
                }));

                try {
                    ws.send(JSON.stringify({
                        type: 'lobbies_list',
                        lobbies: lobbiesList
                    }));
                } catch (e) {
                    console.error('Error sending lobby list:', e);
                }
            }

            // Create lobby
            if (data.type === 'create_lobby') {
                // Get player stats
                const stats = playerStats.get(data.playerName) || { kills: 0, wins: 0 };

                playerInfo = {
                    id: playerId,
                    name: data.playerName,
                    color: data.color || COLORS[0],
                    wins: stats.wins,
                    kills: stats.kills
                };

                const newLobby = {
                    id: Math.random().toString(36).substr(2, 9),
                    name: data.name || `${data.playerName}'s Lobby`,
                    hostId: playerId,
                    password: data.password || null,
                    players: [playerInfo],
                    maxPlayers: 6
                };

                lobbies.set(newLobby.id, newLobby);
                playerConnections.set(playerId, { ws, playerInfo, currentLobby: newLobby.id });

                console.log(`📝 ${data.playerName} created lobby: ${newLobby.name}`);

                ws.send(JSON.stringify({
                    type: 'lobby_joined',
                    lobbyId: newLobby.id
                }));

                broadcastToLobby(newLobby.id);
                broadcastLobbyList();
            }

            // Join lobby
            if (data.type === 'join_lobby') {
                const targetLobby = lobbies.get(data.lobbyId);

                if (!targetLobby) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Lobby not found' }));
                    return;
                }

                if (targetLobby.password && targetLobby.password !== data.password) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Incorrect password' }));
                    return;
                }

                if (targetLobby.players.length >= targetLobby.maxPlayers) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Lobby is full' }));
                    return;
                }

                // Find available color
                const usedColors = targetLobby.players.map(p => p.color);
                const availableColor = COLORS.find(c => !usedColors.includes(c)) || COLORS[0];

                // Get player stats
                const stats = playerStats.get(data.name) || { kills: 0, wins: 0 };

                playerInfo = {
                    id: playerId,
                    name: data.name,
                    color: availableColor,
                    wins: stats.wins,
                    kills: stats.kills
                };

                targetLobby.players.push(playerInfo);
                playerConnections.set(playerId, { ws, playerInfo, currentLobby: data.lobbyId });

                console.log(`👤 ${data.name} joined lobby: ${targetLobby.name}`);

                ws.send(JSON.stringify({
                    type: 'lobby_joined',
                    lobbyId: data.lobbyId
                }));

                // Notify all players in lobby
                broadcastToLobby(data.lobbyId);
                broadcastLobbyList();
            }

            // Get lobby state (for returning after game)
            if (data.type === 'get_lobby_state') {
                const targetLobby = lobbies.get(data.lobbyId);
                if (targetLobby) {
                    const connection = playerConnections.get(playerId);
                    if (connection && connection.ws.readyState === WebSocket.OPEN) {
                        connection.ws.send(JSON.stringify({
                            type: 'lobby_update',
                            lobby: targetLobby,
                            isHost: targetLobby.hostId === playerId
                        }));
                    }
                }
            }

            // Change color in lobby
            if (data.type === 'change_color') {
                const connection = playerConnections.get(playerId);
                if (connection && connection.currentLobby) {
                    const targetLobby = lobbies.get(connection.currentLobby);
                    if (targetLobby) {
                        const usedColors = targetLobby.players.filter(p => p.id !== playerId).map(p => p.color);
                        if (!usedColors.includes(data.color)) {
                            const player = targetLobby.players.find(p => p.id === playerId);
                            if (player) {
                                player.color = data.color;
                                connection.playerInfo.color = data.color;
                                broadcastToLobby(connection.currentLobby);
                            }
                        }
                    }
                }
            }

            // Start game (host only)
            if (data.type === 'start_game') {
                const connection = playerConnections.get(playerId);
                if (connection && connection.currentLobby) {
                    const targetLobby = lobbies.get(connection.currentLobby);
                    if (targetLobby && targetLobby.hostId === playerId) {
                        console.log(`🎮 Host starting game in lobby: ${targetLobby.name}`);
                        startGame(targetLobby);
                        // DON'T delete the lobby - keep it for after game ends
                        // lobbies.delete(targetLobby.id);
                        broadcastLobbyList();
                    }
                }
            }

            // Leave lobby
            if (data.type === 'leave_lobby') {
                const connection = playerConnections.get(playerId);
                if (connection && connection.currentLobby) {
                    const targetLobby = lobbies.get(connection.currentLobby);
                    if (targetLobby) {
                        targetLobby.players = targetLobby.players.filter(p => p.id !== playerId);

                        if (targetLobby.players.length === 0) {
                            lobbies.delete(targetLobby.id);
                            console.log(`🗑️ Lobby deleted: ${targetLobby.name}`);
                        } else if (targetLobby.hostId === playerId) {
                            // Transfer host
                            targetLobby.hostId = targetLobby.players[0].id;
                            console.log(`👑 Host transferred to ${targetLobby.players[0].name}`);
                            broadcastToLobby(connection.currentLobby);
                        } else {
                            broadcastToLobby(connection.currentLobby);
                        }

                        connection.currentLobby = null;
                        broadcastLobbyList();
                    }
                }
            }

            // Kick player (host only)
            if (data.type === 'kick_player') {
                const connection = playerConnections.get(playerId);
                if (connection && connection.currentLobby) {
                    const targetLobby = lobbies.get(connection.currentLobby);
                    if (targetLobby && targetLobby.hostId === playerId) {
                        const kickedPlayerId = data.playerId;
                        const kickedPlayer = targetLobby.players.find(p => p.id === kickedPlayerId);
                        if (kickedPlayer) {
                            targetLobby.players = targetLobby.players.filter(p => p.id !== kickedPlayerId);

                            const kickedConnection = playerConnections.get(kickedPlayerId);
                            if (kickedConnection) {
                                kickedConnection.currentLobby = null;
                                kickedConnection.ws.send(JSON.stringify({ type: 'kicked' }));
                            }

                            console.log(`🚪 ${kickedPlayer.name} kicked from ${targetLobby.name}`);
                            broadcastToLobby(connection.currentLobby);
                            broadcastLobbyList();
                        }
                    }
                }
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
                // Validate angle before processing
                if (typeof data.angle !== 'number' || isNaN(data.angle) || !isFinite(data.angle)) {
                    console.warn(`⚠️ Invalid shoot angle received: ${data.angle}`);
                    return;
                }

                const room = Array.from(gameRooms.values()).find(r =>
                    r.gameState.players[playerId]
                );
                if (room) {
                    room.shoot(playerId, data.angle);
                }
            }

            if (data.type === 'railgun_charge_start') {
                const room = Array.from(gameRooms.values()).find(r =>
                    r.gameState.players[playerId]
                );
                if (room) {
                    const player = room.gameState.players[playerId];
                    if (player && player.powerup === 'railgun') {
                        player.railgunCharging = true;
                        player.railgunChargeStart = room.gameState.gameTime;
                        player.vx = 0; // Stop movement
                        player.vy = 0;
                    }
                }
            }

            if (data.type === 'railgun_charge_cancel') {
                const room = Array.from(gameRooms.values()).find(r =>
                    r.gameState.players[playerId]
                );
                if (room) {
                    const player = room.gameState.players[playerId];
                    if (player) {
                        player.railgunCharging = false;
                    }
                }
            }

            if (data.type === 'railgun_fire') {
                const room = Array.from(gameRooms.values()).find(r =>
                    r.gameState.players[playerId]
                );
                if (room) {
                    room.fireRailgun(playerId, data.angle);
                }
            }

            if (data.type === 'blink_dash') {
                const room = Array.from(gameRooms.values()).find(r =>
                    r.gameState.players[playerId]
                );
                if (room) {
                    room.blinkDash(playerId, data.angle);
                }
            }

            if (data.type === 'chat') {
                const room = Array.from(gameRooms.values()).find(r =>
                    r.gameState.players[playerId]
                );
                if (room) {
                    const player = room.gameState.players[playerId];
                    if (player && data.message) {
                        // Limit message length
                        player.chatMessage = data.message.substring(0, 100);
                        player.chatTime = room.gameState.gameTime;
                        console.log(`💬 ${player.name}: ${player.chatMessage}`);
                    }
                }
            }

            if (data.type === 'emoji') {
                const room = Array.from(gameRooms.values()).find(r =>
                    r.gameState.players[playerId]
                );
                if (room) {
                    const player = room.gameState.players[playerId];
                    if (player && data.emoji) {
                        player.emoji = data.emoji;
                        player.emojiTime = room.gameState.gameTime;
                        console.log(`😀 ${player.name} used emoji: ${data.emoji}`);
                    }
                }
            }

            if (data.type === 'admin_powerup') {
                const room = Array.from(gameRooms.values()).find(r =>
                    r.gameState.players[playerId]
                );
                if (room) {
                    const player = room.gameState.players[playerId];
                    if (player && data.powerup) {
                        player.powerup = data.powerup;
                        player.powerupTime = room.gameState.gameTime;
                        player.bouncyBallUsed = false; // Reset bouncy ball
                        console.log(`⚡ Admin: ${player.name} got ${data.powerup}`);
                    }
                }
            }

            if (data.type === 'admin_reset_game') {
                const room = Array.from(gameRooms.values()).find(r =>
                    r.gameState.players[playerId]
                );
                if (room) {
                    console.log(`� Admin: Force resetting game!`);

                    // Clear game timeout to prevent double-ending
                    if (room.gameTimeout) {
                        clearTimeout(room.gameTimeout);
                    }

                    // Use the proper endGame function which handles everything correctly
                    const players = room.players || Object.values(room.gameState.players).map(p => ({
                        id: p.id,
                        name: p.name
                    }));

                    endGame(room, players, room.gameLoop);

                    console.log(`✅ Game forcefully reset by admin - players returned to lobby`);
                }
            }

        } catch (e) {
            console.error('Error processing message:', e);
        }
    });

    ws.on('close', () => {
        console.log(`Player disconnected. ID: ${playerId}`);
        const connection = playerConnections.get(playerId);

        if (connection && connection.currentLobby) {
            const targetLobby = lobbies.get(connection.currentLobby);
            if (targetLobby) {
                targetLobby.players = targetLobby.players.filter(p => p.id !== playerId);
                console.log(`${connection.playerInfo?.name || 'Player'} left ${targetLobby.name}. ${targetLobby.players.length} players remaining.`);

                if (targetLobby.players.length === 0) {
                    lobbies.delete(targetLobby.id);
                    console.log(`🗑️ Lobby deleted: ${targetLobby.name}`);
                } else if (targetLobby.hostId === playerId) {
                    // Transfer host
                    targetLobby.hostId = targetLobby.players[0].id;
                    console.log(`👑 Host transferred to ${targetLobby.players[0].name}`);
                    broadcastToLobby(connection.currentLobby);
                } else {
                    broadcastToLobby(connection.currentLobby);
                }

                broadcastLobbyList();
            }
        }

        playerConnections.delete(playerId);
    });
});

// Throttle lobby list broadcasts to prevent event loop blocking
let lastLobbyBroadcast = 0;
const LOBBY_BROADCAST_THROTTLE = 100; // Max once per 100ms

function broadcastLobbyList() {
    const now = Date.now();

    // Throttle broadcasts - if called too frequently, skip
    if (now - lastLobbyBroadcast < LOBBY_BROADCAST_THROTTLE) {
        return;
    }
    lastLobbyBroadcast = now;

    try {
        const lobbiesList = Array.from(lobbies.values()).map(lobby => ({
            id: lobby.id,
            name: lobby.name,
            playerCount: lobby.players.length,
            maxPlayers: lobby.maxPlayers,
            hasPassword: !!lobby.password,
            hostName: lobby.players.find(p => p.id === lobby.hostId)?.name || 'Host'
        }));

        const message = JSON.stringify({
            type: 'lobbies_list',
            lobbies: lobbiesList
        });

        let sentCount = 0;
        let errorCount = 0;
        let skippedCount = 0;

        // Only send to clients not currently in a game
        wss.clients.forEach(client => {
            // Skip non-open connections immediately (optimization)
            if (client.readyState !== WebSocket.OPEN) {
                skippedCount++;
                return;
            }

            try {
                client.send(message);
                sentCount++;
            } catch (e) {
                errorCount++;
                console.error('Error sending to client:', e.message);
            }
        });

        // Warn if too many dead connections
        if (skippedCount > 10) {
            console.warn(`⚠️ ${skippedCount} dead connections still in wss.clients`);
        }

        if (errorCount > 0) {
            console.warn(`⚠️ Lobby broadcast: ${sentCount} sent, ${errorCount} errors`);
        }
    } catch (error) {
        console.error('❌ CRITICAL ERROR in broadcastLobbyList:', error);
    }
}

function broadcastToLobby(lobbyId) {
    try {
        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        console.log(`📢 Broadcasting lobby update: ${lobby.name} (${lobby.players.length} players)`);

        const message = JSON.stringify({
            type: 'lobby_update',
            lobby: lobby
        });

        let sentCount = 0;
        let errorCount = 0;

        lobby.players.forEach(player => {
            const connection = playerConnections.get(player.id);
            if (connection && connection.ws.readyState === WebSocket.OPEN) {
                try {
                    const playerMessage = JSON.stringify({
                        type: 'lobby_update',
                        lobby: lobby,
                        isHost: lobby.hostId === player.id
                    });
                    connection.ws.send(playerMessage);
                    sentCount++;
                    console.log(`  → Sent to ${player.name} (isHost: ${lobby.hostId === player.id})`);
                } catch (e) {
                    errorCount++;
                    console.error(`Error sending to ${player.name}:`, e.message);
                }
            }
        });

        if (errorCount > 0) {
            console.warn(`⚠️ Lobby update: ${sentCount} sent, ${errorCount} errors`);
        }
    } catch (error) {
        console.error('❌ CRITICAL ERROR in broadcastToLobby:', error);
    }
} function startGame(currentLobby) {
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

    let loopIterations = 0;
    let lastLoopLog = Date.now();
    let lastLoopTime = Date.now();

    const gameLoop = setInterval(() => {
        const now = Date.now();
        const deltaTime = (now - lastUpdateTime) / 1000;
        lastUpdateTime = now;

        // Detect if loop stopped running (freeze detection)
        const timeSinceLastLoop = now - lastLoopTime;
        if (timeSinceLastLoop > 200) { // More than 200ms since last loop
            console.error(`❌ Game loop was frozen for ${timeSinceLastLoop}ms!`);
        }
        lastLoopTime = now;

        loopIterations++;

        // Log loop health every 5 seconds
        if (now - lastLoopLog > 5000) {
            console.log(`🔄 Game loop health: ${loopIterations} iterations in 5s, avg: ${(5000 / loopIterations).toFixed(1)}ms/frame`);
            loopIterations = 0;
            lastLoopLog = now;
        }

        // Detect abnormal deltaTime (could indicate freeze recovery)
        if (deltaTime > 0.5) {
            console.warn(`⚠️ Abnormal deltaTime: ${deltaTime.toFixed(3)}s - possible freeze or lag spike`);
        }

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
            gameTime: room.gameState.gameTime,
            powerupNotifications: room.gameState.powerupNotifications,
            railgunLaser: room.gameState.railgunLaser
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

    // Store game loop and timeout references in room for admin reset
    room.gameLoop = gameLoop;
    room.gameTimeout = setTimeout(() => {
        console.log(`🏁 GAME ENDED - Time expired`);
        endGame(room, players, gameLoop);
    }, 120000);

    // Store players reference for admin reset
    room.players = players;
}

function endGame(room, players, gameLoop) {
    clearInterval(gameLoop);

    // Find winner (last alive or most kills)
    const alivePlayers = Object.values(room.gameState.players).filter(p => p.health > 0);
    const winner = alivePlayers.length === 1 ? alivePlayers[0] :
        Object.values(room.gameState.players).reduce((a, b) => (a.kills > b.kills ? a : b));

    // Save stats and update lobby players with new wins
    const lobby = lobbies.get(room.roomId);
    Object.values(room.gameState.players).forEach(player => {
        const stats = playerStats.get(player.name) || { kills: 0, wins: 0 };
        stats.kills += player.kills || 0;
        if (winner && player.id === winner.id) {
            stats.wins += 1; // +1 win for winning only
        }
        playerStats.set(player.name, stats);
        console.log(`💾 Saved stats for ${player.name}: ${stats.kills} kills, ${stats.wins} wins`);

        // Update player stats in lobby
        if (lobby) {
            const lobbyPlayer = lobby.players.find(p => p.id === player.id);
            if (lobbyPlayer) {
                lobbyPlayer.wins = stats.wins;
                lobbyPlayer.kills = stats.kills;
            }
        }
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

    // Keep lobby intact and broadcast updated state
    if (lobby) {
        console.log(`🔄 Lobby ${lobby.name} remains active after game`);
        broadcastToLobby(room.roomId);
        broadcastLobbyList();
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
