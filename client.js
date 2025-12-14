// client.js の変数定義部分に追加
let maxAmmo = 10;
let currentAmmo = 10;
let isReloading = false;

// HTML要素の取得
const ammoDisplay = document.getElementById('current-ammo');
const reloadBtn = document.getElementById('btn-reload');
const reloadMsg = document.getElementById('reload-msg');

// 発射関数（既存の shoot/fire 関数内）の先頭に制限を追加
function shoot() {
    // 弾切れ または リロード中は撃てない
    if (currentAmmo <= 0 || isReloading) {
        if (currentAmmo <= 0) {
            // カチッという音を鳴らすなどの処理推奨
            console.log("Empty mag!");
        }
        return; 
    }

    // --- ここに既存の発射ロジック ---
    // socket.emit('shoot', ...); など
    
    // 発射成功後、弾を減らす
    currentAmmo--;
    updateAmmoHUD();
}

// リロード関数
function reload() {
    if (isReloading || currentAmmo === maxAmmo) return; // 既にリロード中か満タンなら無視

    isReloading = true;
    reloadBtn.classList.add('reloading'); // 回転アニメーション用クラス
    reloadMsg.style.display = 'block';
    reloadMsg.innerText = "RELOADING...";

    // リロード時間（例: 2秒）
    setTimeout(() => {
        currentAmmo = maxAmmo;
        isReloading = false;
        reloadBtn.classList.remove('reloading');
        reloadMsg.style.display = 'none';
        updateAmmoHUD();
    }, 2000);
}

// HUD更新関数
function updateAmmoHUD() {
    ammoDisplay.innerText = currentAmmo;
    // 弾切れ時のスタイル変更
    const fireBtn = document.getElementById('btn-throw');
    if (currentAmmo <= 0) {
        fireBtn.classList.add('empty');
    } else {
        fireBtn.classList.remove('empty');
    }
}

// イベントリスナーの追加
reloadBtn.addEventListener('click', reload);
reloadBtn.addEventListener('touchstart', (e) => { e.preventDefault(); reload(); }); // スマホ対応
