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
const ITEM_COSTS = {
    NORMAL: 5,
    FROST: 20,
    GLUE: 30,
    BOMB: 50
};
const TYPES = {
    NORMAL: { dmg: 2 },
    FROST:  { dmg: 1 },
    GLUE:   { dmg: 0 },
    BOMB:   { dmg: 10, radius: 8.0 }
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
                        if (minion.type === 'BOMB') {
                            // Area of effect damage
                            Object.values(targets).forEach(t => {
                                const d = Math.sqrt(Math.pow(minion.position.x - t.position.x, 2) + Math.pow(minion.position.z - t.position.z, 2));
                                if (d < TYPES.BOMB.radius) {
                                    t.hit(TYPES.BOMB.dmg, minion.ownerId);
                                }
                            });
                        } else {
                            target.hit(TYPES[minion.type].dmg, minion.ownerId);
                        }
                        hit = true;
                        break;
                    }
                }
            }
        }

        if (hit) {
            delete minions[minionId];
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
            inventory: { NORMAL: 10, FROST: 0, GLUE: 0, BOMB: 0 },
            isDead: false,
        };
        socket.emit('updateScore', { score: players[socket.id].score });
        socket.emit('updateInventory', { inventory: players[socket.id].inventory });

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
            socket.broadcast.emit('playerMoved', player);
        }
    });

    socket.on('fire', (data) => {
        const player = players[socket.id];
        if (player && !player.isDead && player.inventory[data.type] > 0) {
            player.inventory[data.type]--;

            const minionId = `minion_${socket.id}_${Date.now()}`;
            minions[minionId] = {
                id: minionId,
                ownerId: socket.id,
                type: data.type,
                position: { ...data.position },
                velocity: {
                    x: data.direction.x * 40,
                    y: data.direction.y * 40 + 5,
                    z: data.direction.z * 40,
                }
            };
            socket.emit('updateInventory', { inventory: player.inventory });
        }
    });

    socket.on('buyItem', (data) => {
        const player = players[socket.id];
        const cost = ITEM_COSTS[data.item] * data.quantity;
        if (player && player.score >= cost) {
            player.score -= cost;
            player.inventory[data.item] += data.quantity;
            socket.emit('updateScore', { score: player.score });
            socket.emit('updateInventory', { inventory: player.inventory });
            updateLeaderboard();
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
            player.position = { x: 0, y: 3.0, z: 10 };
            // Reset score and inventory on respawn
            player.score = 0;
            player.inventory = { NORMAL: 10, FROST: 0, GLUE: 0, BOMB: 0 };
            socket.emit('updateScore', { score: player.score });
            socket.emit('updateInventory', { inventory: player.inventory });

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
