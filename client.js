import * as THREE from 'https://unpkg.com/three@0.150.0/build/three.module.js';

let camera, scene, renderer;
let prevTime = performance.now();

let score = 0;
let currentWeaponIndex = 0;
let playerHP = 100;
const MAX_PLAYER_HP = 100;
let isGameOver = false;

const inventory = { NORMAL: 10, FROST: 0, GLUE: 0, BOMB: 0 };
const TYPES = {
    NORMAL: { key: 'NORMAL', color: 0xff0000, name: 'NORMAL', dmg: 1, uiColor: 'rgba(255,50,50,0.8)' },
    FROST:  { key: 'FROST',  color: 0x00ffff, name: 'FROST',  dmg: 0.5, uiColor: 'rgba(0,255,255,0.8)' },
    GLUE:   { key: 'GLUE',   color: 0x00ff00, name: 'GLUE',   dmg: 0, uiColor: 'rgba(50,200,50,0.8)' },
    BOMB:   { key: 'BOMB',   color: 0x222222, name: 'BOMB',   dmg: 5, uiColor: 'rgba(50,50,50,0.8)' }
};
const TYPE_KEYS = Object.keys(TYPES);

const enemyProjectiles = []; // 敵の弾
const targets = [];

const PLAYER_HEIGHT = 3.0;
const PLAYER_SPEED = 15.0;

const input = { moveX: 0, moveY: 0 };
let camRotation = { x: 0, y: 0 };

// --- クラス定義 ---

// 敵の弾丸クラス
class EnemyProjectile {
    constructor(scene, startPos, targetPos) {
        this.mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.4, 8, 8),
            new THREE.MeshStandardMaterial({ color: 0x220022 }) // 黒っぽい玉
        );
        this.mesh.position.copy(startPos);
        scene.add(this.mesh);

        // プレイヤーへ向けて発射
        const dir = new THREE.Vector3().subVectors(targetPos, startPos).normalize();
        this.velocity = dir.multiplyScalar(20.0); // 弾速
        this.velocity.y += 5.0; // 少し山なり
        this.active = true;
        this.lifeTime = 3.0; // 3秒で消滅
    }

    update(dt, playerPos) {
        if (!this.active) return false;

        this.lifeTime -= dt;
        if (this.lifeTime <= 0) {
            this.dispose();
            return false;
        }

        // 物理移動
        this.velocity.y -= 20 * dt; // 重力
        this.mesh.position.addScaledVector(this.velocity, dt);

        // 地面
        if (this.mesh.position.y < 0.5) {
            this.dispose();
            return false;
        }

        // プレイヤーとの当たり判定
        // プレイヤーは camera.position (高さ3.0)
        // 足元〜頭まで判定したいので、XZ距離で判定し、Yもある程度見る
        const distXZ = Math.sqrt(
            Math.pow(this.mesh.position.x - playerPos.x, 2) +
            Math.pow(this.mesh.position.z - playerPos.z, 2)
        );

        if (distXZ < 1.0 && this.mesh.position.y < PLAYER_HEIGHT + 1 && this.mesh.position.y > 0) {
            takePlayerDamage(10);
            this.dispose();
            return false;
        }

        return true;
    }

    dispose() {
        this.active = false;
        scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}

const clientTargets = {};
const clientMinions = {};
let socket;
const otherPlayers = {};

init();

function init() {
    socket = io();
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
    camera.position.set(0, PLAYER_HEIGHT, 10);
    camera.rotation.order = "YXZ";
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.body.appendChild(renderer.domElement);

    document.getElementById('ui-layer').style.display = 'none';

    window.addEventListener('resize', onWindowResize);
    document.getElementById('play-button').addEventListener('click', () => {
        const username = document.getElementById('username-input').value;
        if (username) {
            socket.emit('initPlayer', { username });
            document.getElementById('start-screen').style.display = 'none';
            document.getElementById('ui-layer').style.display = 'block';
            updateWeaponUI();
            updateShopUI();
            updatePlayerHPUI();
            setupControls();
            animate();
        }
    });

    document.getElementById('retry-btn').addEventListener('click', resetGame);

    socket.on('playerDamaged', (data) => {
        takePlayerDamage(data.damage);
    });

    socket.on('currentPlayers', (players) => {
        Object.keys(players).forEach((id) => {
            if (players[id].id !== socket.id) {
                addOtherPlayer(players[id]);
            }
        });
    });

    socket.on('newPlayer', (playerInfo) => {
        addOtherPlayer(playerInfo);
    });

    socket.on('playerDisconnected', (id) => {
        if (otherPlayers[id]) {
            scene.remove(otherPlayers[id]);
            delete otherPlayers[id];
        }
    });

    socket.on('playerMoved', (playerInfo) => {
        if (otherPlayers[playerInfo.id]) {
            otherPlayers[playerInfo.id].position.set(playerInfo.position.x, playerInfo.position.y, playerInfo.position.z);
            otherPlayers[playerInfo.id].rotation.set(playerInfo.rotation.x, playerInfo.rotation.y, playerInfo.rotation.z);
        }
    });

    function addOtherPlayer(playerInfo) {
        const playerGroup = new THREE.Group();
        playerGroup.position.set(playerInfo.position.x, playerInfo.position.y, playerInfo.position.z);

        // Materials
        const skinMat = new THREE.MeshStandardMaterial({color: 0xffccaa});
        const shirtMat = new THREE.MeshStandardMaterial({color: new THREE.Color().setHSL(Math.random(), 0.5, 0.5)});
        const pantsMat = new THREE.MeshStandardMaterial({color: new THREE.Color().setHSL(Math.random(), 0.5, 0.2)});

        // Body parts
        const head = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), skinMat);
        head.position.y = 1.5;
        playerGroup.add(head);

        const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1.5, 0.5), shirtMat);
        body.position.y = 0.25;
        playerGroup.add(body);

        const arm1 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.5, 0.4), skinMat);
        arm1.position.set(-0.7, 0.25, 0);
        playerGroup.add(arm1);

        const arm2 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.5, 0.4), skinMat);
        arm2.position.set(0.7, 0.25, 0);
        playerGroup.add(arm2);

        const leg1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1, 0.5), pantsMat);
        leg1.position.set(-0.25, -1, 0);
        playerGroup.add(leg1);

        const leg2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1, 0.5), pantsMat);
        leg2.position.set(0.25, -1, 0);
        playerGroup.add(leg2);

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        context.font = 'Bold 20px Arial';
        context.fillStyle = 'white';
        context.fillText(playerInfo.username, 0, 20);
        const texture = new THREE.CanvasTexture(canvas);

        const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.position.y = 2.5;
        playerGroup.add(sprite);

        otherPlayers[playerInfo.id] = playerGroup;
        scene.add(playerGroup);
    }

    socket.on('targetsUpdate', (targetsState) => {
        for (const id in targetsState) {
            updateTarget(targetsState[id]);
        }
    });

    function updateTarget(targetState) {
        let target = clientTargets[targetState.id];
        if (!target) {
            target = createTargetMesh();
            clientTargets[targetState.id] = target;
            scene.add(target.mesh);
        }

        if (targetState.active) {
            target.mesh.visible = true;
            target.mesh.position.set(targetState.position.x, targetState.position.y, targetState.position.z);
            target.mesh.rotation.y = targetState.rotationY;

            const hpRatio = targetState.hp / targetState.maxHp;
            target.hpBar.scale.x = hpRatio;
            target.hpGroup.lookAt(camera.position);

        } else {
            target.mesh.visible = false;
        }
    }

    socket.on('gameStateUpdate', (data) => {
        // Update targets
        for (const id in data.targets) {
            updateTarget(data.targets[id]);
        }

        // Update minions
        const receivedMinions = new Set();
        for (const id in data.minions) {
            const minionState = data.minions[id];
            receivedMinions.add(id);
            let minion = clientMinions[id];
            if (!minion) {
                const geo = new THREE.SphereGeometry(0.5, 16, 16);
                const mat = new THREE.MeshStandardMaterial({ color: TYPES[minionState.type].color });
                minion = new THREE.Mesh(geo, mat);
                clientMinions[id] = minion;
                scene.add(minion);
            }
            minion.position.set(minionState.position.x, minionState.position.y, minionState.position.z);
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
        updateShopUI();
    });

    socket.on('updateInventory', (data) => {
        Object.assign(inventory, data.inventory);
        updateWeaponUI();
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

    // ダメージエフェクト
    const overlay = document.getElementById('damage-overlay');
    overlay.style.opacity = 0.5;
    setTimeout(() => { overlay.style.opacity = 0; }, 100);

    if (playerHP <= 0) {
        gameOver();
    }
}

function gameOver() {
    isGameOver = true;
    socket.emit('playerDied');
    document.getElementById('final-score').innerText = score;
    document.getElementById('game-over-screen').style.display = 'flex';
}

function resetGame() {
    socket.emit('requestRespawn');
    document.getElementById('game-over-screen').style.display = 'none';
    isGameOver = false;
}

function updateShopUI() {
    const btns = document.querySelectorAll('.shop-btn');
    btns.forEach(btn => {
        const baseCost = parseInt(btn.dataset.cost);
        const mul = parseInt(btn.dataset.mul);
        const totalCost = baseCost * mul;
        if (score >= totalCost) btn.classList.remove('disabled'); else btn.classList.add('disabled');
    });
}

function updateWeaponUI() {
    const currentKey = TYPE_KEYS[currentWeaponIndex];
    const typeData = TYPES[currentKey];
    const count = inventory[currentKey];
    document.getElementById('ws-name').innerText = typeData.name;
    document.getElementById('ws-icon').style.background = '#' + typeData.color.toString(16).padStart(6, '0');
    document.getElementById('ws-count').innerText = count;
    const fireBtn = document.getElementById('btn-throw');
    fireBtn.style.background = typeData.uiColor;
    if (count <= 0) { fireBtn.classList.add('empty'); fireBtn.innerText = "EMPTY"; }
    else { fireBtn.classList.remove('empty'); fireBtn.innerText = "FIRE"; }
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
    lookZone.addEventListener('touchstart', (e) => {
        lookStartX = e.changedTouches[0].clientX; lookStartY = e.changedTouches[0].clientY;
    }, {passive: false});
    lookZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        const sensitivity = 0.005;
        camRotation.y -= (t.clientX - lookStartX) * sensitivity;
        camRotation.x -= (t.clientY - lookStartY) * sensitivity;
        camRotation.x = Math.max(-1.4, Math.min(1.4, camRotation.x));
        lookStartX = t.clientX; lookStartY = t.clientY;
    }, {passive: false});

    document.getElementById('ws-prev').addEventListener('click', () => {
        currentWeaponIndex = (currentWeaponIndex - 1 + TYPE_KEYS.length) % TYPE_KEYS.length;
        updateWeaponUI();
    });
    document.getElementById('ws-next').addEventListener('click', () => {
        currentWeaponIndex = (currentWeaponIndex + 1) % TYPE_KEYS.length;
        updateWeaponUI();
    });
    document.getElementById('weapon-selector').addEventListener('click', (e) => {
        if(e.target.classList.contains('arrow-btn')) return;
        currentWeaponIndex = (currentWeaponIndex + 1) % TYPE_KEYS.length;
        updateWeaponUI();
    });

    const shopToggle = document.getElementById('shop-toggle');
    const shopList = document.getElementById('shop-list');
    const toggleShop = (e) => {
        e.preventDefault(); e.stopPropagation();
        shopList.classList.toggle('closed');
        shopToggle.innerText = shopList.classList.contains('closed') ? 'SHOP ▼' : 'SHOP ▲';
    };
    shopToggle.addEventListener('touchstart', toggleShop, {passive: false});
    shopToggle.addEventListener('mousedown', toggleShop);

    const buyAction = (e, btn) => {
        e.stopPropagation();
        const type = btn.dataset.type;
        const mul = parseInt(btn.dataset.mul);
        socket.emit('buyItem', { item: type, quantity: mul });
    };
    document.querySelectorAll('.shop-btn').forEach(btn => {
        btn.addEventListener('touchstart', (e) => buyAction(e, btn), {passive: false});
        btn.addEventListener('mousedown', (e) => buyAction(e, btn));
    });

    const throwBtn = document.getElementById('btn-throw');
    const throwAction = (e) => {
        e.preventDefault(); e.stopPropagation();
        if(isGameOver) return;
        const currentKey = TYPE_KEYS[currentWeaponIndex];
        if (inventory[currentKey] > 0) {
            const camDir = new THREE.Vector3();
            camera.getWorldDirection(camDir);
            socket.emit('fire', {
                type: currentKey,
                position: camera.position,
                direction: camDir
            });
            inventory[currentKey]--;
            updateWeaponUI();
        }
    };
    throwBtn.addEventListener('touchstart', throwAction); throwBtn.addEventListener('mousedown', throwAction);

    const callBtn = document.getElementById('btn-call');
    const callAction = (e) => {
        e.preventDefault(); e.stopPropagation();
        if(isGameOver) return;
        socket.emit('recallMinions');
        const msg = document.getElementById('reload-msg');
        msg.style.display = 'block';
        setTimeout(() => { msg.style.display = 'none'; }, 1000);
    };
    callBtn.addEventListener('touchstart', callAction); callBtn.addEventListener('mousedown', callAction);

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
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    const time = performance.now();
    const dt = Math.min((time - prevTime) / 1000, 0.1);
    prevTime = time;

    if(isGameOver) return;

    camera.rotation.x = camRotation.x;
    camera.rotation.y = camRotation.y;

    if (input.moveX !== 0 || input.moveY !== 0) {
        const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), camRotation.y);
        const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), camRotation.y);
        const moveDir = new THREE.Vector3();
        moveDir.addScaledVector(forward, -input.moveY);
        moveDir.addScaledVector(right, input.moveX);
        moveDir.normalize();
        camera.position.addScaledVector(moveDir, PLAYER_SPEED * dt);

        socket.emit('playerMovement', {
            position: camera.position,
            rotation: { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z }
        });
    }

    // 敵の弾更新
    for (let i = enemyProjectiles.length - 1; i >= 0; i--) {
        const p = enemyProjectiles[i];
        const alive = p.update(dt, camera.position);
        if (!alive) {
            enemyProjectiles.splice(i, 1);
        }
    }

    renderer.render(scene, camera);
}
