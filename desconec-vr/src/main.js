import { PhysicsWorld } from './core/physics/PhysicsWorld.js';
import { App } from './core/App.js';

/**
 * Bootstrap de Desconec-VR: inicializa Rapier (WASM), construye la App y ofrece
 * entrar en WebXR (experiencia principal) o en el modo de prueba de PC.
 */
const bootEl = document.getElementById('boot');
const statusEl = document.getElementById('boot-status');
const vrBtn = document.getElementById('btn-vr');
const deskBtn = document.getElementById('btn-desktop');

async function main() {
  await PhysicsWorld.init();
  statusEl.textContent = 'Generando materiales, sonidos y escenas...';
  const app = new App(document.getElementById('app'));
  window.__desconecvr = app;
  await app.start('lobby');

  const xrSupported = !!navigator.xr && (await navigator.xr.isSessionSupported('immersive-vr').catch(() => false));
  statusEl.textContent = xrSupported
    ? 'Listo. Ponete el casco y entrá en VR (mandos con grip, joystick y botones).'
    : 'Este navegador no expone WebXR inmersivo: podés usar el modo prueba PC.';
  vrBtn.disabled = !xrSupported;
  deskBtn.disabled = false;

  vrBtn.addEventListener('click', async () => {
    await app.audio.resume();
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking']
    });
    await app.renderer.renderer.xr.setSession(session);
    bootEl.style.display = 'none';
  });

  deskBtn.addEventListener('click', async () => {
    await app.audio.resume();
    bootEl.style.display = 'none';
    app.desktop.setEnabled(true);
    app.renderer.renderer.domElement.requestPointerLock();
  });

  app.onXRSessionEnd = () => {
    bootEl.style.display = 'flex';
  };
}

main().catch((err) => {
  console.error(err);
  statusEl.textContent = `Error al iniciar: ${err.message}`;
});
