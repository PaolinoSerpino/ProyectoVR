# Desconec-VR

Experiencia inmersiva **WebXR-first** (cascos con mandos de 6DoF: grip, joystick y botones) construida con
**Vite + Three.js + Rapier3D** (física real con CCD). Incluye un modo de prueba para PC, separado del código XR.

## Ejecutar

```bash
npm install
npm run dev          # http://localhost:5173 (PC / modo prueba)
npm run dev:https    # HTTPS en la red local: abrir desde el navegador del casco (WebXR exige contexto seguro)
npm run build        # build de producción en dist/
```

## Controles

| Acción | VR (mandos) | Modo prueba PC |
| --- | --- | --- |
| Agarrar / soltar | Grip (lateral) · pinza con hand-tracking | `E` |
| Lanzar | Soltar el grip en movimiento (hereda velocidad lineal + angular real) | Clic izq. con objeto |
| Martillazo | Mover el mando de verdad | Clic izq. con el martillo (animación física) |
| Moverse | Joystick adelante → arco de teletransporte → soltar | `WASD` + mouse |
| Girar | Joystick izq./der. (snap turn 30°) | Mouse |
| Botones 3D | Tocarlos con la mano o con la cabeza del martillo | Clic izq. apuntando |
| Volver al lobby | Mantener B/Y 0.8 s · botón verde en la pared · cruzar la salida | `L` |

## Arquitectura

```
src/
├─ main.js                     Bootstrap (Rapier WASM, App, botones VR / PC)
├─ core/
│  ├─ App.js                   Loop: entrada → objetivos de agarre → física (subpasos) → escena → botones → render
│  ├─ BaseScene.js             Ciclo de vida mount / update / unmount
│  ├─ config.js                Paleta, constantes físicas y grupos de colisión
│  ├─ render/                  Renderer (ACES, sombras, PMREM), texturas PBR procedurales, materiales
│  ├─ physics/PhysicsWorld.js  Wrapper Rapier: paso fijo 120 Hz, interpolación, CCD, impactos con velocidad pre-paso
│  ├─ vr/                      Hand / XRHand, VelocityTracker, GrabSystem (seguimiento por velocidad), Locomotion
│  ├─ input/DesktopControls.js Modo prueba PC (DesktopHand implementa la misma interfaz Hand)
│  ├─ audio/AudioEngine.js     Sonidos sintetizados (OfflineAudioContext) + PositionalAudio HRTF modulado por fuerza
│  ├─ storage/Storage.js       Récords y estadísticas en localStorage
│  └─ ui/                      TextPanel, Popups3D, PhysicalButton, Fader
├─ scenes/lobby/               Lobby botánico + portales modulares generados desde el registro
└─ minigames/
   ├─ BaseMinigame.js          Interfaz base (meta + mount/update/unmount + exitToLobby)
   ├─ registry.js              Lista de minijuegos → portales del lobby
   └─ rageRoom/                Minijuego 1 "Sala de Descarga"
```

### Física de interacción

- **Agarre por seguimiento de velocidad:** el objeto agarrado sigue siendo dinámico (gravedad 0); en cada subpaso
  se le asigna la velocidad lineal/angular necesaria para alcanzar la pose de la mano. Mantiene colisiones reales y CCD.
- **Lanzamiento:** al soltar, `v = v_mano(pico suavizado de 8 frames) + ω_mano × r`, con `pose.linearVelocity /
  angularVelocity` del visor cuando están disponibles.
- **Daño:** `daño = (velocidad_relativa − umbral_del_equipo) × dureza_del_otro × 4`. Por debajo del umbral solo hay empuje.

### Agregar un minijuego

1. Crear `src/minigames/<id>/MiJuego.js` extendiendo `BaseMinigame` con `static meta = { id, title, subtitle, recordKey }`.
2. Implementar `mount(ctx)`, `update(dt)` y `unmount()` (llamando a `super`).
3. Reemplazar una entrada `comingSoon` de `registry.js` por `{ ...MiJuego.meta, create: () => new MiJuego() }`.
