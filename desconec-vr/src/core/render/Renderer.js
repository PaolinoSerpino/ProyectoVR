import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * Renderer realista compartido por todas las escenas:
 * ACES Filmic, sombras PCF suaves, salida sRGB, WebXR habilitado y entornos PMREM
 * para reflejos físicamente plausibles en vidrio y metal.
 */
export class Renderer {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    r.setSize(window.innerWidth, window.innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap; // en r18x PCF ya filtra suave (shadow.radius)
    r.xr.enabled = true;
    r.xr.setReferenceSpaceType('local-floor');
    r.xr.setFoveation(0.5);
    container.appendChild(r.domElement);

    this.pmrem = new THREE.PMREMGenerator(r);
    this.envCache = new Map();

    window.addEventListener('resize', () => this.onResize());
  }

  onResize() {
    if (this.renderer.xr.isPresenting) return;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.onResizeCallback?.();
  }

  /**
   * Mapas de entorno pre-filtrados (PMREM):
   * - 'studio': RoomEnvironment neutro (sala industrial: reflejos de lámparas en metal/vidrio).
   * - 'botanical': cúpula cálida con tragaluz cenital y verdes difusos (lobby).
   */
  getEnvironment(kind) {
    if (this.envCache.has(kind)) return this.envCache.get(kind);
    let envScene;
    if (kind === 'botanical') {
      envScene = buildBotanicalEnvScene();
    } else {
      envScene = new RoomEnvironment();
    }
    const target = this.pmrem.fromScene(envScene, 0.035);
    envScene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.envCache.set(kind, target.texture);
    return target.texture;
  }
}

function buildBotanicalEnvScene() {
  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(20, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        top: { value: new THREE.Color(0xfff6e4).multiplyScalar(1.4) },
        horizon: { value: new THREE.Color(0xd9e2cf) },
        bottom: { value: new THREE.Color(0x5b6e55) }
      },
      vertexShader: 'varying vec3 vPos; void main(){ vPos = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vPos;
        void main(){
          float h = vPos.y;
          vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, bottom, pow(-h, 0.5));
          gl_FragColor = vec4(c, 1.0);
        }`
    })
  );
  scene.add(sky);

  // Tragaluz cenital intenso + paneles verdes de follaje
  const skylight = new THREE.Mesh(new THREE.CircleGeometry(4, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(6) }));
  skylight.position.y = 12;
  skylight.rotation.x = Math.PI / 2;
  scene.add(skylight);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), new THREE.MeshBasicMaterial({ color: 0x4d6b45, side: THREE.DoubleSide }));
    panel.position.set(Math.cos(a) * 14, 1, Math.sin(a) * 14);
    panel.lookAt(0, 1, 0);
    scene.add(panel);
  }
  return scene;
}
