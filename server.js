const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Game state
const players = {};
const targets = {};
const minions = {};

// Game constants
const NUM_TARGETS = 3;
const TYPES = {
    NORMAL: { dmg: 5 }, // Pistol damage
};

class ServerTarget {
    constructor() {
        this.id = `enemy_${Math.random().toString(36).substr(2, 9)}`;
        this.maxHp = 20;
        this.hp = this.maxHp;
        this.active = true;
        this.baseSpeed = 4.0;
        this.attackTimer = Math.random() * 3;

        this.position = {
            x: Math.random() * 20 - 10,
            y: 0,
            z: Math.random() * 20 - 10
        };
        this.rotationY = 0;
    }

    update(dt, players) {
        // AI logic disabled
    }

    hit(damage, ownerId) {
        if (!this.active) return;
        this.hp -= damage;
        if (this.hp <= 0) {
            this.hp = 0;
            this.active = false;

            // Respawn after 5 seconds
            setTimeout(() => this.respawn(), 5000);

            if (players[ownerId]) {
                players[ownerId].score += 100;
                io.to(ownerId).emit('updateScore', { score: players[ownerId].score });
                updateLeaderboard();
            }
        }
    }

    respawn() {
        this.hp = this.maxHp;
        this.active = true;
        this.position = {
            x: Math.random() * 20 - 10,
            y: 0,
            z: Math.random() * 20 - 10
        };
    }

    getState() {
        return {
            id: this.id,
            position: this.position,
            rotationY: this.rotationY,
            hp: this.hp,
            maxHp: this.maxHp,
            active: this.active
        };
    }
}

// Initialize targets
for (let i = 0; i < NUM_TARGETS; i++) {
    const target = new ServerTarget();
    targets[target.id] = target;
}

// Main Game Loop
let lastUpdateTime = Date.now();

function updateLeaderboard() {
    const leaderboard = Object.values(players)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(p => ({ username: p.username, score: p.score }));
    io.emit('updateLeaderboard', leaderboard);
}

setInterval(() => {
    const now = Date.now();
    const dt = (now - lastUpdateTime) / 1000;
    lastUpdateTime = now;

    // Update all targets
    Object.values(targets).forEach(target => target.update(dt, players));

    // Update all minions and check for collisions
    for (const minionId in minions) {
        const minion = minions[minionId];

        if (minion.state === 'airborne') {
            minion.velocity.y -= 30 * dt;
            minion.position.x += minion.velocity.x * dt;
            minion.position.y += minion.velocity.y * dt;
            minion.position.z += minion.velocity.z * dt;

            let hit = false;

            if (minion.position.y < 0.5) {
                hit = true; // Hit the ground
            } else {
                for (const targetId in targets) {
                const target = targets[targetId];
                if (target.active) {
                    const dx = minion.position.x - target.position.x;
                    const dy = minion.position.y - (target.position.y + 1.5);
                    const dz = minion.position.z - target.position.z;
                    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

                    if (dist < 2.0) {
                        target.hit(TYPES.NORMAL.dmg, minion.ownerId);
                        hit = true;
                        break;
                    }
                }
            }

            // PvP Collision
            for (const playerId in players) {
                const player = players[playerId];
                if (playerId !== minion.ownerId && !player.isDead) {
                    const dx = minion.position.x - player.position.x;
                    const dy = minion.position.y - (player.position.y); // Avatar center is at y
                    const dz = minion.position.z - player.position.z;
                    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

                    if (dist < 2.0) { // Player hitbox
                        player.hp -= TYPES.NORMAL.dmg;

                        if (players[minion.ownerId]) {
                            players[minion.ownerId].score += 10;
                            io.to(minion.ownerId).emit('updateScore', { score: players[minion.ownerId].score });
                            updateLeaderboard();
                        }

                        if (player.hp <= 0) {
                            player.hp = 0;
                            player.isDead = true;
                            io.emit('playerDied', { id: playerId });

                            if (players[minion.ownerId]) {
                                players[minion.ownerId].score += 50; // Bonus for a kill
                                io.to(minion.ownerId).emit('updateScore', { score: players[minion.ownerId].score });
                                updateLeaderboard();
                            }
                        }

                        io.emit('playerDamaged', { id: playerId, damage: TYPES.NORMAL.dmg, hp: player.hp });

                        hit = true;
                        break;
                    }
                }
            }
        }

            if (hit) {
                minion.state = 'grounded';
                minion.velocity = { x: 0, y: 0, z: 0 };
            }
        }
    }

    // Broadcast game state to all clients
    const targetsState = {};
    for (const id in targets) targetsState[id] = targets[id].getState();

    const minionsState = {};
    for (const id in minions) minionsState[id] = { id: id, position: minions[id].position, type: minions[id].type };

    io.emit('gameStateUpdate', { targets: targetsState, minions: minionsState });

}, 1000 / 30);

io.on('connection', (socket) => {
    console.log('a user connected:', socket.id);

    socket.on('initPlayer', (data) => {
        players[socket.id] = {
            id: socket.id,
            username: data.username,
            color: data.color,
            position: { x: 0, y: 3.0, z: 10 },
            rotation: { x: 0, y: 0, z: 0 },
            score: 0,
            hp: 100,
            maxHp: 100,
            isDead: false,
        };
        socket.emit('updateScore', { score: players[socket.id].score });

        socket.emit('currentPlayers', players);
        socket.broadcast.emit('newPlayer', players[socket.id]);
        updateLeaderboard();
    });

    socket.on('disconnect', () => {
        console.log('user disconnected:', socket.id);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
        updateLeaderboard();
    });

    socket.on('playerMovement', (movementData) => {
        const player = players[socket.id];
        if (player && !player.isDead) {
            player.position = movementData.position;
            player.rotation = movementData.rotation;

            const playerData = {
                id: player.id,
                position: player.position,
                rotation: player.rotation,
                hp: player.hp,
                isDead: player.isDead,
                username: player.username,
                color: player.color
            };

            socket.broadcast.emit('playerMoved', playerData);
        }
    });

    socket.on('fire', (data) => {
        const player = players[socket.id];
        if (player && !player.isDead) {
            const minionId = `minion_${socket.id}_${Date.now()}`;
            minions[minionId] = {
                id: minionId,
                ownerId: socket.id,
                type: data.type,
                state: 'airborne', // New state property
                position: { ...data.position },
                velocity: {
                    x: data.direction.x * 80, // Increased velocity
                    y: data.direction.y * 80, // Flatter trajectory
                    z: data.direction.z * 80,
                }
            };
        }
    });

    socket.on('playerDied', () => {
        if (players[socket.id]) {
            players[socket.id].isDead = true;
            io.emit('playerDied', { id: socket.id });
        }
    });

    socket.on('requestRespawn', () => {
        const player = players[socket.id];
        if (player && player.isDead) {
            player.isDead = false;
            player.hp = player.maxHp;
            player.position = { x: 0, y: 3.0, z: 10 };
            // Reset score and inventory on respawn
            player.score = 0;
            socket.emit('updateScore', { score: player.score });

            io.emit('newPlayer', player);
        }
    });

    socket.on('chatMessage', (msg) => {
        const player = players[socket.id];
        if (player) {
            io.emit('chatMessage', { username: player.username, message: msg });
        }
    });
});

server.listen(3000, () => {
    console.log('listening on *:3000');
});
