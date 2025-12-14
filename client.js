import * as THREE from 'https://unpkg.com/three@0.150.0/build/three.module.js';

let camera, scene, renderer;
let prevTime = performance.now();
let frames = 0;
let lastFPSTime = prevTime;

let score = 0;
let playerHP = 100;
const MAX_PLAYER_HP = 100;
let isGameOver = false;
let playerAvatar;
let ammoInMagazine = 10;
let pistol;

const WEAPON_CONFIG = {
    PISTOL: {
        name: 'Pistol',
        color: 0xffffff,
        damage: 5,
        uiColor: 'rgba(200, 200, 200, 0.6)'
    }
};

const enemyProjectiles = []; // 敵の弾
const targets = [];

const PLAYER_HEIGHT = 2.0;
const PLAYER_SPEED = 10.0;

const input = { moveX: 0, moveY: 0 };
let camRotation = { x: 0.2, y: 0 }; // Initial camera rotation

const clientTargets = {};
const clientMinions = {};
let socket;
const otherPlayers = {};

init();

function init() {
    socket = io();

    socket.on('connect', () => {
        const playButton = document.getElementById('play-button');
        playButton.disabled = false;
        playButton.textContent = 'PLAY';
    });

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 0, 80);
    scene.add(new THREE.HemisphereLight(0xeeeeff, 0x777788, 0.75));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 20, 10); scene.add(dirLight);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x44aa44 }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);

    for(let i=0; i<15; i++) {
        const tree = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 6), new THREE.MeshStandardMaterial({color: 0x8B4513}));
        const angle = Math.random() * Math.PI * 2; const rad = 30 + Math.random() * 60;
        tree.position.set(Math.cos(angle)*rad, 3, Math.sin(angle)*rad); scene.add(tree);
        const leaves = new THREE.Mesh(new THREE.ConeGeometry(3, 6, 8), new THREE.MeshStandardMaterial({color: 0x228B22}));
        leaves.position.y = 5; tree.add(leaves);
    }

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 18); // Set a stable initial camera position
    camera.rotation.order = "YXZ";

    pistol = createPistol();
    camera.add(pistol);
    scene.add(camera); // Add camera to scene so pistol is visible

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.body.appendChild(renderer.domElement);

    document.getElementById('ui-layer').style.display = 'none';

    window.addEventListener('resize', onWindowResize);
    animate(); // Start the rendering loop immediately

    document.querySelectorAll('.color-box').forEach(box => {
        box.addEventListener('click', () => {
            document.querySelector('.color-box.selected').classList.remove('selected');
            box.classList.add('selected');
        });
    });

    document.getElementById('play-button').addEventListener('click', () => {
        const username = document.getElementById('username-input').value;
        if (username) {
            const color = document.querySelector('.color-box.selected').dataset.color;
            socket.emit('initPlayer', { username, color });
            playerAvatar = createPlayerAvatar(color);
            playerAvatar.visible = false; // Hide self avatar for first-person
            scene.add(playerAvatar);

            document.getElementById('start-screen').style.display = 'none';
            document.getElementById('ui-layer').style.display = 'block';
            updateHUD();
            updatePlayerHPUI();
            setupControls();
        }
    });

    document.getElementById('retry-btn').addEventListener('click', resetGame);

    socket.on('playerDamaged', (data) => {
        if (data.id === socket.id) {
            takePlayerDamage(data.damage);
        } else if (otherPlayers[data.id]) {
            const player = otherPlayers[data.id];
            const hpRatio = data.hp / MAX_PLAYER_HP;
            if (player.hpBar) {
                player.hpBar.scale.x = hpRatio;
            }
        }
    });

    socket.on('currentPlayers', (players) => {
        Object.keys(players).forEach((id) => {
            if (players[id].id !== socket.id) {
                addOtherPlayer(players[id]);
            }
        });
    });

    socket.on('newPlayer', (playerInfo) => {
        if (playerInfo.id !== socket.id) {
            if (otherPlayers[playerInfo.id]) {
                // Player already exists, just make them visible
                otherPlayers[playerInfo.id].group.visible = !playerInfo.isDead;
            } else if (!playerInfo.isDead) {
                // New player, create avatar
                addOtherPlayer(playerInfo);
            }
        }
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

        // Remove old minions
        for (const id in clientMinions) {
            if (!receivedMinions.has(id)) {
                scene.remove(clientMinions[id]);
                delete clientMinions[id];
            }
        }
    });

    socket.on('updateScore', (data) => {
        score = data.score;
        document.getElementById('score-val').innerText = score;
    });

    socket.on('weaponReloaded', (data) => {
        ammoInMagazine = data.ammoInMagazine;
        updateHUD();
    });

    socket.on('updateLeaderboard', (leaderboard) => {
        const list = document.getElementById('leaderboard-list');
        list.innerHTML = '';
        leaderboard.forEach(p => {
            const item = document.createElement('li');
            item.textContent = `${p.username}: ${p.score}`;
            list.appendChild(item);
        });
    });

    function createTargetMesh() {
        const mesh = new THREE.Group();
        const skinMat = new THREE.MeshStandardMaterial({color: 0xffccaa});
        const shirtMat = new THREE.MeshStandardMaterial({color: 0x0088ff});
        const pantsMat = new THREE.MeshStandardMaterial({color: 0x000088});

        const head = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), skinMat);
        head.position.y = 3.0;
        mesh.add(head);

        const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1.5, 0.5), shirtMat);
        body.position.y = 1.75; mesh.add(body);

        const hpGroup = new THREE.Group(); hpGroup.position.set(0, 4.2, 0); mesh.add(hpGroup);
        const bgGeo = new THREE.PlaneGeometry(3, 0.3); hpGroup.add(new THREE.Mesh(bgGeo, new THREE.MeshBasicMaterial({ color: 0x330000 })));
        const barGeo = new THREE.PlaneGeometry(3, 0.3); barGeo.translate(1.5, 0, 0);
        const hpBar = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
        hpBar.position.x = -1.5; hpGroup.add(hpBar);

        return { mesh, hpGroup, hpBar };
    }
}

function updatePlayerHPUI() {
    const bar = document.getElementById('hp-bar');
    const text = document.getElementById('hp-text');
    const pct = Math.max(0, (playerHP / MAX_PLAYER_HP) * 100);
    bar.style.width = pct + '%';
    text.innerText = 'HP: ' + playerHP;

    if (pct > 50) bar.style.background = '#00ff00';
    else if (pct > 20) bar.style.background = '#ffff00';
    else bar.style.background = '#ff0000';
}

function takePlayerDamage(dmg) {
    if (isGameOver) return;
    playerHP -= dmg;
    updatePlayerHPUI();

    const overlay = document.getElementById('damage-overlay');
    overlay.style.opacity = 0.5;
    setTimeout(() => { overlay.style.opacity = 0; }, 100);

    if (playerHP <= 0) {
        gameOver();
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
}

function updateHUD() {
    const weapon = WEAPON_CONFIG.PISTOL;
    document.getElementById('weapon-name').innerText = weapon.name;
    document.getElementById('weapon-ammo').innerHTML = `${ammoInMagazine} <span id="ammo-total">/ ∞</span>`;
    const fireBtn = document.getElementById('btn-throw');
    fireBtn.style.background = weapon.uiColor;
    if (ammoInMagazine > 0) {
        fireBtn.classList.remove('empty');
        fireBtn.innerText = "FIRE";
    } else {
        fireBtn.classList.add('empty');
        fireBtn.innerText = "EMPTY";
    }
}

function setupControls() {
    const joystickZone = document.getElementById('joystick-zone');
    const joystickKnob = document.getElementById('joystick-knob');
    let joyStartX = 0, joyStartY = 0;

    joystickZone.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.changedTouches[0];
        joyStartX = touch.clientX; joyStartY = touch.clientY;
    }, {passive: false});

    joystickZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const touch = e.changedTouches[0];
        let dx = touch.clientX - joyStartX; let dy = touch.clientY - joyStartY;
        const maxDist = 60; const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist > maxDist) { dx = (dx/dist)*maxDist; dy = (dy/dist)*maxDist; }
        joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        input.moveX = dx / maxDist; input.moveY = dy / maxDist;
    }, {passive: false});

    const resetJoy = (e) => {
        e.preventDefault(); input.moveX = 0; input.moveY = 0;
        joystickKnob.style.transform = `translate(-50%, -50%)`;
    };
    joystickZone.addEventListener('touchend', resetJoy); joystickZone.addEventListener('touchcancel', resetJoy);

    const lookZone = document.getElementById('touch-look-zone');
    let lookStartX = 0, lookStartY = 0;
    let lookTouchIdentifier = null;

    lookZone.addEventListener('touchstart', (e) => {
        if (lookTouchIdentifier === null) {
            const touch = e.changedTouches[0];
            lookTouchIdentifier = touch.identifier;
            lookStartX = touch.clientX;
            lookStartY = touch.clientY;
        }
    }, { passive: false });

    lookZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (lookTouchIdentifier !== null) {
            for (let i = 0; i < e.changedTouches.length; i++) {
                const t = e.changedTouches[i];
                if (t.identifier === lookTouchIdentifier) {
                    const sensitivity = 0.005;
                    camRotation.y -= (t.clientX - lookStartX) * sensitivity;
                    camRotation.x -= (t.clientY - lookStartY) * sensitivity; // Un-inverted
                    camRotation.x = Math.max(-1.4, Math.min(1.4, camRotation.x));
                    lookStartX = t.clientX;
                    lookStartY = t.clientY;
                    break;
                }
            }
        }
    }, { passive: false });

    const endLook = (e) => {
        if (lookTouchIdentifier !== null) {
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === lookTouchIdentifier) {
                    lookTouchIdentifier = null;
                    break;
                }
            }
        }
    };
    lookZone.addEventListener('touchend', endLook, { passive: false });
    lookZone.addEventListener('touchcancel', endLook, { passive: false });

    const throwBtn = document.getElementById('btn-throw');
    const throwAction = (e) => {
        e.preventDefault(); e.stopPropagation();
        if(isGameOver || ammoInMagazine <= 0) return;

        ammoInMagazine--;
        updateHUD();

        // Muzzle flash
        const muzzleFlash = new THREE.PointLight(0xffcc00, 10, 5);
        muzzleFlash.position.set(0.5, -0.4, -2);
        camera.add(muzzleFlash);
        setTimeout(() => camera.remove(muzzleFlash), 50);

        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);

        const startPos = new THREE.Vector3();
        pistol.getWorldPosition(startPos);
        startPos.addScaledVector(camDir, 0.5); // Start the bullet slightly in front of the gun

        socket.emit('fire', {
            type: 'NORMAL', // Server expects 'NORMAL'
            position: startPos,
            direction: camDir
        });
    };
    throwBtn.addEventListener('touchstart', throwAction); throwBtn.addEventListener('mousedown', throwAction);

    const reloadBtn = document.getElementById('btn-reload');
    const reloadAction = (e) => {
        e.preventDefault(); e.stopPropagation();
        if(isGameOver) return;
        socket.emit('reloadWeapon');
    };
    reloadBtn.addEventListener('touchstart', reloadAction);
    reloadBtn.addEventListener('mousedown', reloadAction);


    const chatInput = document.getElementById('chat-input');
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && chatInput.value) {
            socket.emit('chatMessage', chatInput.value);
            chatInput.value = '';
        }
    });

    socket.on('chatMessage', (data) => {
        const messages = document.getElementById('chat-messages');
        const msgElement = document.createElement('div');
        msgElement.textContent = `${data.username}: ${data.message}`;
        messages.appendChild(msgElement);
        messages.scrollTop = messages.scrollHeight;
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

function createPistol() {
    const pistolGroup = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x333333 });

    // Main body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.8), bodyMat);
    pistolGroup.add(body);

    // Handle
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.2), bodyMat);
    handle.position.set(0, -0.25, 0.1);
    handle.rotation.x = 0.2;
    pistolGroup.add(handle);

    pistolGroup.position.set(0.5, -0.4, -1);
    pistolGroup.rotation.y = -0.2;

    return pistolGroup;
}
