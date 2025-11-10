# Multiplayer Shooter Game

A real-time multiplayer 2D shooter game with up to 4 players. Features a lobby system, dynamic game rooms, and Tank Trouble-style gameplay with walls and shooting mechanics.

## Features

- **Lobby System**: Join queues with other players, automatic matchmaking when 2+ players are ready
- **4-Player Support**: Blue, red, yellow, and green colored players
- **Dynamic Maps**: Game arenas with destructible walls
- **Health & Scoring**: Track player health and score kills
- **Real-time Networking**: WebSocket-based multiplayer with server-authoritative physics
- **Responsive Design**: Works on different screen sizes

## Installation

1. Make sure you have Node.js installed (version 12 or higher)

2. Install dependencies:
```bash
npm install
```

## Running the Game

```bash
npm start
```

The server will start on `http://localhost:3000`

Open your browser and navigate to `http://localhost:3000` to play.

## 🌐 Deploy Online (Share with Friends)

### **Fastest Way: Railway.app (Free)**

1. Go to [railway.app](https://railway.app)
2. Click "Start a New Project" → "Deploy from GitHub"
3. Select this repository
4. Railway auto-deploys and gives you a URL
5. Share the URL with your friends!

👉 **See [DEPLOY_RAILWAY.md](./DEPLOY_RAILWAY.md) for step-by-step instructions**

### Other Free Options:
- **Replit.com** - Very easy, same process
- **Glitch.com** - Simple deployment
- **Render.com** - Reliable, free tier available

## How to Play

### Lobby Screen
1. Enter your player name
2. Select your color (Blue, Red, Yellow, or Green)
3. Click "Join Game"
4. Wait for other players to join (minimum 2 players to start)

### In-Game Controls
- **WASD** or **Arrow Keys**: Move around the map
- **Mouse Movement**: Aim your gun
- **Left Click**: Shoot
- **Avoid Walls**: Use them for cover while battling other players

## Game Rules

- Each player has 100 health
- Bullets deal 10 damage per hit
- Respawn after being defeated (in future updates)
- Score points for eliminating other players
- Game lasts 2 minutes per round

## Server Architecture

- **Express.js**: HTTP server for serving static files
- **WebSocket (ws)**: Real-time bidirectional communication
- **Node.js**: Server runtime

## Game Architecture

### Client-Side
- HTML5 Canvas for rendering
- WebSocket client for real-time updates
- Input handling (keyboard & mouse)

### Server-Side
- Game room management
- Physics simulation
- Collision detection
- Player state broadcasting
- Lobby matchmaking

## Project Structure

```
1v1game/
├── src/
│   └── server.js          # Main server with game logic
├── public/
│   └── index.html         # Client-side game
└── package.json           # Dependencies and scripts
```

## Future Enhancements

- Player respawning system
- More map variations
- Power-ups (health, rapid fire, etc.)
- Spectator mode
- Leaderboards
- Different game modes
- Sound effects and music

## License

MIT
