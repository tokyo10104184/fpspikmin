const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

// ★ここを修正しました (__dirname に変更)
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// ゲームの状態管理
const players = {};
const bullets = [];
let bulletIdCounter = 0;

io.on('connection', (socket) => {
  console.log('a user connected: ' + socket.id);

  // プレイヤー参加
  socket.on('join', (data) => {
    players[socket.id] = {
      id: socket.id,
      x: 0, y: 1, z: 0,
      color: data.color || '#ff0000',
      rotation: 0
    };
    io.emit('updatePlayerList', players);
  });

  // プレイヤーの移動・回転受信
  socket.on('playerInput', (data) => {
    if (players[socket.id]) {
      players[socket.id].x = data.x;
      players[socket.id].y = data.y;
      players[socket.id].z = data.z;
      players[socket.id].rotation = data.rotation;
    }
  });

  // 発射イベント
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
      stopTime: null // ★停止時刻記録用
    };
    bullets.push(bullet);
    // 全員に弾が生まれたことを通知（クライアント側でメッシュ作成）
    io.emit('spawnBullet', bullet);
  });

  socket.on('disconnect', () => {
    console.log('user disconnected');
    delete players[socket.id];
    io.emit('removePlayer', socket.id);
  });
});

// --- ゲームループ (サーバー側物理演算) ---
setInterval(() => {
  // プレイヤー情報の配信（簡易）
  io.emit('statePlayers', players);

  // 弾の物理更新と削除ロジック
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];

    // 位置更新
    b.x += b.vx;
    b.y += b.vy;
    b.z += b.vz;

    // 重力と摩擦（簡易物理）
    b.vy -= 0.02; // 重力
    if (b.y <= 0.2) { // 地面
      b.y = 0.2;
      b.vy *= -0.5; // 跳ね返り
      b.vx *= 0.9;  // 地面摩擦
      b.vz *= 0.9;
    }

    // 速度（スカラ値）を計算
    const speed = Math.sqrt(b.vx*b.vx + b.vy*b.vy + b.vz*b.vz);

    // ==========================================================
    // ★要望機能: 弾が動きを止めたら一定時間後に消す
    // ==========================================================
    if (speed < 0.05) {
      if (!b.stopTime) {
        b.stopTime = Date.now(); // 止まった時刻を記録
      } else if (Date.now() - b.stopTime > 2000) { 
        // 2秒 (2000ms) 経過したら削除
        io.emit('removeBullet', b.id); // クライアントに削除命令
        bullets.splice(i, 1); // サーバー配列から削除
        continue; // 次のループへ
      }
    } else {
      b.stopTime = null; // 再び動いたらリセット
    }
  }

  // 弾の位置情報を配信
  io.emit('stateBullets', bullets);

}, 1000 / 60); // 60 FPS

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`listening on *:${port}`);
});
