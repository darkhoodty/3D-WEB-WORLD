import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getDatabase, ref, set, get, child, onValue, onChildRemoved, onDisconnect } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// 1. Firebase 초기화 설정
const firebaseConfig = {
  apiKey: "AIzaSyC9czxn4jVG7V7Nui9COzkyEGV2xxIB_ZM",
  authDomain: "test-game-25cc6.firebaseapp.com",
  projectId: "test-game-25cc6",
  storageBucket: "test-game-25cc6.firebasestorage.app",
  messagingSenderId: "229498507763",
  appId: "1:229498507763:web:75978cb42462b620348286",
  measurementId: "G-DV9WBEPF50",
  databaseURL: "https://test-game-25cc6-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// 전역 상태 변수
let myUid = null;
let myModel = null;
const otherPlayers = {};
const keysPressed = {};
const moveSpeed = 0.15;
const MAX_PLAYERS = 15;

// 2. Three.js 기본 씬 설정
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 20, 80);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// 조명 추가
const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(10, 20, 15);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 1024;
dirLight.shadow.mapSize.height = 1024;
scene.add(dirLight);

// 3D 바닥 격자판 생성
const gridHelper = new THREE.GridHelper(100, 100, 0x444444, 0x222222);
gridHelper.position.y = 0.01;
scene.add(gridHelper);

const floorGeometry = new THREE.PlaneGeometry(100, 100);
const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 });
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// GLTF 로더
const gltfLoader = new GLTFLoader();

// 3. GLB 모델 로드 함수
function loadGLBModel(modelPath, callback) {
  gltfLoader.load(
    modelPath,
    (gltf) => {
      const model = gltf.scene;
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      scene.add(model);
      callback(model);
    },
    undefined,
    (error) => {
      console.error(`GLB 모델 로드 오류 (${modelPath}):`, error);
      const geometry = new THREE.CapsuleGeometry(0.5, 1, 4, 8);
      const material = new THREE.MeshStandardMaterial({ color: Math.random() * 0xffffff });
      const fallbackModel = new THREE.Mesh(geometry, material);
      fallbackModel.position.y = 1;
      scene.add(fallbackModel);
      callback(fallbackModel);
    }
  );
}

// 4. UI 엘리먼트 참조
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const characterSelect = document.getElementById('character-select');
const loginBtn = document.getElementById('login-btn');
const signupBtn = document.getElementById('signup-btn');
const statusDiv = document.getElementById('status');
const authForm = document.getElementById('auth-form');
const controlsInfo = document.getElementById('controls-info');

// 회원가입 이벤트
signupBtn.addEventListener('click', () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();

  if (!email || !password) {
    statusDiv.innerText = '이메일과 비밀번호를 모두 입력해주세요.';
    return;
  }

  createUserWithEmailAndPassword(auth, email, password)
    .then(() => {
      statusDiv.innerText = '회원가입 완료! 로그인 버튼을 눌러주세요.';
    })
    .catch((error) => {
      statusDiv.innerText = '회원가입 오류: ' + error.message;
    });
});

// 로그인 이벤트
loginBtn.addEventListener('click', () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  const selectedModelPath = characterSelect.value;

  if (!email || !password) {
    statusDiv.innerText = '이메일과 비밀번호를 모두 입력해주세요.';
    return;
  }

  const dbRef = ref(db);
  get(child(dbRef, 'players')).then((snapshot) => {
    let currentCount = 0;
    if (snapshot.exists()) {
      currentCount = Object.keys(snapshot.val()).length;
    }

    if (currentCount >= MAX_PLAYERS) {
      statusDiv.innerText = `접속 불가: 현재 동시 접속 인원(${MAX_PLAYERS}명)이 가득 차 있습니다.`;
      return;
    }

    signInWithEmailAndPassword(auth, email, password)
      .then((userCredential) => {
        myUid = userCredential.user.uid;
        authForm.style.display = 'none';
        controlsInfo.style.display = 'block';
        statusDiv.innerText = `접속 성공: ${email}`;

        startGame(selectedModelPath);
      })
      .catch((error) => {
        statusDiv.innerText = '로그인 오류: ' + error.message;
      });
  });
});

// 5. 게임 시작 및 내 캐릭터 배치
function startGame(modelPath) {
  loadGLBModel(modelPath, (model) => {
    myModel = model;
    const initialPos = {
      x: (Math.random() - 0.5) * 10,
      y: 0,
      z: (Math.random() - 0.5) * 10
    };

    myModel.position.set(initialPos.x, initialPos.y, initialPos.z);

    const userRef = ref(db, 'players/' + myUid);
    set(userRef, {
      email: auth.currentUser.email,
      modelPath: modelPath,
      x: initialPos.x,
      y: initialPos.y,
      z: initialPos.z
    });

    onDisconnect(userRef).remove();
    initRealtimeSync();
  });
}

// 6. 실시간 위치 및 상대방 캐릭터 동기화
function initRealtimeSync() {
  const playersRef = ref(db, 'players');

  onValue(playersRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    Object.keys(data).forEach((uid) => {
      if (uid === myUid) return;

      const playerData = data[uid];

      if (!otherPlayers[uid]) {
        otherPlayers[uid] = { loaded: false, mesh: null };
        loadGLBModel(playerData.modelPath, (loadedModel) => {
          otherPlayers[uid].mesh = loadedModel;
          otherPlayers[uid].loaded = true;
          loadedModel.position.set(playerData.x, playerData.y, playerData.z);
        });
      } else if (otherPlayers[uid].loaded) {
        otherPlayers[uid].mesh.position.set(playerData.x, playerData.y, playerData.z);
      }
    });
  });

  onChildRemoved(playersRef, (snapshot) => {
    const removedUid = snapshot.key;
    if (otherPlayers[removedUid]) {
      if (otherPlayers[removedUid].mesh) {
        scene.remove(otherPlayers[removedUid].mesh);
      }
      delete otherPlayers[removedUid];
    }
  });
}

// 7. 캐릭터 이동 조작
window.addEventListener('keydown', (e) => {
  keysPressed[e.key.toLowerCase()] = true;
});

window.addEventListener('keyup', (e) => {
  keysPressed[e.key.toLowerCase()] = false;
});

function updateMovement() {
  if (!myModel || !myUid) return;

  let moved = false;

  if (keysPressed['w'] || keysPressed['arrowup']) {
    myModel.position.z -= moveSpeed;
    moved = true;
  }
  if (keysPressed['s'] || keysPressed['arrowdown']) {
    myModel.position.z += moveSpeed;
    moved = true;
  }
  if (keysPressed['a'] || keysPressed['arrowleft']) {
    myModel.position.x -= moveSpeed;
    moved = true;
  }
  if (keysPressed['d'] || keysPressed['arrowright']) {
    myModel.position.x += moveSpeed;
    moved = true;
  }

  if (moved) {
    set(ref(db, `players/${myUid}/x`), myModel.position.x);
    set(ref(db, `players/${myUid}/z`), myModel.position.z);
  }

  camera.position.x = myModel.position.x;
  camera.position.y = myModel.position.y + 8;
  camera.position.z = myModel.position.z + 12;
  camera.lookAt(myModel.position);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  requestAnimationFrame(animate);
  updateMovement();
  renderer.render(scene, camera);
}

animate();