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

    // 速度計算
    const speed = Math.sqrt(b.vx*b.vx + b.vy*b.vy + b.vz*b.vz);

    // ★ 弾と敵の当たり判定
    let hit = false;
    for (let j = minions.length - 1; j >= 0; j--) {
      const m = minions[j];
      const dx = b.x - m.x;
      const dy = b.y - m.y;
      const dz = b.z - m.z;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

      if (dist < 1.0) { // 当たり判定半径
        m.hp--;
        hit = true;
        // 敵死亡判定
        if (m.hp <= 0) {
          minions.splice(j, 1);
          // スコア加算
          if (players[b.ownerId]) {
            players[b.ownerId].score += 100;
            io.to(b.ownerId).emit('updateScore', players[b.ownerId].score);
          }
        }
        break; // 1発で1体のみヒット
      }
    }

    // 弾が敵に当たったら即削除
    if (hit) {
      io.emit('removeBullet', b.id);
      bullets.splice(i, 1);
      continue;
    }

    // ★ 止まった弾の削除処理 (前回実装分)
    if (speed < 0.05) {
      if (!b.stopTime) b.stopTime = Date.now();
      else if (Date.now() - b.stopTime > 2000) {
        io.emit('removeBullet', b.id);
        bullets.splice(i, 1);
      }
    } else {
      b.stopTime = null;
    }
  }

  // 状態の一括送信
  io.emit('statePlayers', players);
  io.emit('stateBullets', bullets);
  io.emit('stateMinions', minions); // 敵の位置も送信

}, 1000 / 60);

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
