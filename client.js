import * as THREE from 'https://unpkg.com/three@0.126.0/build/three.module.js';

// --- Socket.io ---
const socket = io();

// --- 変数管理 ---
let myId = null;
const players = {}; 
const bullets = {};
const minions = {}; // 敵の管理用
let myMesh = null;

// 弾薬管理
const MAX_AMMO = 10;
let currentAmmo = MAX_AMMO;
let isReloading = false;

// --- DOM要素 ---
const startScreen = document.getElementById('start-screen');
const playButton = document.getElementById('play-button');
const usernameInput = document.getElementById('username-input');
const colorBoxes = document.querySelectorAll('.color-box');
const ammoDisplay = document.getElementById('current-ammo');
const reloadMsg = document.getElementById('reload-msg');
const btnThrow = document.getElementById('btn-throw');
const btnReload = document.getElementById('btn-reload');
const scoreVal = document.getElementById('score-val');

// --- Three.js 初期化 ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); 
scene.fog = new THREE.Fog(0x87CEEB, 10, 60); // 遠くを霞ませる

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// ライト
const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(20, 50, 20);
dirLight.castShadow = true;
scene.add(dirLight);

// --- ★マップ生成 ---
function createMap() {
    // 1. 地面
    const groundGeo = new THREE.PlaneGeometry(100, 100);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // 2. グリッド (移動感覚のため重要)
    const gridHelper = new THREE.GridHelper(100, 50, 0x888888, 0x444444);
    scene.add(gridHelper);

    // 3. ランダムな障害物 (箱)
    const boxGeo = new THREE.BoxGeometry(2, 2, 2);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x555555 });

    for (let i = 0; i < 30; i++) {
        const box = new THREE.Mesh(boxGeo, boxMat);
        // ランダム配置 (ただし中央付近は空ける)
        let x = (Math.random() - 0.5) * 80;
        let z = (Math.random() - 0.5) * 80;
        
        // 中央(スポーン地点)付近なら再配置
        if (Math.abs(x) < 5 && Math.abs(z) < 5) x += 10;

        box.position.set(x, 1, z);
        scene.add(box);
    }
}
createMap();

// --- プレイ開始処理 ---
let selectedColor = '#ff0000';
colorBoxes.forEach(box => {
    box.addEventListener('click', () => {
        colorBoxes.forEach(b => b.classList.remove('selected'));
        box.classList.add('selected');
        selectedColor = box.getAttribute('data-color');
    });
});

playButton.disabled = false;
playButton.innerText = "PLAY";
playButton.addEventListener('click', () => {
    const username = usernameInput.value || "Guest";
    startScreen.style.display = 'none';
    socket.emit('join', { username, color: selectedColor });
    camera.position.set(0, 1.6, 0); // 初期位置
});

// --- アクション (発射・リロード) ---
function reloadWeapon() {
    if (isReloading || currentAmmo === MAX_AMMO) return;
    isReloading = true;
    reloadMsg.style.display = 'block';
    reloadMsg.innerText = "RELOADING...";
    btnReload.classList.add('reloading');
    setTimeout(() => {
        currentAmmo = MAX_AMMO;
        isReloading = false;
        reloadMsg.style.display = 'none';
        btnReload.classList.remove('reloading');
        updateAmmoHUD();
    }, 2000);
}

function updateAmmoHUD() {
    ammoDisplay.innerText = currentAmmo;
    if (currentAmmo <= 0) btnThrow.classList.add('empty');
    else btnThrow.classList.remove('empty');
}

function shoot() {
    if (isReloading || currentAmmo <= 0) return;
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    socket.emit('shoot', {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
        vx: direction.x * 1.5,
        vy: direction.y * 1.5,
        vz: direction.z * 1.5
    });
    currentAmmo--;
    updateAmmoHUD();
}

// 入力イベント
btnThrow.addEventListener('touchstart', (e) => { e.preventDefault(); shoot(); });
btnThrow.addEventListener('mousedown', (e) => { e.preventDefault(); shoot(); });
btnReload.addEventListener('touchstart', (e) => { e.preventDefault(); reloadWeapon(); });
btnReload.addEventListener('click', reloadWeapon);
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') shoot();
    if (e.code === 'KeyR') reloadWeapon();
});

// --- Socket通信 ---

// プレイヤー更新
socket.on('updatePlayerList', (serverPlayers) => {
    for (const id in serverPlayers) {
        if (id === socket.id) { myId = id; continue; }
        if (!players[id]) {
            const geo = new THREE.CapsuleGeometry(0.5, 1, 4, 8);
            const mat = new THREE.MeshStandardMaterial({ color: serverPlayers[id].color });
            const mesh = new THREE.Mesh(geo, mat);
            scene.add(mesh);
            players[id] = mesh;
        }
    }
    for (const id in players) {
        if (!serverPlayers[id]) {
            scene.remove(players[id]);
            delete players[id];
        }
    }
});

socket.on('statePlayers', (serverPlayers) => {
    for (const id in serverPlayers) {
        if (players[id]) {
            const p = serverPlayers[id];
            players[id].position.set(p.x, p.y, p.z);
            players[id].rotation.y = p.rotation;
        }
    }
});

// 弾更新
socket.on('spawnBullet', (b) => {
    const geo = new THREE.SphereGeometry(0.15, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(b.x, b.y, b.z);
    scene.add(mesh);
    bullets[b.id] = mesh;
});
socket.on('stateBullets', (serverBullets) => {
    serverBullets.forEach(b => {
        if (bullets[b.id]) bullets[b.id].position.set(b.x, b.y, b.z);
    });
});
socket.on('removeBullet', (id) => {
    if (bullets[id]) {
        scene.remove(bullets[id]);
        delete bullets[id];
    }
});

// ★ 敵(Minion)更新
const minionGeo = new THREE.CapsuleGeometry(0.6, 1.2, 4, 8);
const minionMat = new THREE.MeshStandardMaterial({ color: 0xffff00 }); // 黄色

socket.on('stateMinions', (serverMinions) => {
    // 存在する敵を更新 or 作成
    serverMinions.forEach(m => {
        if (!minions[m.id]) {
            const mesh = new THREE.Mesh(minionGeo, minionMat);
            // 目玉をつける（向きがわかるように）
            const eyeGeo = new THREE.SphereGeometry(0.2);
            const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
            const eye = new THREE.Mesh(eyeGeo, eyeMat);
            eye.position.set(0, 0.4, 0.4); // 前面
            const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.08), new THREE.MeshBasicMaterial({color:0x000000}));
            pupil.position.z = 0.18;
            eye.add(pupil);
            mesh.add(eye);
            
            scene.add(mesh);
            minions[m.id] = mesh;
        }
        // 位置更新
        const mesh = minions[m.id];
        mesh.position.set(m.x, m.y, m.z);
        // プレイヤーの方を向く処理(簡易)
        mesh.lookAt(camera.position.x, m.y, camera.position.z);
    });

    // 死んだ敵を削除
    // (サーバー配列にないIDをローカルから消す)
    const serverIds = serverMinions.map(m => m.id);
    for (const id in minions) {
        if (!serverIds.includes(id)) {
            scene.remove(minions[id]);
            delete minions[id];
        }
    }
});

// スコア更新
socket.on('updateScore', (score) => {
    scoreVal.innerText = score;
});

// --- 移動制御 & ループ ---
const keys = { w: false, a: false, s: false, d: false };
const moveSpeed = 0.15;

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

// ジョイスティック制御
const joystickZone = document.getElementById('joystick-zone');
const joystickKnob = document.getElementById('joystick-knob');
let joyX = 0, joyY = 0, isDragging = false;

joystickZone.addEventListener('touchstart', () => { isDragging = true; });
joystickZone.addEventListener('touchend', () => { 
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
    const dx = touch.clientX - centerX;
    const dy = touch.clientY - centerY;
    const dist = Math.min(Math.sqrt(dx*dx + dy*dy), 50);
    const angle = Math.atan2(dy, dx);
    joyX = Math.cos(angle) * (dist / 50);
    joyY = Math.sin(angle) * (dist / 50);
    joystickKnob.style.transform = `translate(calc(-50% + ${Math.cos(angle)*dist}px), calc(-50% + ${Math.sin(angle)*dist}px))`;
});

// 視点移動
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

    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.y = 0; dir.normalize();
    const right = new THREE.Vector3().crossVectors(camera.up, dir).normalize();

    // PC移動
    if (keys.w) camera.position.addScaledVector(dir, moveSpeed);
    if (keys.s) camera.position.addScaledVector(dir, -moveSpeed);
    if (keys.a) camera.position.addScaledVector(right, moveSpeed);
    if (keys.d) camera.position.addScaledVector(right, -moveSpeed);

    // スマホ移動
    if (joyY !== 0) camera.position.addScaledVector(dir, -joyY * moveSpeed);
    if (joyX !== 0) camera.position.addScaledVector(right, -joyX * moveSpeed);

    // 座標表示
    document.getElementById('coordinates').innerText = 
        `X: ${camera.position.x.toFixed(2)} Z: ${camera.position.z.toFixed(2)}`;

    // サーバー送信
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

// リサイズ対応
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
