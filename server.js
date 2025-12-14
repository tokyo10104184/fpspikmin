const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

// ディレクトリ設定
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// --- ゲーム状態 ---
const players = {};
const bullets = [];
const minions = []; // 敵キャラクター
let bulletIdCounter = 0;
let minionIdCounter = 0;

// 定数
const MAP_SIZE = 50;

io.on('connection', (socket) => {
  console.log('Player connected: ' + socket.id);

  // プレイヤー参加
  socket.on('join', (data) => {
    players[socket.id] = {
      id: socket.id,
      username: data.username || "Player",
      x: 0, y: 1, z: 0,
      color: data.color || '#ff0000',
      rotation: 0,
      hp: 100,
      score: 0
    };
    io.emit('updatePlayerList', players);
  });

  // プレイヤーの操作受信
  socket.on('playerInput', (data) => {
    if (players[socket.id]) {
      players[socket.id].x = data.x;
      players[socket.id].y = data.y;
      players[socket.id].z = data.z;
      players[socket.id].rotation = data.rotation;
    }
  });

  // 発射
  socket.on('shoot', (data) => {
    const bullet = {
      id: `bullet_${bulletIdCounter++}`,
      ownerId: socket.id,
      x: data.x,
      y: data.y,
      z: data.z,
      vx: data.vx,
      vy: data.vy,
      vz: data.vz,
      stopTime: null
    };
    bullets.push(bullet);
    io.emit('spawnBullet', bullet);
  });

  // 切断
  socket.on('disconnect', () => {
    console.log('Player disconnected');
    delete players[socket.id];
    io.emit('removePlayer', socket.id);
  });
});

// --- 敵のスポーン (3秒ごとに生成) ---
setInterval(() => {
  if (minions.length < 20) { // 最大20体まで
    // ランダムな位置に出現
    const x = (Math.random() - 0.5) * MAP_SIZE;
    const z = (Math.random() - 0.5) * MAP_SIZE;
    const minion = {
      id: `minion_${minionIdCounter++}`,
      x: x,
      y: 1,
      z: z,
      hp: 3, // HP
      speed: 0.05 + Math.random() * 0.03 // ランダムな速度
    };
    minions.push(minion);
    // 新規生成は stateMinions で一括同期されるので個別のemitは省略可だが、エフェクト用に分けても良い
  }
}, 3000);

// --- ゲームループ (60FPS) ---
setInterval(() => {
  
  // 1. 敵のAI（一番近いプレイヤーを追いかける）
  minions.forEach(minion => {
    let target = null;
    let minDist = 9999;

    for (const pid in players) {
      const p = players[pid];
      const dx = p.x - minion.x;
      const dz = p.z - minion.z;
      const dist = Math.sqrt(dx*dx + dz*dz);
      if (dist < minDist) {
        minDist = dist;
        target = p;
      }
    }

    if (target && minDist > 1) { // プレイヤーに重ならない程度まで近づく
      const angle = Math.atan2(target.z - minion.z, target.x - minion.x);
      minion.x += Math.cos(angle) * minion.speed;
      minion.z += Math.sin(angle) * minion.speed;
    }
  });

  // 2. 弾の移動と物理
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx;
    b.y += b.vy;
    b.z += b.vz;

    // 重力
    b.vy -= 0.02;
    // 地面判定
    if (b.y <= 0.2) {
      b.y = 0.2;
      b.vy *= -0.5;
      b.vx *= 0.9;
      b.vz *= 0.9;
    }

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
                delete minions[minionId];
            }
        }
        break; // 1発で1体のみヒット
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
            ammoInMagazine: 10,
            magazineSize: 10,
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
        if (player && !player.isDead && player.ammoInMagazine > 0) {
            player.ammoInMagazine--;
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
            player.ammoInMagazine = player.magazineSize;
            // Reset score and inventory on respawn
            player.score = 0;
            socket.emit('updateScore', { score: player.score });

  // 状態の一括送信
  io.emit('statePlayers', players);
  io.emit('stateBullets', bullets);
  io.emit('stateMinions', minions); // 敵の位置も送信

    socket.on('reloadWeapon', () => {
        const player = players[socket.id];
        if (player && !player.isDead) {
            player.ammoInMagazine = player.magazineSize;
            socket.emit('weaponReloaded', { ammoInMagazine: player.ammoInMagazine });
        }
    });

    socket.on('chatMessage', (msg) => {
        const player = players[socket.id];
        if (player) {
            io.emit('chatMessage', { username: player.username, message: msg });
        }
    });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
