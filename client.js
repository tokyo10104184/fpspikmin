import * as THREE from 'https://unpkg.com/three@0.126.0/build/three.module.js';

// --- Socket.io 設定 ---
const socket = io();

// --- ゲーム変数 ---
let myId = null;
const players = {}; // 他プレイヤーのメッシュ管理
const bullets = {}; // 弾のメッシュ管理
let myMesh = null;

// ★弾薬・リロード管理変数
const MAX_AMMO = 10;
let currentAmmo = MAX_AMMO;
let isReloading = false;

// --- DOM要素の取得 ---
const startScreen = document.getElementById('start-screen');
const playButton = document.getElementById('play-button');
const usernameInput = document.getElementById('username-input');
const colorBoxes = document.querySelectorAll('.color-box');
const ammoDisplay = document.getElementById('current-ammo'); // HTML変更に対応
const reloadMsg = document.getElementById('reload-msg');
const btnThrow = document.getElementById('btn-throw');
const btnReload = document.getElementById('btn-reload'); // HTML追加に対応

// --- Three.js 初期設定 ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // 空色
scene.fog = new THREE.Fog(0x87CEEB, 10, 50);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// ライト
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

// 地面
const groundGeo = new THREE.PlaneGeometry(100, 100);
const groundMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// --- 入力・UI処理 ---

// 色選択
let selectedColor = '#ff0000';
colorBoxes.forEach(box => {
    box.addEventListener('click', () => {
        colorBoxes.forEach(b => b.classList.remove('selected'));
        box.classList.add('selected');
        selectedColor = box.getAttribute('data-color');
    });
});

// プレイ開始
playButton.disabled = false;
playButton.innerText = "PLAY";
playButton.addEventListener('click', () => {
    const username = usernameInput.value || "Guest";
    startScreen.style.display = 'none';
    
    // サーバーに参加通知
    socket.emit('join', { username, color: selectedColor });
    
    // カメラ初期位置
    camera.position.set(0, 1.6, 5);
});

// --- ★リロード機能の実装 ---
function reloadWeapon() {
    if (isReloading || currentAmmo === MAX_AMMO) return;

    isReloading = true;
    
    // UI更新
    reloadMsg.style.display = 'block';
    reloadMsg.innerText = "RELOADING...";
    btnReload.classList.add('reloading');

    // 2秒後にリロード完了
    setTimeout(() => {
        currentAmmo = MAX_AMMO;
        isReloading = false;
        
        // UI戻す
        reloadMsg.style.display = 'none';
        btnReload.classList.remove('reloading');
        updateAmmoHUD();
    }, 2000);
}

function updateAmmoHUD() {
    ammoDisplay.innerText = currentAmmo;
    if (currentAmmo <= 0) {
        btnThrow.classList.add('empty');
    } else {
        btnThrow.classList.remove('empty');
    }
}

// リロードボタンのイベント
btnReload.addEventListener('click', reloadWeapon);
btnReload.addEventListener('touchstart', (e) => { 
    e.preventDefault(); 
    reloadWeapon(); 
});


// --- 発射機能 ---
function shoot() {
    // ★弾切れチェック
    if (isReloading) return;
    if (currentAmmo <= 0) {
        // カチッ（弾切れ音などをここで鳴らすと良い）
        console.log("Out of ammo!");
        return;
    }

    // カメラの向いている方向に発射
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);

    // サーバーへ通知
    socket.emit('shoot', {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
        vx: direction.x * 1.5, // 弾速
        vy: direction.y * 1.5,
        vz: direction.z * 1.5
    });

    // ★弾を減らす
    currentAmmo--;
    updateAmmoHUD();
}

// 発射ボタン (PCクリック / スマホタップ)
btnThrow.addEventListener('mousedown', (e) => { e.preventDefault(); shoot(); });
btnThrow.addEventListener('touchstart', (e) => { e.preventDefault(); shoot(); });
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') shoot();
    if (e.code === 'KeyR') reloadWeapon(); // Rキーでリロード
});


// --- ソケット通信処理 ---

socket.on('updatePlayerList', (serverPlayers) => {
    // プレイヤー同期（簡易版）
    for (const id in serverPlayers) {
        if (id === socket.id) {
            myId = id;
            continue;
        }
        if (!players[id]) {
            // 新規プレイヤー作成
            const geo = new THREE.CapsuleGeometry(0.5, 1, 4, 8);
            const mat = new THREE.MeshStandardMaterial({ color: serverPlayers[id].color });
            const mesh = new THREE.Mesh(geo, mat);
            scene.add(mesh);
            players[id] = mesh;
        }
    }
    // 切断されたプレイヤーの削除
    for (const id in players) {
        if (!serverPlayers[id]) {
            scene.remove(players[id]);
            delete players[id];
        }
    }
});

socket.on('statePlayers', (serverPlayers) => {
    // 位置同期
    for (const id in serverPlayers) {
        if (players[id]) {
            const p = serverPlayers[id];
            players[id].position.set(p.x, p.y, p.z);
            players[id].rotation.y = p.rotation;
        }
    }
});

// 弾の生成
socket.on('spawnBullet', (b) => {
    const geo = new THREE.SphereGeometry(0.2, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(b.x, b.y, b.z);
    scene.add(mesh);
    bullets[b.id] = mesh;
});

// 弾の移動同期
socket.on('stateBullets', (serverBullets) => {
    serverBullets.forEach(b => {
        if (bullets[b.id]) {
            bullets[b.id].position.set(b.x, b.y, b.z);
        }
    });
});

// ★弾の削除（サーバーからの指示）
socket.on('removeBullet', (id) => {
    if (bullets[id]) {
        scene.remove(bullets[id]);
        delete bullets[id];
    }
});


// --- ゲームループ & プレイヤー移動制御 ---
const keys = { w: false, a: false, s: false, d: false };
const speed = 0.1;

window.addEventListener('keydown', (e) => {
    if(e.key === 'w') keys.w = true;
    if(e.key === 'a') keys.a = true;
    if(e.key === 's') keys.s = true;
    if(e.key === 'd') keys.d = true;
});
window.addEventListener('keyup', (e) => {
    if(e.key === 'w') keys.w = false;
    if(e.key === 'a') keys.a = false;
    if(e.key === 's') keys.s = false;
    if(e.key === 'd') keys.d = false;
});

// ジョイスティック（簡易実装）
const joystickZone = document.getElementById('joystick-zone');
const joystickKnob = document.getElementById('joystick-knob');
let isDragging = false;
let joyX = 0, joyY = 0;

joystickZone.addEventListener('touchstart', (e) => { isDragging = true; });
joystickZone.addEventListener('touchend', (e) => { 
    isDragging = false; 
    joyX = 0; joyY = 0;
    joystickKnob.style.transform = `translate(-50%, -50%)`;
});
joystickZone.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    const rect = joystickZone.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    // 中心からの距離
    let dx = touch.clientX - centerX;
    let dy = touch.clientY - centerY;
    
    // 制限
    const distance = Math.min(Math.sqrt(dx*dx + dy*dy), 50);
    const angle = Math.atan2(dy, dx);
    
    joyX = Math.cos(angle) * (distance / 50);
    joyY = Math.sin(angle) * (distance / 50);
    
    joystickKnob.style.transform = `translate(calc(-50% + ${Math.cos(angle)*distance}px), calc(-50% + ${Math.sin(angle)*distance}px))`;
});

// 視点移動（タッチ）
const touchLookZone = document.getElementById('touch-look-zone');
let lastTouchX = 0;
touchLookZone.addEventListener('touchstart', (e) => { lastTouchX = e.touches[0].clientX; });
touchLookZone.addEventListener('touchmove', (e) => {
    const touchX = e.touches[0].clientX;
    const deltaX = touchX - lastTouchX;
    camera.rotation.y -= deltaX * 0.005;
    lastTouchX = touchX;
});


function animate() {
    requestAnimationFrame(animate);

    // PC移動
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    direction.y = 0;
    direction.normalize();
    const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize(); // 修正: 左右逆になる場合はここを確認

    if (keys.w) camera.position.addScaledVector(direction, speed);
    if (keys.s) camera.position.addScaledVector(direction, -speed);
    if (keys.a) camera.position.addScaledVector(right, speed); // 左
    if (keys.d) camera.position.addScaledVector(right, -speed); // 右

    // スマホ移動
    if (joyY !== 0) camera.position.addScaledVector(direction, -joyY * speed);
    if (joyX !== 0) camera.position.addScaledVector(right, -joyX * speed);

    // 座標表示更新
    document.getElementById('coordinates').innerText = 
        `X: ${camera.position.x.toFixed(2)} Y: ${camera.position.y.toFixed(2)} Z: ${camera.position.z.toFixed(2)}`;

    // 自分の位置をサーバーへ送信
    if (socket.connected) {
        socket.emit('playerInput', {
            x: camera.position.x,
            y: camera.position.y,
            z: camera.position.z,
            rotation: camera.rotation.y
        });
    }

    renderer.render(scene, camera);
}

animate();
