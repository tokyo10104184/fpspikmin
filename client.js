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
let weapons = {};
let currentWeapon = 'pistol';
let playerWeaponsState = {};

const WEAPON_CONFIG = {
    'pistol': {
        name: 'Pistol',
        color: 0xcccccc,
        magazineSize: 10,
        uiColor: 'rgba(200, 200, 200, 0.6)'
    },
    'rifle': {
        name: 'Rifle',
        color: 0x999999,
        magazineSize: 30,
        uiColor: 'rgba(150, 150, 150, 0.6)'
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

    weapons.pistol = createPistol();
    weapons.rifle = createRifle();
    weapons.rifle.visible = false;
    camera.add(weapons.pistol);
    camera.add(weapons.rifle);
    scene.add(camera); // Add camera to scene so weapons are visible

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

            // The server will send back the full player state, which we'll use
            // to initialize everything in the 'currentPlayers' or a new 'initAck' event
            document.getElementById('start-screen').style.display = 'none';
            document.getElementById('ui-layer').style.display = 'block';
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
            if (players[id].id === socket.id) {
                const myPlayer = players[id];
                playerWeaponsState = myPlayer.weapons;
                currentWeapon = myPlayer.currentWeapon;
                playerAvatar = createPlayerAvatar(myPlayer.color);
                playerAvatar.visible = false;
                scene.add(playerAvatar);

                for (const weaponName in weapons) {
                    weapons[weaponName].visible = (weaponName === currentWeapon);
                }

                updateHUD();
            } else {
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

    socket.on('playerDisconnected', (id) => {
        if (otherPlayers[id]) {
            scene.remove(otherPlayers[id].group);
            delete otherPlayers[id];
        }
    });

    socket.on('playerDied', (data) => {
        if (otherPlayers[data.id]) {
            otherPlayers[data.id].group.visible = false;
        }
    });

    socket.on('playerMoved', (playerInfo) => {
        if (otherPlayers[playerInfo.id]) {
            otherPlayers[playerInfo.id].group.position.set(playerInfo.position.x, playerInfo.position.y, playerInfo.position.z);
            otherPlayers[playerInfo.id].group.rotation.y = playerInfo.rotation.y;

            const hpRatio = playerInfo.hp / MAX_PLAYER_HP;
            if (otherPlayers[playerInfo.id].hpBar) {
                otherPlayers[playerInfo.id].hpBar.scale.x = hpRatio;
            }
        }
    });

    function createPlayerAvatar(color) {
        const playerGroup = new THREE.Group();
        playerGroup.position.set(0, PLAYER_HEIGHT / 2, 10);

        const skinMat = new THREE.MeshStandardMaterial({color: 0xffccaa});
        const shirtMat = new THREE.MeshStandardMaterial({color: color || 0xffffff});
        const pantsMat = new THREE.MeshStandardMaterial({color: 0x3333ff});

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

        return playerGroup;
    }

    function addOtherPlayer(playerInfo) {
        const playerGroup = createPlayerAvatar(playerInfo.color);
        playerGroup.visible = !playerInfo.isDead;

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        context.font = 'Bold 40px Arial'; // Increased font size
        context.fillStyle = 'white';
        context.strokeStyle = 'black';
        context.lineWidth = 2;
        const textWidth = context.measureText(playerInfo.username).width;
        canvas.width = textWidth;
        canvas.height = 40;
        context.font = 'Bold 40px Arial'; // Reset font after canvas resize
        context.fillStyle = 'white';
        context.strokeStyle = 'black';
        context.lineWidth = 2;
        context.strokeText(playerInfo.username, 0, 35);
        context.fillText(playerInfo.username, 0, 35);

        const texture = new THREE.CanvasTexture(canvas);

        const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.position.y = 2.8;
        playerGroup.add(sprite);

        const hpGroup = new THREE.Group();
        hpGroup.position.y = 2.4;
        const bgGeo = new THREE.PlaneGeometry(1.5, 0.2);
        const bgMat = new THREE.MeshBasicMaterial({ color: 0x330000 });
        hpGroup.add(new THREE.Mesh(bgGeo, bgMat));
        const barGeo = new THREE.PlaneGeometry(1.5, 0.2);
        barGeo.translate(0.75, 0, 0);
        const barMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
        const hpBar = new THREE.Mesh(barGeo, barMat);
        hpBar.position.x = -0.75;
        hpGroup.add(hpBar);
        playerGroup.add(hpGroup);

        otherPlayers[playerInfo.id] = {
            group: playerGroup,
            hpBar: hpBar,
            hpGroup: hpGroup
        };
        scene.add(playerGroup);
    }

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
                const geo = new THREE.SphereGeometry(0.1, 8, 8); // Smaller sphere for bullets
                const mat = new THREE.MeshStandardMaterial({ color: 0x333333 }); // Generic bullet color
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
    });

    socket.on('weaponReloaded', (data) => {
        if (playerWeaponsState[data.weapon]) {
            playerWeaponsState[data.weapon].ammoInMagazine = data.ammoInMagazine;
            updateHUD();
        }
    });

    socket.on('weaponSwitched', (data) => {
        currentWeapon = data.currentWeapon;
        // Toggle visibility
        for (const weaponName in weapons) {
            weapons[weaponName].visible = (weaponName === currentWeapon);
        }
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
}

function gameOver() {
    isGameOver = true;
    if (playerAvatar) playerAvatar.visible = false;
    document.getElementById('final-score').innerText = score;
    document.getElementById('game-over-screen').style.display = 'flex';
}

function resetGame() {
    socket.emit('requestRespawn');
    document.getElementById('game-over-screen').style.display = 'none';
    isGameOver = false;
    playerHP = MAX_PLAYER_HP;
    updatePlayerHPUI();
    if (playerAvatar) {
        playerAvatar.visible = true;
        playerAvatar.position.set(0, PLAYER_HEIGHT / 2, 10);
    }
}

function updateHUD() {
    if (!playerWeaponsState.pistol || !playerWeaponsState.rifle) return;

    const primaryWeapon = currentWeapon;
    const secondaryWeapon = (currentWeapon === 'pistol') ? 'rifle' : 'pistol';

    // Update Primary HUD
    const primaryConfig = WEAPON_CONFIG[primaryWeapon];
    const primaryState = playerWeaponsState[primaryWeapon];
    document.getElementById('weapon-name-primary').innerText = primaryConfig.name;
    document.getElementById('weapon-ammo-primary').innerHTML = `${primaryState.ammoInMagazine} <span class="ammo-total">/ ∞</span>`;

    // Update Secondary HUD
    const secondaryConfig = WEAPON_CONFIG[secondaryWeapon];
    const secondaryState = playerWeaponsState[secondaryWeapon];
    document.getElementById('weapon-name-secondary').innerText = secondaryConfig.name;
    document.getElementById('weapon-ammo-secondary').innerHTML = `${secondaryState.ammoInMagazine} <span class="ammo-total">/ ∞</span>`;

    // Update Fire Button
    const fireBtn = document.getElementById('btn-throw');
    fireBtn.style.background = primaryConfig.uiColor;
    if (primaryState.ammoInMagazine > 0) {
        fireBtn.classList.remove('empty');
        fireBtn.innerText = "FIRE";
    } else {
        fireBtn.classList.add('empty');
        fireBtn.innerText = "EMPTY";
    }
}

function setupControls() {
    document.getElementById('weapon-hud-secondary').addEventListener('click', () => {
        const secondaryWeapon = (currentWeapon === 'pistol') ? 'rifle' : 'pistol';
        socket.emit('switchWeapon', secondaryWeapon);
    });

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

    const fireBtn = document.getElementById('btn-throw');
    const fireAction = (e) => {
        e.preventDefault(); e.stopPropagation();
        if(isGameOver || !playerWeaponsState[currentWeapon] || playerWeaponsState[currentWeapon].ammoInMagazine <= 0) return;

        playerWeaponsState[currentWeapon].ammoInMagazine--;
        updateHUD();

        const activeWeaponModel = weapons[currentWeapon];

        // Muzzle flash
        const muzzleFlash = new THREE.PointLight(0xffcc00, 10, 5);
        muzzleFlash.position.set(activeWeaponModel.position.x, activeWeaponModel.position.y, activeWeaponModel.position.z - 1.0); // Approx barrel end
        camera.add(muzzleFlash);
        setTimeout(() => camera.remove(muzzleFlash), 50);

        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);

        const startPos = new THREE.Vector3();
        activeWeaponModel.getWorldPosition(startPos);
        startPos.addScaledVector(camDir, 0.5);

        socket.emit('fire', {
            type: currentWeapon.toUpperCase(),
            position: startPos,
            direction: camDir
        });
    };
    fireBtn.addEventListener('touchstart', fireAction); fireBtn.addEventListener('mousedown', fireAction);

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

    const hudToggleButton = document.getElementById('hud-toggle');
    const hudContainer = document.getElementById('collapsible-hud');

    hudToggleButton.addEventListener('click', () => {
        hudContainer.classList.toggle('collapsed');
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

    frames++;
    if (time >= lastFPSTime + 1000) {
        document.getElementById('fps-counter').innerText = `FPS: ${frames}`;
        frames = 0;
        lastFPSTime = time;
    }

    if (!isGameOver && playerAvatar) {
        if (input.moveX !== 0 || input.moveY !== 0) {
            const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), camRotation.y);
            const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), camRotation.y);
            const moveDir = new THREE.Vector3();
            moveDir.addScaledVector(forward, -input.moveY);
            moveDir.addScaledVector(right, input.moveX);
            moveDir.normalize();

            playerAvatar.position.addScaledVector(moveDir, PLAYER_SPEED * dt);
            playerAvatar.rotation.y = Math.atan2(moveDir.x, moveDir.z);
        }

        // First-person camera logic
        camera.position.copy(playerAvatar.position);
        camera.position.y += 1.5; // Raise camera to eye level
        camera.rotation.set(camRotation.x, camRotation.y, 0);

        socket.emit('playerMovement', {
            position: playerAvatar.position,
            rotation: { x: 0, y: camRotation.y, z: 0 } // Send camera rotation
        });

        // Update coordinates UI
        const coords = playerAvatar.position;
        document.getElementById('coordinates').textContent =
            `X: ${coords.x.toFixed(2)} Y: ${coords.y.toFixed(2)} Z: ${coords.z.toFixed(2)}`;
    }

    // Update other players' HP bars to face the camera
    for (const id in otherPlayers) {
        if (otherPlayers[id].hpGroup) {
            otherPlayers[id].hpGroup.lookAt(camera.position);
        }
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

function createRifle() {
    const rifleGroup = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });

    // Main body and barrel
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 2.5), bodyMat);
    rifleGroup.add(body);

    // Stock
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.6), woodMat);
    stock.position.set(0, -0.1, 1.5);
    rifleGroup.add(stock);

    // Handle
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.2), bodyMat);
    handle.position.set(0, -0.2, 0.5);
    handle.rotation.x = 0.3;
    rifleGroup.add(handle);

    // Magazine
    const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.4), bodyMat);
    magazine.position.set(0, -0.3, 0);
    rifleGroup.add(magazine);

    // Scope
    const scope = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, 0.3), bodyMat);
    scope.position.y = 0.25;
    rifleGroup.add(scope);

    rifleGroup.position.set(0.6, -0.5, -1.5);
    rifleGroup.rotation.y = -0.1;

    return rifleGroup;
}
