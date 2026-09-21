/* ============================================================
   "No pude comprarte una flor, así que construí un campo entero."
   Experiencia 3D para Gina Marcela — Three.js / WebGL
   Diseñada para celular en orientación horizontal.
   ============================================================ */

(function () {
  'use strict';

  /* ---------------------------------------------------------
     0. Referencias DOM
     --------------------------------------------------------- */
  const canvas = document.getElementById('scene');
  const rotateOverlay = document.getElementById('rotate-overlay');
  const loadingOverlay = document.getElementById('loading-overlay');
  const startOverlay = document.getElementById('start-overlay');
  const startBtn = document.getElementById('start-btn');
  const narrative = document.getElementById('narrative');
  const narrativeText = document.getElementById('narrative-text');
  const exploreHint = document.getElementById('explore-hint');
  const flowerNote = document.getElementById('flower-note');
  const ui = document.getElementById('ui');
  const fieldViewBtn = document.getElementById('field-view-btn');
  const soundBtn = document.getElementById('sound-btn');
  const messageBtn = document.getElementById('message-btn');
  const messageOverlay = document.getElementById('message-overlay');
  const closeMessageBtn = document.getElementById('close-message-btn');
  const signOverlay = document.getElementById('sign-overlay');
  const closeSignBtn = document.getElementById('close-sign-btn');
  const ambientAudio = document.getElementById('ambient-audio');

  const show = (el) => el && el.classList.remove('hidden');
  const hide = (el) => el && el.classList.add('hidden');

  /* ---------------------------------------------------------
     1. Detección de capacidad del dispositivo (calidad adaptativa)
     --------------------------------------------------------- */
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  const dpr = window.devicePixelRatio || 1;

  function detectQuality() {
    // Permitir forzar la calidad con ?q=high|medium|low (útil para el S26 Ultra)
    const forced = new URLSearchParams(location.search).get('q');
    if (forced === 'high' || forced === 'medium' || forced === 'low') return forced;

    const mem = navigator.deviceMemory || (isTouch ? 3 : 8);
    const cores = navigator.hardwareConcurrency || (isTouch ? 4 : 8);
    const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 500;
    let score = 0;
    score += mem >= 6 ? 2 : mem >= 4 ? 1 : 0;
    score += cores >= 8 ? 2 : cores >= 4 ? 1 : 0;
    score += !isTouch ? 2 : 0;
    score += smallScreen ? 0 : 1;
    // teléfonos modernos de gama alta suelen reportar 8 núcleos: dales 'high'
    if (isTouch && cores >= 8 && mem >= 4) return 'high';

    if (score >= 5) return 'high';
    if (score >= 2) return 'medium';
    return 'low';
  }

  const QUALITY = detectQuality();

  const QCONF = {
    // 'ultra' de facto para gama alta: más flores, más pasto, sombras nítidas
    high:   { flowers: 1300, codeParticles: 1600, shadows: true,  pixelRatio: Math.min(dpr, 2.5), field: 130, grass: 9000, rocks: 180, shadowMap: 2048 },
    medium: { flowers: 520,  codeParticles: 800,  shadows: true,  pixelRatio: Math.min(dpr, 1.5), field: 100, grass: 3200, rocks: 80,  shadowMap: 1024 },
    low:    { flowers: 240,  codeParticles: 420,  shadows: false, pixelRatio: Math.min(dpr, 1),   field: 80,  grass: 1400, rocks: 40,  shadowMap: 512  }
  }[QUALITY];

  /* ---------------------------------------------------------
     2. Estado global de la experiencia
     --------------------------------------------------------- */
  const STATE = {
    phase: 'idle',        // idle | building | cinematic | explore
    started: false,
    growth: 0,            // 0..1 progreso de crecimiento del campo
    time: 0,
    lastFrame: performance.now(),
    paused: false,
    selectedFlower: -1
  };

  /* ---------------------------------------------------------
     3. Escena, cámara, renderer
     --------------------------------------------------------- */
  let renderer, scene, camera;
  let sun, hemi;
  let clock = { last: performance.now() };

  function initRenderer() {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: QUALITY !== 'low',
      alpha: false,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(QCONF.pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.shadowMap.enabled = QCONF.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Tonemapping suave: ACES lava los amarillos saturados, usamos uno más neutro
    renderer.toneMapping = THREE.LinearToneMapping;
    renderer.toneMappingExposure = 1.0;
  }

  function initScene() {
    scene = new THREE.Scene();
    // Cielo azul de día, con niebla suave para profundidad
    scene.background = new THREE.Color(0x0a1030); // arranca oscuro; se aclara al iniciar
    scene.fog = new THREE.Fog(0x9fc4ff, 60, QCONF.field * 1.9);

    camera = new THREE.PerspectiveCamera(
      60, window.innerWidth / window.innerHeight, 0.1, 800
    );
    camera.position.set(0, 1.2, 8);
    camera.lookAt(0, 1.5, 0);
  }

  function initLights() {
    hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a5f2a, 0.9);
    scene.add(hemi);

    sun = new THREE.DirectionalLight(0xfff2d6, 1.25);
    sun.position.set(40, 60, 25);
    if (QCONF.shadows) {
      sun.castShadow = true;
      const sm = QCONF.shadowMap || 1024;
      sun.shadow.mapSize.set(sm, sm);
      sun.shadow.camera.near = 1;
      sun.shadow.camera.far = 200;
      const s = 60;
      sun.shadow.camera.left = -s;
      sun.shadow.camera.right = s;
      sun.shadow.camera.top = s;
      sun.shadow.camera.bottom = -s;
      sun.shadow.bias = -0.0004;
    }
    scene.add(sun);

    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.35);
    fill.position.set(-30, 20, -20);
    scene.add(fill);
  }

  /* ---------------------------------------------------------
     4. Cielo (gradiente) + nubes
     --------------------------------------------------------- */
  let skyMat, skyUniforms;
  function initSky() {
    skyUniforms = {
      topColor:    { value: new THREE.Color(0x2f6fd6) },
      bottomColor: { value: new THREE.Color(0xbfe0ff) },
      offset:      { value: 20 },
      exponent:    { value: 0.7 },
      dayFactor:   { value: 0.0 } // 0 = noche/oscuro, 1 = día pleno
    };
    skyMat = new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPosition = wp.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        uniform float dayFactor;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
          float t = pow(max(h, 0.0), exponent);
          vec3 dayCol = mix(bottomColor, topColor, t);
          vec3 nightCol = mix(vec3(0.04,0.05,0.16), vec3(0.06,0.03,0.18), t);
          vec3 col = mix(nightCol, dayCol, dayFactor);
          gl_FragColor = vec4(col, 1.0);
        }`
    });
    const skyGeo = new THREE.SphereGeometry(500, 24, 12);
    const sky = new THREE.Mesh(skyGeo, skyMat);
    scene.add(sky);
  }

  let clouds;
  function initClouds() {
    clouds = new THREE.Group();
    const cloudMat = new THREE.MeshLambertMaterial({
      color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false
    });
    const puff = new THREE.SphereGeometry(1, 8, 6);
    const count = QUALITY === 'low' ? 5 : 9;
    for (let i = 0; i < count; i++) {
      const g = new THREE.Group();
      const blobs = 3 + Math.floor(Math.random() * 3);
      for (let b = 0; b < blobs; b++) {
        const m = new THREE.Mesh(puff, cloudMat);
        m.position.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 5);
        const s = 3 + Math.random() * 4;
        m.scale.set(s, s * 0.6, s);
        g.add(m);
      }
      g.position.set(
        (Math.random() - 0.5) * 220,
        45 + Math.random() * 30,
        (Math.random() - 0.5) * 220
      );
      g.userData.speed = 0.6 + Math.random() * 0.8;
      clouds.add(g);
    }
    clouds.visible = false; // aparecen cuando amanece
    scene.add(clouds);
  }

  /* ---------------------------------------------------------
     5. Resize + orientación
     --------------------------------------------------------- */
  function onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (!renderer) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function isPortrait() {
    return window.matchMedia('(orientation: portrait)').matches ||
           window.innerHeight > window.innerWidth;
  }

  function handleOrientation() {
    if (isPortrait()) {
      show(rotateOverlay);
      STATE.paused = true;
    } else {
      hide(rotateOverlay);
      STATE.paused = false;
      onResize();
      // Primera vez en horizontal: mostrar inicio
      if (!STATE.started && loadingReady) {
        hide(loadingOverlay);
        show(startOverlay);
      }
    }
  }

  window.addEventListener('resize', () => { onResize(); handleOrientation(); });
  window.addEventListener('orientationchange', () => setTimeout(handleOrientation, 250));
  // MediaQueryList: addEventListener (moderno) con fallback addListener (Safari iOS antiguo)
  const mq = window.matchMedia('(orientation: portrait)');
  if (mq.addEventListener) mq.addEventListener('change', handleOrientation);
  else if (mq.addListener) mq.addListener(handleOrientation);

  /* placeholder para módulos que se añaden más abajo */
  let loadingReady = false;
  const MODULES = {};

  /* Exponer para las siguientes secciones del archivo */
  window.__EXP__ = {
    get canvas() { return canvas; },
    get renderer() { return renderer; },
    get scene() { return scene; },
    get camera() { return camera; },
    STATE, QCONF, QUALITY, isTouch,
    show, hide,
    dom: {
      rotateOverlay, loadingOverlay, startOverlay, startBtn, narrative, narrativeText,
      exploreHint, flowerNote, ui, fieldViewBtn, soundBtn, messageBtn,
      messageOverlay, closeMessageBtn, signOverlay, closeSignBtn, ambientAudio
    },
    MODULES,
    skyUniforms: null,
    setSkyUniforms(u) { this.skyUniforms = u; },
    clouds: null,
    setClouds(c) { this.clouds = c; },
    sun: null, hemi: null,
    onResize, handleOrientation,
    // ---- Altura del terreno: ÚNICA fuente de verdad ----
    // La usan el terreno, las flores, el pasto y las piedras para apoyarse igual.
    // El terreno tiene su mesh en y = TERRAIN_BASE; esta función ya lo incluye.
    TERRAIN_BASE: -0.2,
    groundHeight(x, z) {
      // lomas grandes + ondas medianas + detalle fino = desniveles naturales
      const big = Math.sin(x * 0.028) * 1.6 + Math.cos(z * 0.032) * 1.4;
      const mid = Math.sin((x + z) * 0.06) * 0.6 + Math.cos((x - z) * 0.05) * 0.5;
      const fine = Math.sin(x * 0.18) * 0.12 + Math.cos(z * 0.2) * 0.12;
      return this.TERRAIN_BASE + big + mid + fine;
    }
  };

  /* ---------------------------------------------------------
     Bootstrap del núcleo
     --------------------------------------------------------- */
  function initCore() {
    initRenderer();
    initScene();
    initLights();
    initSky();
    initClouds();

    const E = window.__EXP__;
    E.setSkyUniforms(skyUniforms);
    E.setClouds(clouds);
    E.sun = sun;
    E.hemi = hemi;

    loadingReady = true;
    handleOrientation();
  }

  // Se llama al final del archivo tras definir todos los módulos.
  window.__INIT_CORE__ = initCore;
})();

/* ============================================================
   MÓDULO: TERRENO
   ============================================================ */
(function () {
  const E = window.__EXP__;

  E.MODULES.terrain = {
    ground: null,
    matUniforms: null,

    build() {
      const size = E.QCONF.field * 2.2;
      const seg = E.QUALITY === 'low' ? 40 : 80;
      const geo = new THREE.PlaneGeometry(size, size, seg, seg);
      geo.rotateX(-Math.PI / 2);

      // Ondulación del terreno con desniveles naturales (misma fórmula compartida)
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        // groundHeight ya incluye TERRAIN_BASE; el mesh se queda en y=0
        pos.setY(i, E.groundHeight(x, z) - E.TERRAIN_BASE);
      }
      geo.computeVertexNormals();

      this.matUniforms = {
        uReveal: { value: 0 },       // 0..1 el terreno "aparece" desde el centro
        uTime:   { value: 0 },
        uColorA: { value: new THREE.Color(0x4f7a34) }, // verde
        uColorB: { value: new THREE.Color(0x6fae4a) },
        uDigital:{ value: new THREE.Color(0x6a4bff) }  // tinte morado inicial
      };

      const mat = new THREE.MeshStandardMaterial({
        color: 0x6fae4a,
        roughness: 0.95,
        metalness: 0.0
      });
      // Inyectar revelado + tinte digital
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uReveal = this.matUniforms.uReveal;
        shader.uniforms.uTime = this.matUniforms.uTime;
        shader.uniforms.uDigital = this.matUniforms.uDigital;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vPos;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPos = position;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uReveal;\nuniform float uTime;\nuniform vec3 uDigital;\nvarying vec3 vPos;')
          .replace('#include <dithering_fragment>', `#include <dithering_fragment>
            float d = length(vPos.xz);
            float edge = smoothstep(uReveal*140.0, uReveal*140.0 - 12.0, d);
            // tinte digital que se desvanece con el revelado
            float dig = clamp(1.0 - uReveal*1.4, 0.0, 1.0);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uDigital, dig * 0.25);
            gl_FragColor.a *= edge;
          `);
      };
      mat.transparent = true;

      const ground = new THREE.Mesh(geo, mat);
      ground.receiveShadow = E.QCONF.shadows;
      ground.position.y = E.TERRAIN_BASE; // desplazamos el mesh; la fórmula ya lo contempla
      E.scene.add(ground);
      this.ground = ground;
    },

    update(dt, growth) {
      if (this.matUniforms) {
        this.matUniforms.uReveal.value = Math.min(1, growth * 1.3);
        this.matUniforms.uTime.value += dt;
      }
    }
  };
})();

/* ============================================================
   MÓDULO: CÓDIGO BINARIO / PARTÍCULAS DIGITALES
   Puntos 0/1 azul-morado que caen y se transforman en el campo.
   ============================================================ */
(function () {
  const E = window.__EXP__;

  E.MODULES.code = {
    points: null,
    geo: null,
    mat: null,
    count: 0,
    data: [],

    makeGlyphTexture() {
      // Textura atlas simple: mitad izquierda "0", mitad derecha "1"
      const c = document.createElement('canvas');
      c.width = 128; c.height = 64;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, 128, 64);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 48px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('0', 32, 34);
      ctx.fillText('1', 96, 34);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    },

    build() {
      const n = E.QCONF.codeParticles;
      this.count = n;
      const field = E.QCONF.field;

      const positions = new Float32Array(n * 3);
      const colors = new Float32Array(n * 3);
      const glyph = new Float32Array(n);      // 0 o 1 (para elegir mitad del atlas)
      const rnd = new Float32Array(n);

      const blue = new THREE.Color(0x4d7bff);
      const purple = new THREE.Color(0xa25bff);

      this.data = new Array(n);
      for (let i = 0; i < n; i++) {
        const x = (Math.random() - 0.5) * field * 1.6;
        const z = (Math.random() - 0.5) * field * 1.6;
        const startY = 30 + Math.random() * 60; // arriba
        positions[i * 3] = x;
        positions[i * 3 + 1] = startY;
        positions[i * 3 + 2] = z;

        const col = Math.random() > 0.5 ? blue : purple;
        colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
        glyph[i] = Math.random() > 0.5 ? 1 : 0;
        rnd[i] = Math.random();

        this.data[i] = {
          x, z,
          startY,
          groundY: 0.05 + Math.random() * 0.1,
          fallOrder: Math.random(),      // cuándo empieza a caer
          speed: 6 + Math.random() * 10
        };
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.setAttribute('aGlyph', new THREE.BufferAttribute(glyph, 1));
      geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));

      const tex = this.makeGlyphTexture();
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTex: { value: tex },
          uSize: { value: (E.QUALITY === 'low' ? 34 : 46) * E.QCONF.pixelRatio },
          uOpacity: { value: 1.0 }
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        vertexShader: `
          attribute float aGlyph;
          attribute float aRnd;
          uniform float uSize;
          varying vec3 vColor;
          varying float vGlyph;
          varying float vAlpha;
          void main() {
            vColor = color;
            vGlyph = aGlyph;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = uSize / max(-mv.z, 1.0);
            // se atenúan al llegar al suelo
            vAlpha = smoothstep(0.0, 2.0, position.y);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          uniform sampler2D uTex;
          uniform float uOpacity;
          varying vec3 vColor;
          varying float vGlyph;
          varying float vAlpha;
          void main() {
            vec2 uv = gl_PointCoord;
            // elegir mitad del atlas segun glyph
            uv.x = uv.x * 0.5 + vGlyph * 0.5;
            vec4 t = texture2D(uTex, uv);
            float a = t.a * uOpacity * (0.35 + 0.65 * vAlpha);
            if (a < 0.02) discard;
            gl_FragColor = vec4(vColor, a);
          }`
      });

      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      E.scene.add(points);
      this.points = points;
      this.geo = geo;
      this.mat = mat;
    },

    // growth 0..1: las partículas caen progresivamente y luego se desvanecen
    update(dt, growth) {
      if (!this.geo) return;
      const pos = this.geo.attributes.position;
      const arr = pos.array;
      for (let i = 0; i < this.count; i++) {
        const d = this.data[i];
        // cada partícula empieza a caer cuando growth supera su fallOrder
        const local = THREE.MathUtils.clamp((growth - d.fallOrder * 0.6) / 0.4, 0, 1);
        const targetY = d.groundY;
        const y = THREE.MathUtils.lerp(d.startY, targetY, easeInOut(local));
        arr[i * 3 + 1] = y;
      }
      pos.needsUpdate = true;

      // A medida que el campo florece, casi todo el código desaparece.
      // Queda un pequeño remanente flotando.
      const fade = THREE.MathUtils.clamp(1 - (growth - 0.55) / 0.35, 0.06, 1);
      this.mat.uniforms.uOpacity.value = fade;
    }
  };

  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
})();

/* ============================================================
   MÓDULO: FLORES (InstancedMesh)
   Cada flor = grupo lógico de instancias: tallo, hojas, pétalos, centro.
   Distribución: campo disperso + una forma de corazón sutil.
   Variación por instancia (tamaño, rotación, inclinación, apertura).
   Viento por shader. Crecimiento progresivo por growth.
   ============================================================ */
(function () {
  const E = window.__EXP__;
  const tmpObj = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  E.MODULES.flowers = {
    count: 0,
    flowers: [],        // metadata por flor
    meshes: {},         // instancedMesh por parte
    windUniforms: [],   // uniforms de viento compartidos

    // -------- construir geometrías reutilizables --------
    // Pétalo curvo tipo cuchara: base estrecha, cuerpo ancho, punta redondeada,
    // y ligeramente cóncavo (curvado hacia arriba) para parecer un pétalo real.
    makePetalGeometry(quality) {
      const segU = quality === 'low' ? 5 : 8;   // a lo ancho
      const segV = quality === 'low' ? 6 : 10;  // a lo largo
      const geo = new THREE.PlaneGeometry(1, 1, segU, segV);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i);       // -0.5..0.5
        let y = pos.getY(i);       // -0.5..0.5 (a lo largo)
        const v = y + 0.5;         // 0 (base) .. 1 (punta)
        // ancho del pétalo: estrecho en la base, ancho al medio, punta fina
        const width = Math.sin(Math.min(v, 1.0) * Math.PI) * 0.55 + 0.12 * v;
        const nx = x * width;
        // curvatura cóncava (el pétalo se ahueca hacia arriba)
        const cup = -(nx * nx) * 1.6 + (v * v) * 0.18;
        // el pétalo se curva hacia atrás en la punta
        const bend = v * v * 0.28;
        pos.setX(i, nx);
        pos.setZ(i, cup + bend);
        pos.setY(i, v);            // reubicar de 0..1 a lo largo del eje Y local
      }
      geo.computeVertexNormals();
      geo.translate(0, 0, 0);
      return geo;
    },

    // Domo del centro con pequeño relieve granulado
    makeCenterGeometry(quality) {
      const seg = quality === 'low' ? 10 : 16;
      const geo = new THREE.SphereGeometry(0.24, seg, seg, 0, Math.PI * 2, 0, Math.PI * 0.55);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        // relieve tipo semillas
        const bump = (Math.sin(x * 40) * Math.cos(z * 40)) * 0.006;
        const len = Math.sqrt(x * x + y * y + z * z) || 1;
        pos.setX(i, x + (x / len) * bump);
        pos.setY(i, y + (y / len) * bump);
        pos.setZ(i, z + (z / len) * bump);
      }
      geo.scale(1, 0.75, 1);
      geo.computeVertexNormals();
      return geo;
    },

    // Hoja lanceolada, ligeramente curvada
    makeLeafGeometry(quality) {
      const segV = quality === 'low' ? 4 : 7;
      const geo = new THREE.PlaneGeometry(1, 1, 3, segV);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const v = y + 0.5;
        const width = Math.sin(v * Math.PI) * 0.5;
        const nx = x * width;
        const droop = -(v * v) * 0.22;          // la hoja cae un poco
        const fold = -(nx * nx) * 1.2;           // pliegue central
        pos.setX(i, nx);
        pos.setY(i, v);
        pos.setZ(i, droop + fold);
      }
      geo.computeVertexNormals();
      return geo;
    },

    buildGeometries() {
      const q = E.QUALITY;
      const petal = this.makePetalGeometry(q);
      const center = this.makeCenterGeometry(q);
      const stem = new THREE.CylinderGeometry(0.035, 0.06, 1, q === 'low' ? 5 : 7, 1, true);
      stem.translate(0, 0.5, 0);
      const leaf = this.makeLeafGeometry(q);
      return { petal, center, stem, leaf };
    },

    // material con viento inyectado
    makeWindMaterial(baseColor, opts) {
      opts = opts || {};
      const mat = new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: opts.roughness != null ? opts.roughness : 0.7,
        metalness: 0.0,
        emissive: opts.emissive || 0x000000,
        emissiveIntensity: opts.emissiveIntensity || 0
      });
      const u = {
        uTime: { value: 0 },
        uWind: { value: 1.0 },
        uGrow: { value: 0 },
        uSelected: { value: -1 }
      };
      this.windUniforms.push(u);
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = u.uTime;
        shader.uniforms.uWind = u.uWind;
        shader.uniforms.uGrow = u.uGrow;
        shader.uniforms.uSelected = u.uSelected;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>
            uniform float uTime;
            uniform float uWind;
            uniform float uGrow;
            attribute float aPhase;
            attribute float aOrder;
            attribute float aFlowerId;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            // crecimiento: escala vertical desde el suelo segun growth y orden de la flor
            float g = clamp((uGrow - aOrder*0.8) / 0.25, 0.0, 1.0);
            g = g*g*(3.0-2.0*g);
            transformed *= max(g, 0.0001);
            // viento: desplazamiento lateral mayor con la altura
            float h = max(transformed.y, 0.0);
            float sway = sin(uTime*1.3 + aPhase*6.28 + position.x*0.5) * 0.09
                       + sin(uTime*0.6 + aPhase*3.0) * 0.05;
            transformed.x += sway * h * uWind;
            transformed.z += cos(uTime*1.1 + aPhase*5.0) * 0.06 * h * uWind;`);
      };
      mat.transparent = false;
      return mat;
    },

    // material especializado para pétalos: viento + degradado + nervaduras + translucidez
    makePetalMaterial() {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,       // el color real llega por instanceColor
        roughness: 0.5,
        metalness: 0.0,
        side: THREE.DoubleSide,
        emissive: 0xffcc00,        // brillo amarillo propio -> color vivo aunque haya poca luz
        emissiveIntensity: 0.35
      });
      const u = {
        uTime: { value: 0 },
        uWind: { value: 1.0 },
        uGrow: { value: 0 },
        uSelected: { value: -1 }
      };
      this.windUniforms.push(u);
      this.petalUniforms = u;

      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = u.uTime;
        shader.uniforms.uWind = u.uWind;
        shader.uniforms.uGrow = u.uGrow;

        // ---- vertex: viento + crecimiento + pasar coords locales del pétalo ----
        // Solo usamos 'position' y atributos propios (compatible con todos los móviles).
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>
            uniform float uTime;
            uniform float uWind;
            uniform float uGrow;
            attribute float aPhase;
            attribute float aOrder;
            attribute float aFlowerId;
            varying vec2 vPetal;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            vPetal = vec2(position.x, position.y);
            float g = clamp((uGrow - aOrder * 0.8) / 0.25, 0.0, 1.0);
            g = g * g * (3.0 - 2.0 * g);
            transformed *= max(g, 0.0001);
            float h = max(transformed.y, 0.0);
            float sway = sin(uTime * 1.3 + aPhase * 6.28 + position.x * 0.5) * 0.09
                       + sin(uTime * 0.6 + aPhase * 3.0) * 0.05;
            transformed.x += sway * h * uWind;
            transformed.z += cos(uTime * 1.1 + aPhase * 5.0) * 0.06 * h * uWind;`);

        // ---- fragment: degradado base->punta + nervadura + brillo trasero ----
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>
            varying vec2 vPetal;`)
          .replace('#include <color_fragment>', `#include <color_fragment>
            float along = clamp(vPetal.y, 0.0, 1.0);
            float across = abs(vPetal.x);
            // amarillo MUY vivo y saturado; la base tira a dorado, la punta a amarillo pleno
            vec3 baseYellow = diffuseColor.rgb;
            vec3 warm = baseYellow * vec3(1.0, 0.85, 0.05);   // dorado intenso en la base
            diffuseColor.rgb = mix(warm, baseYellow, smoothstep(0.0, 0.6, along));
            // nervadura central sutil
            float mid = smoothstep(0.05, 0.0, across);
            diffuseColor.rgb += mid * 0.05;
            // brillo posterior cuando la luz cruza el pétalo
            if (!gl_FrontFacing) {
              diffuseColor.rgb += vec3(1.0, 0.8, 0.15) * 0.25 * clamp(along + 0.2, 0.0, 1.0);
            }`);
      };
      mat.transparent = false;
      return mat;
    },

    // -------- distribución en forma de corazón --------
    // Devuelve true si el punto (x,z) cae dentro del corazón (en el plano del campo)
    heartMask(x, z, scale) {
      // Ecuación de corazón: normalizamos
      const nx = x / scale;
      const ny = z / scale;
      // (x^2 + y^2 - 1)^3 - x^2 y^3 <= 0
      const a = nx * nx + ny * ny - 1;
      return (a * a * a - nx * nx * ny * ny * ny) <= 0;
    },

    build() {
      const n = E.QCONF.flowers;
      this.count = n;
      const field = E.QCONF.field;
      const geos = this.buildGeometries();

      // tres anillos de pétalos para una corola llena y romántica
      const RING_COUNTS = E.QUALITY === 'low'
        ? [7, 6, 5]
        : [10, 8, 6];
      const PETALS_OUTER = RING_COUNTS[0];
      const PETALS_INNER = RING_COUNTS[1];
      const PETALS_CORE = RING_COUNTS[2];
      const PETALS = PETALS_OUTER + PETALS_INNER + PETALS_CORE;

      // Material de pétalo con degradado + nervaduras + translucidez
      const petalMat = this.makePetalMaterial();
      const centerMat = this.makeWindMaterial(0xfbf7ec, { roughness: 0.6, emissive: 0x4a4636, emissiveIntensity: 0.12 });
      const stemMat = this.makeWindMaterial(0x3f8a2e, { roughness: 0.85 });
      const leafMat = this.makeWindMaterial(0x4fa337, { roughness: 0.8 });
      leafMat.side = THREE.DoubleSide;

      // InstancedMeshes
      const petalMesh = new THREE.InstancedMesh(geos.petal, petalMat, n * PETALS);
      const centerMesh = new THREE.InstancedMesh(geos.center, centerMat, n);
      const stemMesh = new THREE.InstancedMesh(geos.stem, stemMat, n);
      const leafMesh = new THREE.InstancedMesh(geos.leaf, leafMat, n * 2);

      [petalMesh, centerMesh, stemMesh, leafMesh].forEach(m => {
        m.castShadow = E.QCONF.shadows;
        m.frustumCulled = false;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      });

      // atributos por-instancia para el shader de viento
      const setupAttribs = (mesh, per) => {
        const total = n * per;
        const phase = new Float32Array(total);
        const order = new Float32Array(total);
        const fid = new Float32Array(total);
        mesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
        mesh.geometry.setAttribute('aOrder', new THREE.InstancedBufferAttribute(order, 1));
        mesh.geometry.setAttribute('aFlowerId', new THREE.InstancedBufferAttribute(fid, 1));
        return { phase, order, fid };
      };
      const aPetal = setupAttribs(petalMesh, PETALS);
      const aCenter = setupAttribs(centerMesh, 1);
      const aStem = setupAttribs(stemMesh, 1);
      const aLeaf = setupAttribs(leafMesh, 2);

      const heartScale = field * 0.42;
      const halfField = field;

      let placed = 0;
      let guard = 0;
      // ~35% de las flores refuerzan la forma de corazón (más densas ahí)
      const heartQuota = Math.floor(n * 0.4);
      let heartPlaced = 0;

      this.flowers = new Array(n);

      while (placed < n && guard < n * 40) {
        guard++;
        let x, z, inHeart;
        if (heartPlaced < heartQuota) {
          // muestrear dentro del corazón
          x = (Math.random() - 0.5) * heartScale * 2.4;
          // el corazón "apunta" hacia +z; invertimos z para que la punta mire al frente
          const zz = (Math.random() - 0.5) * heartScale * 2.4;
          inHeart = this.heartMask(x, -zz, heartScale);
          z = zz;
          if (!inHeart) continue;
          heartPlaced++;
        } else {
          x = (Math.random() - 0.5) * halfField * 1.8;
          z = (Math.random() - 0.5) * halfField * 1.8;
          inHeart = false;
        }

        const i = placed;
        const scale = 0.7 + Math.random() * 0.7;
        const rotY = Math.random() * Math.PI * 2;
        const tilt = (Math.random() - 0.5) * 0.3;
        const stemH = (1.3 + Math.random() * 1.1) * scale;
        const openness = 0.6 + Math.random() * 0.5; // apertura de pétalos
        const phase = Math.random();
        const order = Math.random();
        const groundY = groundHeight(x, z);
        const goldTint = Math.random();

        this.flowers[i] = {
          x, z, groundY, scale, rotY, tilt, stemH, openness, phase, order, inHeart,
          headY: groundY + stemH
        };

        // ---- llenar matrices ----
        // Tallo
        writeStem(stemMesh, i, this.flowers[i]);
        aStem.phase[i] = phase; aStem.order[i] = order; aStem.fid[i] = i;

        // Centro
        writeCenter(centerMesh, i, this.flowers[i]);
        aCenter.phase[i] = phase; aCenter.order[i] = order + 0.02; aCenter.fid[i] = i;

        // Pétalos: tres anillos (externo, medio, núcleo)
        // tono base de la flor: amarillo vivo y saturado
        const baseHue = goldTint > 0.5 ? 0xffe000 : 0xffd400;
        const ringTotals = [PETALS_OUTER, PETALS_INNER, PETALS_CORE];
        let ringStart = 0;
        for (let ring = 0; ring < 3; ring++) {
          const total = ringTotals[ring];
          const startP = ringStart;
          ringStart += total;
          for (let p = 0; p < total; p++) {
            const idx = i * PETALS + startP + p;
            writePetal(petalMesh, idx, this.flowers[i], p, total, ring);
            aPetal.phase[idx] = phase; aPetal.order[idx] = order + 0.03 + ring * 0.01; aPetal.fid[idx] = i;
            // anillos internos progresivamente más cálidos/dorados
            tmpColor.set(baseHue);
            if (ring === 1) tmpColor.lerp(new THREE.Color(0xffc400), 0.4);
            if (ring === 2) tmpColor.lerp(new THREE.Color(0xffb300), 0.5);
            // pequeña variación por pétalo
            tmpColor.offsetHSL(0, 0, (Math.random() - 0.5) * 0.05);
            petalMesh.setColorAt(idx, tmpColor);
          }
        }

        // Hojas (2)
        for (let l = 0; l < 2; l++) {
          const idx = i * 2 + l;
          writeLeaf(leafMesh, idx, this.flowers[i], l);
          aLeaf.phase[idx] = phase; aLeaf.order[idx] = order + 0.01; aLeaf.fid[idx] = i;
        }

        placed++;
      }

      // si quedaron instancias sin usar (guard), rellenarlas fuera de vista
      for (let i = placed; i < n; i++) {
        this.flowers[i] = { x: 0, z: 0, groundY: -999, scale: 0.001, rotY: 0, tilt: 0, stemH: 0.001, openness: 0, phase: 0, order: 2, headY: -999 };
        tmpObj.position.set(0, -999, 0); tmpObj.scale.set(0.0001, 0.0001, 0.0001); tmpObj.updateMatrix();
        stemMesh.setMatrixAt(i, tmpObj.matrix);
        centerMesh.setMatrixAt(i, tmpObj.matrix);
        for (let p = 0; p < PETALS; p++) petalMesh.setMatrixAt(i * PETALS + p, tmpObj.matrix);
        for (let l = 0; l < 2; l++) leafMesh.setMatrixAt(i * 2 + l, tmpObj.matrix);
      }

      petalMesh.instanceMatrix.needsUpdate = true;
      centerMesh.instanceMatrix.needsUpdate = true;
      stemMesh.instanceMatrix.needsUpdate = true;
      leafMesh.instanceMatrix.needsUpdate = true;
      if (petalMesh.instanceColor) petalMesh.instanceColor.needsUpdate = true;

      E.scene.add(petalMesh, centerMesh, stemMesh, leafMesh);
      this.meshes = { petal: petalMesh, center: centerMesh, stem: stemMesh, leaf: leafMesh };
      this.PETALS = PETALS;
    },

    update(dt, growth) {
      for (const u of this.windUniforms) {
        u.uTime.value += dt;
        u.uGrow.value = growth;
      }
      // animación de la flor seleccionada (brillo pulsante)
      if (E.STATE.selectedFlower >= 0) {
        const c = this.meshes.center;
        // pulso con emisivo del material central
        c.material.emissiveIntensity = 0.35 + Math.sin(E.STATE.time * 4) * 0.25;
      }
    },

    setWind(v) { for (const u of this.windUniforms) u.uWind.value = v; }
  };

  // ---------- helpers de escritura de matrices ----------
  function writeStem(mesh, i, f) {
    tmpObj.position.set(f.x, f.groundY, f.z);
    tmpObj.rotation.set(f.tilt, f.rotY, f.tilt * 0.5);
    tmpObj.scale.set(f.scale, f.stemH, f.scale);
    tmpObj.updateMatrix();
    mesh.setMatrixAt(i, tmpObj.matrix);
  }
  function headPosition(f) {
    // ápice del tallo (donde se posa la flor), teniendo en cuenta la inclinación
    return {
      x: f.x + Math.sin(f.tilt) * f.stemH * 0.5,
      y: f.groundY + f.stemH,
      z: f.z
    };
  }

  function writeCenter(mesh, i, f) {
    const hp = headPosition(f);
    tmpObj.position.set(hp.x, hp.y, hp.z);
    tmpObj.rotation.set(f.tilt, f.rotY, 0);
    tmpObj.scale.setScalar(f.scale * 0.95);
    tmpObj.updateMatrix();
    mesh.setMatrixAt(i, tmpObj.matrix);
  }

  // p = índice del pétalo en su anillo; total = pétalos por anillo; layer = 0 externo / 1 medio / 2 núcleo
  function writePetal(mesh, idx, f, p, total, layer) {
    const hp = headPosition(f);
    // ángulo alrededor del centro; cada anillo va desfasado para tapar huecos
    const ang = (p / total) * Math.PI * 2 + layer * (Math.PI / total);

    // apertura por anillo: externo muy abierto, medio a media, núcleo casi erguido
    const openFactor = layer === 0 ? 1.0 : layer === 1 ? 0.6 : 0.3;
    const openBase = f.openness * openFactor;
    // rango de inclinación desde la vertical (radianes)
    const openAngle = THREE.MathUtils.lerp(0.12, 1.2, openBase);

    // tamaños escalonados: externo grande, núcleo pequeño
    const lenByRing = layer === 0 ? 0.9 : layer === 1 ? 0.66 : 0.44;
    const widByRing = layer === 0 ? 1.0 : layer === 1 ? 0.82 : 0.62;
    const petalLen = f.scale * lenByRing;
    const petalWid = f.scale * widByRing;

    // Construir orientación:
    //  - la geometría base va de y=0 (base) a y=1 (punta), cara hacia +Z
    //  - la inclinamos hacia atrás (abrir) rotando en X
    //  - la giramos alrededor del eje vertical (Y) por 'ang'
    const eBase = new THREE.Euler(f.tilt, f.rotY, 0);
    const qFlower = new THREE.Quaternion().setFromEuler(eBase);
    const qSpin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
    // pétalo parte "de pie" (apuntando +Y) y lo abrimos girando en X
    const qOpen = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), openAngle);

    const qFinal = new THREE.Quaternion()
      .multiply(qFlower)
      .multiply(qSpin)
      .multiply(qOpen);

    tmpObj.position.set(hp.x, hp.y, hp.z);
    tmpObj.quaternion.copy(qFinal);
    tmpObj.scale.set(petalWid, petalLen, (petalLen + petalWid) * 0.5);
    tmpObj.updateMatrix();
    mesh.setMatrixAt(idx, tmpObj.matrix);
  }

  function writeLeaf(mesh, idx, f, l) {
    const h = f.groundY + f.stemH * (0.28 + l * 0.26);
    // las hojas nacen del tallo en lados opuestos, apuntando hacia afuera y abajo
    const side = l ? Math.PI : 0;
    const eBase = new THREE.Euler(0, f.rotY + side + 0.5, 0);
    const qFlower = new THREE.Quaternion().setFromEuler(eBase);
    const qOut = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.15); // casi horizontal, cayendo
    const qFinal = new THREE.Quaternion().multiply(qFlower).multiply(qOut);

    tmpObj.position.set(f.x, h, f.z);
    tmpObj.quaternion.copy(qFinal);
    const s = f.scale * (0.85 + l * 0.2);
    tmpObj.scale.set(s * 0.9, s * 1.3, s);
    tmpObj.updateMatrix();
    mesh.setMatrixAt(idx, tmpObj.matrix);
  }

  // altura del terreno en (x,z) — delega en la fórmula compartida
  function groundHeight(x, z) {
    return E.groundHeight(x, z);
  }
  E.MODULES.flowers.groundHeight = groundHeight;
})();

/* ============================================================
   MÓDULO: DETALLES DEL CAMPO (pasto + piedritas) — InstancedMesh
   Comparten el crecimiento (aparecen con el campo) y el viento del pasto.
   ============================================================ */
(function () {
  const E = window.__EXP__;
  const tmp = new THREE.Object3D();
  const col = new THREE.Color();

  E.MODULES.scatter = {
    grassMesh: null,
    rockMesh: null,
    windU: null,

    buildGrass() {
      const n = E.QCONF.grass;
      const field = E.QCONF.field;

      // brizna: triángulo alargado (2 caras) muy barato
      const blade = new THREE.PlaneGeometry(0.09, 1, 1, 3);
      // afinar hacia la punta
      const p = blade.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);       // -0.5..0.5
        const v = y + 0.5;         // 0..1
        p.setX(i, p.getX(i) * (1 - v * 0.85));
        p.setY(i, v);              // base en 0, punta en 1
      }
      blade.computeVertexNormals();

      const mat = new THREE.MeshStandardMaterial({
        color: 0x5aa83c, roughness: 0.9, metalness: 0, side: THREE.DoubleSide
      });
      // viento propio del pasto (reutiliza patrón de las flores)
      const u = { uTime: { value: 0 }, uWind: { value: 1 }, uGrow: { value: 0 } };
      this.windU = u;
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = u.uTime;
        shader.uniforms.uWind = u.uWind;
        shader.uniforms.uGrow = u.uGrow;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>
            uniform float uTime; uniform float uWind; uniform float uGrow;
            attribute float aPhase; attribute float aOrder;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            float g = clamp((uGrow - aOrder*0.7) / 0.3, 0.0, 1.0);
            transformed *= max(g, 0.0001);
            float h = max(transformed.y, 0.0);
            float sway = sin(uTime*1.6 + aPhase*6.28) * 0.12 + sin(uTime*0.7 + aPhase*3.0)*0.06;
            transformed.x += sway * h * uWind;
            transformed.z += cos(uTime*1.2 + aPhase*4.0) * 0.05 * h * uWind;`);
      };

      const mesh = new THREE.InstancedMesh(blade, mat, n);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;

      const phase = new Float32Array(n);
      const order = new Float32Array(n);
      mesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
      mesh.geometry.setAttribute('aOrder', new THREE.InstancedBufferAttribute(order, 1));

      for (let i = 0; i < n; i++) {
        const x = (Math.random() - 0.5) * field * 1.9;
        const z = (Math.random() - 0.5) * field * 1.9;
        const y = E.groundHeight(x, z);
        const h = 0.4 + Math.random() * 0.7;
        const w = 0.8 + Math.random() * 0.6;
        tmp.position.set(x, y, z);
        tmp.rotation.set(0, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.2);
        tmp.scale.set(w, h, 1);
        tmp.updateMatrix();
        mesh.setMatrixAt(i, tmp.matrix);
        // variación de verde
        col.setHSL(0.28 + Math.random() * 0.05, 0.5 + Math.random() * 0.15, 0.32 + Math.random() * 0.12);
        mesh.setColorAt(i, col);
        phase[i] = Math.random();
        order[i] = Math.random();
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      E.scene.add(mesh);
      this.grassMesh = mesh;
    },

    buildRocks() {
      const n = E.QCONF.rocks;
      const field = E.QCONF.field;
      // roca base: icosaedro deformado (una geometría, muchas instancias)
      const geo = new THREE.IcosahedronGeometry(0.5, 0);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        p.setXYZ(i,
          p.getX(i) * (0.7 + Math.random() * 0.5),
          p.getY(i) * (0.5 + Math.random() * 0.4),
          p.getZ(i) * (0.7 + Math.random() * 0.5));
      }
      geo.computeVertexNormals();

      const mat = new THREE.MeshStandardMaterial({ color: 0x9a938a, roughness: 1, metalness: 0 });
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.frustumCulled = false;
      mesh.castShadow = E.QCONF.shadows;
      mesh.receiveShadow = E.QCONF.shadows;

      for (let i = 0; i < n; i++) {
        const x = (Math.random() - 0.5) * field * 1.9;
        const z = (Math.random() - 0.5) * field * 1.9;
        const y = E.groundHeight(x, z);
        const s = 0.12 + Math.random() * 0.28;
        tmp.position.set(x, y + s * 0.25, z);
        tmp.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        tmp.scale.set(s * (0.8 + Math.random() * 0.6), s * (0.6 + Math.random() * 0.5), s * (0.8 + Math.random() * 0.6));
        tmp.updateMatrix();
        mesh.setMatrixAt(i, tmp.matrix);
        // tonos de gris/marrón
        const g = 0.5 + Math.random() * 0.25;
        col.setRGB(g, g * (0.9 + Math.random() * 0.1), g * (0.82 + Math.random() * 0.12));
        mesh.setColorAt(i, col);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      E.scene.add(mesh);
      this.rockMesh = mesh;
    },

    build() {
      this.buildGrass();
      this.buildRocks();
    },

    update(dt, growth) {
      if (this.windU) {
        this.windU.uTime.value += dt;
        this.windU.uGrow.value = growth;
      }
    },

    setWind(v) { if (this.windU) this.windU.uWind.value = v; }
  };
})();

/* ============================================================
   MÓDULO: CARTEL 3D
   Un letrero de madera en el campo. Al tocarlo, muestra un mensaje.
   ============================================================ */
(function () {
  const E = window.__EXP__;

  E.MODULES.sign = {
    group: null,
    board: null,     // malla del tablero (objeto que se detecta al tocar)
    pos: new THREE.Vector3(),

    makeBoardTexture() {
      const c = document.createElement('canvas');
      c.width = 512; c.height = 320;
      const ctx = c.getContext('2d');
      // fondo madera clara con vetas
      const grd = ctx.createLinearGradient(0, 0, 0, 320);
      grd.addColorStop(0, '#c8894e');
      grd.addColorStop(0.5, '#b9773e');
      grd.addColorStop(1, '#a9662f');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 512, 320);
      // vetas
      ctx.strokeStyle = 'rgba(90,50,20,0.25)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 14; i++) {
        ctx.beginPath();
        const y = 20 + i * 22 + (Math.random() * 6 - 3);
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(160, y + 8, 340, y - 8, 512, y + 4);
        ctx.stroke();
      }
      // marco
      ctx.strokeStyle = 'rgba(60,30,10,0.6)';
      ctx.lineWidth = 10;
      ctx.strokeRect(8, 8, 496, 304);
      // texto grabado
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#3b2410';
      ctx.font = 'bold 46px Georgia, serif';
      ctx.fillText('Para Gina', 256, 120);
      ctx.font = '30px Georgia, serif';
      ctx.fillText('Marcela 🌼', 256, 172);
      ctx.font = 'italic 22px Georgia, serif';
      ctx.fillStyle = '#5a3818';
      ctx.fillText('toca aquí 💛', 256, 232);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      return tex;
    },

    build() {
      const g = new THREE.Group();

      const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a4a24, roughness: 0.9 });

      // dos postes
      const postGeo = new THREE.CylinderGeometry(0.09, 0.11, 2.4, 8);
      const post1 = new THREE.Mesh(postGeo, woodMat);
      post1.position.set(-0.95, 1.2, 0);
      const post2 = new THREE.Mesh(postGeo, woodMat);
      post2.position.set(0.95, 1.2, 0);
      g.add(post1, post2);

      // tablero
      const boardTex = this.makeBoardTexture();
      const boardMat = new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.8 });
      const edgeMat = new THREE.MeshStandardMaterial({ color: 0x8a5628, roughness: 0.9 });
      const boardGeo = new THREE.BoxGeometry(2.6, 1.6, 0.12);
      // materiales por cara: la cara frontal (índice 4) lleva la textura
      const mats = [edgeMat, edgeMat, edgeMat, edgeMat, boardMat, boardMat];
      const board = new THREE.Mesh(boardGeo, mats);
      board.position.set(0, 2.15, 0);
      g.add(board);

      [post1, post2, board].forEach(m => { m.castShadow = E.QCONF.shadows; });

      // ubicación en el campo: al frente, hacia la punta del corazón, visible
      const field = E.QCONF.field;
      const sx = field * 0.16;
      const sz = field * 0.30;
      const gy = E.groundHeight(sx, sz);
      g.position.set(sx, gy, sz);
      g.rotation.y = -0.5; // que mire un poco hacia el centro
      g.scale.setScalar(1.25);

      E.scene.add(g);
      this.group = g;
      this.board = board;
      board.userData.isSign = true;
      // guardar posición del tablero para acercar la cámara
      board.getWorldPosition(this.pos);
    }
  };
})();

/* ============================================================
   MÓDULO: CONTROLES DE CÁMARA (orbit táctil + pinch + límites)
   Implementación propia orientada a móvil (equivalente a OrbitControls).
   Coordenadas esféricas alrededor de un "target".
   ============================================================ */
(function () {
  const E = window.__EXP__;

  const controls = {
    enabled: false,
    target: new THREE.Vector3(0, 1.5, 0),
    // esféricas
    radius: 14,
    minRadius: 3,
    maxRadius: 46,
    theta: 0,          // azimut
    phi: Math.PI * 0.42, // polar (desde eje Y)
    minPhi: 0.25,
    maxPhi: Math.PI * 0.49, // no bajar de la horizontal (no atravesar el suelo)
    // objetivos suavizados
    tRadius: 14,
    tTheta: 0,
    tPhi: Math.PI * 0.42,
    tTarget: new THREE.Vector3(0, 1.5, 0),
    damping: 0.12,
    rotateSpeed: 0.006,
    // estado de arrastre
    dragging: false,
    pinching: false,
    lastX: 0, lastY: 0,
    lastDist: 0,
    moved: 0,
    // control externo (cinemática) — cuando true, no aplicar esféricas
    external: true,

    init() {
      const c = E.canvas;
      c.addEventListener('touchstart', this.onTouchStart, { passive: false });
      c.addEventListener('touchmove', this.onTouchMove, { passive: false });
      c.addEventListener('touchend', this.onTouchEnd, { passive: false });
      // Ratón (secundario, PC)
      c.addEventListener('mousedown', this.onMouseDown);
      window.addEventListener('mousemove', this.onMouseMove);
      window.addEventListener('mouseup', this.onMouseUp);
      c.addEventListener('wheel', this.onWheel, { passive: false });
    },

    // ---- touch ----
    onTouchStart: (e) => {
      if (!controls.enabled) return;
      e.preventDefault();
      controls.moved = 0;
      if (e.touches.length === 1) {
        controls.dragging = true;
        controls.pinching = false;
        controls.lastX = e.touches[0].clientX;
        controls.lastY = e.touches[0].clientY;
        controls._tapStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now() };
      } else if (e.touches.length === 2) {
        controls.pinching = true;
        controls.dragging = false;
        controls.lastDist = controls.touchDist(e);
      }
    },
    onTouchMove: (e) => {
      if (!controls.enabled) return;
      e.preventDefault();
      if (controls.pinching && e.touches.length === 2) {
        const d = controls.touchDist(e);
        const delta = d - controls.lastDist;
        controls.tRadius = THREE.MathUtils.clamp(
          controls.tRadius - delta * 0.05, controls.minRadius, controls.maxRadius
        );
        controls.lastDist = d;
      } else if (controls.dragging && e.touches.length === 1) {
        const x = e.touches[0].clientX;
        const y = e.touches[0].clientY;
        const dx = x - controls.lastX;
        const dy = y - controls.lastY;
        controls.moved += Math.abs(dx) + Math.abs(dy);
        controls.applyRotate(dx, dy);
        controls.lastX = x;
        controls.lastY = y;
      }
    },
    onTouchEnd: (e) => {
      if (!controls.enabled) return;
      // detectar tap (selección de flor)
      if (controls._tapStart && controls.moved < 12 && e.touches.length === 0) {
        const dt = performance.now() - controls._tapStart.t;
        if (dt < 350) {
          E.MODULES.interaction.tryPick(controls._tapStart.x, controls._tapStart.y);
        }
      }
      controls.dragging = false;
      controls.pinching = false;
      controls._tapStart = null;
    },
    touchDist(e) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      return Math.hypot(dx, dy);
    },

    // ---- ratón ----
    onMouseDown: (e) => {
      if (!controls.enabled) return;
      controls.dragging = true;
      controls.moved = 0;
      controls.lastX = e.clientX; controls.lastY = e.clientY;
      controls._tapStart = { x: e.clientX, y: e.clientY, t: performance.now() };
    },
    onMouseMove: (e) => {
      if (!controls.enabled || !controls.dragging) return;
      const dx = e.clientX - controls.lastX;
      const dy = e.clientY - controls.lastY;
      controls.moved += Math.abs(dx) + Math.abs(dy);
      controls.applyRotate(dx, dy);
      controls.lastX = e.clientX; controls.lastY = e.clientY;
    },
    onMouseUp: (e) => {
      if (!controls.enabled) return;
      if (controls._tapStart && controls.moved < 6) {
        E.MODULES.interaction.tryPick(controls._tapStart.x, controls._tapStart.y);
      }
      controls.dragging = false;
      controls._tapStart = null;
    },
    onWheel: (e) => {
      if (!controls.enabled) return;
      e.preventDefault();
      controls.tRadius = THREE.MathUtils.clamp(
        controls.tRadius + e.deltaY * 0.02, controls.minRadius, controls.maxRadius
      );
    },

    applyRotate(dx, dy) {
      controls.external = false;
      controls.tTheta -= dx * controls.rotateSpeed;
      controls.tPhi = THREE.MathUtils.clamp(
        controls.tPhi - dy * controls.rotateSpeed, controls.minPhi, controls.maxPhi
      );
    },

    // fijar objetivo suave (usado por cinemática y por "vista del campo")
    goTo(target, radius, theta, phi) {
      if (target) controls.tTarget.copy(target);
      if (radius != null) controls.tRadius = THREE.MathUtils.clamp(radius, controls.minRadius, controls.maxRadius);
      if (theta != null) controls.tTheta = theta;
      if (phi != null) controls.tPhi = THREE.MathUtils.clamp(phi, controls.minPhi, controls.maxPhi);
    },

    update() {
      // suavizado
      const k = controls.damping;
      controls.radius += (controls.tRadius - controls.radius) * k;
      controls.theta += (controls.tTheta - controls.theta) * k;
      controls.phi += (controls.tPhi - controls.phi) * k;
      controls.target.lerp(controls.tTarget, k);

      const sinPhi = Math.sin(controls.phi);
      const x = controls.target.x + controls.radius * sinPhi * Math.sin(controls.theta);
      const y = controls.target.y + controls.radius * Math.cos(controls.phi);
      const z = controls.target.z + controls.radius * sinPhi * Math.cos(controls.theta);

      E.camera.position.set(x, Math.max(y, 0.6), z);
      E.camera.lookAt(controls.target);
    }
  };

  E.MODULES.controls = controls;
})();

/* ============================================================
   MÓDULO: INTERACCIÓN (raycast, selección de flor, partículas doradas)
   ============================================================ */
(function () {
  const E = window.__EXP__;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  E.MODULES.interaction = {
    sparkles: null,
    sparkleData: null,

    initSparkles() {
      const N = 60;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(N * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        color: 0xffdf6b, size: 0.28, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
      });
      this.sparkles = new THREE.Points(geo, mat);
      this.sparkles.frustumCulled = false;
      E.scene.add(this.sparkles);
      this.sparkleData = { life: 0, origin: new THREE.Vector3(), vel: [] };
      for (let i = 0; i < N; i++) this.sparkleData.vel.push(new THREE.Vector3());
      this.N = N;
    },

    burst(origin) {
      this.sparkleData.origin.copy(origin);
      this.sparkleData.life = 1;
      const pos = this.sparkles.geometry.attributes.position.array;
      for (let i = 0; i < this.N; i++) {
        const v = this.sparkleData.vel[i];
        v.set((Math.random() - 0.5), Math.random() * 1.2, (Math.random() - 0.5)).multiplyScalar(1.5 + Math.random() * 2);
        pos[i * 3] = origin.x; pos[i * 3 + 1] = origin.y; pos[i * 3 + 2] = origin.z;
      }
      this.sparkles.geometry.attributes.position.needsUpdate = true;
      this.sparkles.material.opacity = 1;
    },

    updateSparkles(dt) {
      if (!this.sparkles || this.sparkleData.life <= 0) return;
      this.sparkleData.life -= dt * 0.8;
      const pos = this.sparkles.geometry.attributes.position.array;
      for (let i = 0; i < this.N; i++) {
        const v = this.sparkleData.vel[i];
        v.y -= dt * 2.2; // gravedad
        pos[i * 3] += v.x * dt;
        pos[i * 3 + 1] += v.y * dt;
        pos[i * 3 + 2] += v.z * dt;
      }
      this.sparkles.geometry.attributes.position.needsUpdate = true;
      this.sparkles.material.opacity = Math.max(0, this.sparkleData.life);
    },

    tryPick(clientX, clientY) {
      if (E.STATE.phase !== 'explore') return;
      const flowers = E.MODULES.flowers;
      if (!flowers.meshes || !flowers.meshes.center) return;

      ndc.x = (clientX / window.innerWidth) * 2 - 1;
      ndc.y = -(clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(ndc, E.camera);
      raycaster.params.Points = { threshold: 0.5 };

      // 1) ¿tocó el cartel? tiene prioridad
      const sign = E.MODULES.sign;
      if (sign && sign.board) {
        const sHit = raycaster.intersectObject(sign.board, false);
        if (sHit.length > 0) {
          this.selectSign();
          return;
        }
      }

      // 2) interceptar contra centros y pétalos (flores)
      const hits = raycaster.intersectObjects([flowers.meshes.center, flowers.meshes.petal], false);
      if (hits.length > 0) {
        const h = hits[0];
        let flowerId = h.instanceId;
        if (h.object === flowers.meshes.petal) flowerId = Math.floor(h.instanceId / flowers.PETALS);
        this.selectFlower(flowerId);
      }
    },

    selectSign() {
      const sign = E.MODULES.sign;
      E.STATE.selectedFlower = -1;
      // acercar la cámara al cartel suavemente
      const ctr = E.MODULES.controls;
      const p = sign.pos;
      ctr.goTo(new THREE.Vector3(p.x, p.y, p.z), 5.5, ctr.theta, Math.PI * 0.44);
      // destellos dorados sobre el cartel
      this.burst(new THREE.Vector3(p.x, p.y + 0.4, p.z));
      // mostrar el mensaje del cartel
      E.show(E.dom.signOverlay);
    },

    selectFlower(id) {
      const flowers = E.MODULES.flowers;
      const f = flowers.flowers[id];
      if (!f || f.headY < -100) return;
      E.STATE.selectedFlower = id;

      const headX = f.x + Math.sin(f.tilt) * f.stemH;
      const headPos = new THREE.Vector3(headX, f.headY, f.z);

      // partículas doradas
      this.burst(headPos);

      // acercar cámara suavemente hacia la flor
      const ctr = E.MODULES.controls;
      ctr.goTo(headPos, 3.2, ctr.theta, Math.PI * 0.42);

      // nota flotante con una frase linda al azar
      this.showSweetNote();
    },

    // frases para Gina (amor, ánimo, agradecimiento, ternura)
    SWEET_NOTES: [
      'Te amo 💛',
      'Eres mi vida',
      'Eres mi mundo',
      'Me haces feliz',
      'Eres mi bendición',
      'Mi corazón es tuyo',
      'Yo soy tuyo',
      'Me encantas',
      'Eres hermosa',
      'Eres maravillosa',
      'Eres increíble',
      'Gracias por existir',
      'Eres mi lugar favorito',
      'Contigo todo es mejor',
      'Eres mi personita 💛',
      'No hay nadie como tú',
      'Eres mi calma',
      'Amo tu sonrisa',
      'Eres mi razón',
      'Te elijo siempre',
      'Eres mi hogar',
      'Mi amor es tuyo',
      'Eres mi todo',
      'Naciste para brillar',
      'Eres mi paz',
      'Amo tu forma de ser',
      'Eres pura luz',
      'Mi vida es mejor contigo',
      'Eres mi milagro',
      'Gracias por tu amor',
      'Eres mi fuerza',
      'Puedes con todo',
      'Estoy orgulloso de ti',
      'Eres valiente',
      'Nunca te rindas',
      'Confío en ti',
      'Eres capaz de todo',
      'Sigue brillando',
      'Eres mi inspiración',
      'Todo va a estar bien',
      'Descansa, yo te cuido',
      'Eres mi tesoro',
      'Amo tus ojos',
      'Eres dulce como ninguna',
      'Eres mi cielo',
      'Contigo aprendí a amar',
      'Eres mi mejor regalo',
      'Gracias por elegirme',
      'Eres mi compañera',
      'Mi lugar seguro eres tú',
      'Eres mi sol 🌻',
      'Amo tu risa',
      'Eres irrepetible',
      'Eres mi para siempre',
      'Mereces el mundo',
      'Eres mi sueño hecho realidad',
      'Te admiro',
      'Eres mi alegría',
      'Gracias por cada día',
      'Eres mi mejor historia'
    ],
    _lastNote: -1,

    showSweetNote() {
      const notes = this.SWEET_NOTES;
      // elegir una distinta a la anterior
      let idx = Math.floor(Math.random() * notes.length);
      if (notes.length > 1 && idx === this._lastNote) {
        idx = (idx + 1) % notes.length;
      }
      this._lastNote = idx;

      const note = E.dom.flowerNote;
      note.textContent = notes[idx];
      E.show(note);
      // reiniciar animación de entrada
      note.style.animation = 'none';
      // forzar reflow para reiniciar la animación CSS
      void note.offsetWidth;
      note.style.animation = 'floatNote 5s ease forwards';

      clearTimeout(this._noteTimer);
      this._noteTimer = setTimeout(() => E.hide(note), 5000);
    }
  };
})();

/* ============================================================
   MÓDULO: DIRECTOR (narrativa + secuencia cinematográfica + loop)
   ============================================================ */
(function () {
  const E = window.__EXP__;
  const D = E.dom;

  const director = {
    running: false,
    seqTime: 0,
    growthTarget: 0,
    windTarget: 1,

    // ---- narrativa: mostrar texto con fundido ----
    _narrTimer: null,
    say(text, holdMs) {
      D.narrativeText.textContent = text;
      E.show(D.narrative);
      D.narrativeText.style.opacity = '0';
      D.narrativeText.style.transform = 'translateY(12px)';
      requestAnimationFrame(() => {
        D.narrativeText.style.opacity = '1';
        D.narrativeText.style.transform = 'translateY(0)';
      });
      clearTimeout(this._narrTimer);
      if (holdMs) {
        this._narrTimer = setTimeout(() => {
          D.narrativeText.style.opacity = '0';
        }, holdMs);
      }
    },
    clearSay() {
      D.narrativeText.style.opacity = '0';
      clearTimeout(this._narrTimer);
      setTimeout(() => E.hide(D.narrative), 1000);
    },

    // ---- iniciar la experiencia (tras botón Comenzar) ----
    start() {
      if (E.STATE.started) return;
      E.STATE.started = true;
      E.STATE.phase = 'building';
      this.running = true;
      this.seqTime = 0;

      // construir el mundo (una sola vez)
      E.MODULES.terrain.build();
      E.MODULES.code.build();
      E.MODULES.flowers.build();
      E.MODULES.scatter.build();
      E.MODULES.sign.build();
      E.MODULES.interaction.initSparkles();

      // cámara arranca cerca del suelo, mirando al horizonte
      const ctr = E.MODULES.controls;
      ctr.external = true;
      ctr.enabled = false;
      E.camera.position.set(0, 1.0, 10);
      E.camera.lookAt(0, 3, 0);

      // amanecer: aclarar cielo + fondo
      this._dawn = 0;
    },

    // ---- guion cinematográfico basado en tiempo ----
    // Devuelve la posición/mirada deseada de la cámara según seqTime
    directCamera(t) {
      const cam = E.camera;
      // Fases de tiempo (segundos)
      // 0-6: código cayendo, cámara baja cerca del suelo
      // 6-14: terreno + primeros tallos, cámara se eleva un poco
      // 14-22: florecen, cámara retrocede
      // 22-28: revelación del campo, cámara panorámica alta
      let camPos = new THREE.Vector3();
      let look = new THREE.Vector3(0, 2, 0);

      if (t < 6) {
        const k = t / 6;
        camPos.set(Math.sin(k * 0.6) * 4, 1.0 + k * 0.8, 9 - k * 1.5);
        look.set(0, 4 - k * 2, -2);
      } else if (t < 14) {
        const k = (t - 6) / 8;
        camPos.set(Math.sin(0.6 + k) * 5, 1.6 + k * 1.2, 7.5 + k * 1.5);
        look.set(0, 1.6, 0);
      } else if (t < 22) {
        const k = (t - 14) / 8;
        camPos.set(Math.sin(1.6 + k * 0.8) * (7 + k * 6), 3 + k * 6, 9 + k * 10);
        look.set(0, 1.4, 0);
      } else {
        const k = Math.min((t - 22) / 6, 1);
        const r = 24 + k * 8;
        const ang = 1.6 + k * 0.5;
        camPos.set(Math.sin(ang) * r, 16 + k * 10, Math.cos(ang) * r);
        look.set(0, 1.2, 0);
      }
      cam.position.lerp(camPos, 0.06);
      // mirar suave
      this._look = this._look || look.clone();
      this._look.lerp(look, 0.06);
      cam.lookAt(this._look);
    },

    // ---- narrativa temporizada durante la secuencia ----
    narrativeCue(t, prevT) {
      const cue = (time, fn) => { if (prevT < time && t >= time) fn(); };
      cue(1.5, () => this.say('Pensé en darte una flor...'));
      cue(8, () => this.say('...pero una sola me pareció muy poco.'));
      cue(15, () => this.say('Así que hice un campo entero para ti. 🌼', 5500));
      cue(23, () => this.clearSay());
      cue(28, () => this.say('Este también es tu día. 💛', 4000));
    },

    // ---- fin de la secuencia: activar exploración ----
    enterExplore() {
      if (E.STATE.phase === 'explore') return;
      E.STATE.phase = 'explore';
      const ctr = E.MODULES.controls;
      ctr.external = false;
      ctr.enabled = true;
      // ajustar esféricas a la posición actual aproximada
      ctr.goTo(new THREE.Vector3(0, 1.5, 0), 26, ctr.theta || 1.9, Math.PI * 0.4);
      ctr.tTarget.set(0, 1.5, 0);

      E.show(D.ui);
      // hint de exploración
      E.show(D.exploreHint);
      setTimeout(() => E.hide(D.exploreHint), 4500);
      // ofrecer el mensaje final tras unos segundos explorando
      setTimeout(() => E.show(D.messageBtn), 9000);
    },

    // ---- volver a vista del campo ----
    fieldView() {
      E.STATE.selectedFlower = -1;
      const ctr = E.MODULES.controls;
      ctr.goTo(new THREE.Vector3(0, 1.5, 0), 30, ctr.theta, Math.PI * 0.4);
      E.hide(D.flowerNote);
    },

    // ---- update por frame ----
    update(dt) {
      E.STATE.time += dt;

      // amanecer progresivo del cielo
      if (this._dawn != null && this._dawn < 1) {
        this._dawn = Math.min(1, this._dawn + dt * 0.25);
        E.skyUniforms.dayFactor.value = this._dawn;
        E.scene.background.setHSL(0.6, 0.5, 0.05 + this._dawn * 0.55);
        E.hemi.intensity = 0.3 + this._dawn * 0.7;
        E.sun.intensity = 0.4 + this._dawn * 1.0;
        // el niebla acompaña el amanecer (de azul oscuro a azul cielo)
        if (E.scene.fog) {
          E.scene.fog.color.setRGB(
            0.04 + this._dawn * 0.58,
            0.05 + this._dawn * 0.72,
            0.16 + this._dawn * 0.84
          );
        }
        if (this._dawn > 0.4) E.clouds.visible = true;
      }

      // secuencia
      if (E.STATE.phase === 'building' || E.STATE.phase === 'cinematic') {
        const prev = this.seqTime;
        this.seqTime += dt;
        E.STATE.phase = 'cinematic';

        // crecimiento del campo sincronizado con el tiempo (0..1 en ~20s)
        E.STATE.growth = Math.min(1, this.seqTime / 20);

        this.directCamera(this.seqTime);
        this.narrativeCue(this.seqTime, prev);

        if (this.seqTime > 30) {
          this.clearSay();
          this.enterExplore();
        }
      }

      // actualizar módulos del mundo
      const g = E.STATE.growth;
      if (E.MODULES.terrain.ground) E.MODULES.terrain.update(dt, g);
      if (E.MODULES.code.points) E.MODULES.code.update(dt, g);
      if (E.MODULES.flowers.meshes.petal) E.MODULES.flowers.update(dt, g);
      if (E.MODULES.scatter.grassMesh) E.MODULES.scatter.update(dt, g);
      E.MODULES.interaction.updateSparkles(dt);

      // brisa variable
      this.windTarget = 0.8 + Math.sin(E.STATE.time * 0.3) * 0.4;
      E.MODULES.flowers.setWind && E.MODULES.flowers.setWind(this.windTarget);
      E.MODULES.scatter.setWind && E.MODULES.scatter.setWind(this.windTarget);

      // nubes a la deriva
      if (E.clouds && E.clouds.visible) {
        for (const c of E.clouds.children) {
          c.position.x += c.userData.speed * dt;
          if (c.position.x > 130) c.position.x = -130;
        }
      }

      // cámara
      if (E.STATE.phase === 'explore') {
        E.MODULES.controls.update();
      }
    }
  };

  E.MODULES.director = director;
})();

/* ============================================================
   MÓDULO: MÚSICA (opcional, sin autoplay)
   ============================================================ */
(function () {
  const E = window.__EXP__;
  const audio = E.dom.ambientAudio;
  const btn = E.dom.soundBtn;
  let on = false;

  // ---- Canción propia ----
  // Pon tu archivo en la carpeta con el nombre "musica.mp3".
  // También busca variantes comunes por si lo llamas distinto.
  const CANDIDATES = ['musica.mp3', 'cancion.mp3', 'song.mp3', 'musica.m4a', 'musica.ogg'];
  const TARGET_VOLUME = 0.6;   // volumen de la canción (0..1)
  let usingFile = false;
  let fileFailed = false;

  // ---- Respaldo: pad ambiental generado (si no hay archivo) ----
  let actx, master, nodes = [];
  function startWebAudioPad() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createGain();
      master.gain.value = 0.06;
      master.connect(actx.destination);
      const freqs = [174.6, 220.0, 261.6, 329.6];
      freqs.forEach((f, i) => {
        const o = actx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const g = actx.createGain();
        g.gain.value = 0.25;
        const lfo = actx.createOscillator();
        lfo.frequency.value = 0.08 + i * 0.03;
        const lfoGain = actx.createGain();
        lfoGain.gain.value = 0.12;
        lfo.connect(lfoGain);
        lfoGain.connect(g.gain);
        o.connect(g);
        g.connect(master);
        o.start();
        lfo.start();
        nodes.push(o, lfo);
      });
    } catch (e) { /* audio no disponible */ }
  }

  // fade suave del volumen del <audio>
  let fadeTimer = null;
  function fadeTo(targetVol, ms) {
    if (fadeTimer) clearInterval(fadeTimer);
    const steps = 24;
    const start = audio.volume;
    let i = 0;
    fadeTimer = setInterval(() => {
      i++;
      const t = i / steps;
      audio.volume = Math.max(0, Math.min(1, start + (targetVol - start) * t));
      if (i >= steps) { clearInterval(fadeTimer); fadeTimer = null; }
    }, ms / steps);
  }

  // Reproduce el archivo AHORA (síncrono dentro del gesto del usuario).
  // Si falla, cae al pad ambiental. No usamos await para no perder el "gesto".
  function playFileNow() {
    if (fileFailed) { fallbackPad(); return; }
    if (!audio.src) audio.src = CANDIDATES[0];
    audio.loop = true;
    audio.volume = 0;
    const pr = audio.play();
    if (pr && pr.then) {
      pr.then(() => {
        usingFile = true;
        fadeTo(TARGET_VOLUME, 1200);
      }).catch(() => {
        // el navegador bloqueó el archivo -> respaldo
        fileFailed = true;
        fallbackPad();
      });
    } else {
      // navegadores viejos: asumimos que empezó
      usingFile = true;
      fadeTo(TARGET_VOLUME, 1200);
    }
  }

  function fallbackPad() {
    if (actx && actx.state === 'suspended') actx.resume();
    else startWebAudioPad();
    if (master) master.gain.value = 0.06;
  }

  function setOn(v) {
    on = v;
    btn.textContent = on ? '🔊' : '🔇';
    if (on) {
      playFileNow();
    } else {
      if (usingFile) { fadeTo(0, 600); setTimeout(() => audio.pause(), 650); }
      if (master) master.gain.value = 0;
    }
  }

  btn.addEventListener('click', () => setOn(!on));
  E.MODULES.music = { setOn };
})();

/* ============================================================
   ARRANQUE: fullscreen, wiring de UI, loop de render
   ============================================================ */
(function () {
  const E = window.__EXP__;
  const D = E.dom;

  // ---- fullscreen (best-effort, tras interacción) ----
  function requestFullscreen() {
    const el = document.documentElement;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    if (fn) {
      try { fn.call(el).catch(() => {}); } catch (e) { /* no soportado */ }
    }
  }

  // ---- loop principal ----
  let rafId = null;
  function animate(now) {
    rafId = requestAnimationFrame(animate);
    const dt = Math.min(0.05, (now - E._lastFrame) / 1000 || 0.016);
    E._lastFrame = now;

    if (E.STATE.paused) return; // pausado (portrait)

    if (E.STATE.started && E.MODULES.director) {
      E.MODULES.director.update(dt);
    }

    if (E.renderer && E.scene && E.camera) {
      E.renderer.render(E.scene, E.camera);
    }
  }

  // ---- wiring de botones ----
  function wireUI() {
    // Comenzar
    D.startBtn.addEventListener('click', () => {
      // PRIMERO la música: debe dispararse dentro del gesto del usuario (autoplay móvil)
      if (E.MODULES.music && E.MODULES.music.setOn) E.MODULES.music.setOn(true);
      E.hide(D.startOverlay);
      requestFullscreen();
      E.MODULES.director.start();
    });

    // Vista del campo
    D.fieldViewBtn.addEventListener('click', () => {
      E.MODULES.director.fieldView();
    });

    // Mensaje final
    D.messageBtn.addEventListener('click', () => {
      E.show(D.messageOverlay);
    });
    D.closeMessageBtn.addEventListener('click', () => {
      E.hide(D.messageOverlay);
    });

    // Cartel del campo
    D.closeSignBtn.addEventListener('click', () => {
      E.hide(D.signOverlay);
    });

    // Inicializar controles (listeners de canvas)
    E.MODULES.controls.init();
  }

  // ---- init global ----
  function boot() {
    E._lastFrame = performance.now();
    window.__INIT_CORE__();   // renderer, escena, luces, cielo, nubes, orientación
    wireUI();
    animate(performance.now());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
