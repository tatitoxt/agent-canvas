# UI Redesign — estado del trabajo (actualizado 2026-11-24)

## Branch / worktree
- Worktree: `/Users/fausto/agent-canvas-ui`, branch `ui-redesign`
- Repo principal: `/Users/fausto/agent-canvas` (main, 24 PRs ya mergeados)
- Dev server: `cd web && npm run dev` → localhost:5173 (vite proxea /api y /ws al daemon :4242)
- Screenshot tool: `cd /tmp/canvas-design && node shot.mjs http://localhost:5173 previewN.png` (playwright)

## Feedback de Fausto (mensaje dictado, prioridad literal) — checklist
1. [x] Outline de card en color de ESTADO (running=verde, waiting=ambar, blocked=rojo) + texto de estado en mismo color — HECHO (commit design: state-colored outlines)
2. [x] Naming: "Terminal N" primario + rol secundario + estado + logo CLI y nombre CLI en brand color — HECHO. OJO: numeración real viene del daemon; el mock parsea `rol-N`. Verificar que el daemon asigna nombres únicos incrementales.
3. [ ] **Library rail: revertir al estilo pre-flyout** — Fausto odia el flyout tipo iOS que vino con los PRs mergeados del hijo (`web/src/components/NavRail.tsx` — bubbles Spaces/Extras/Library con menús `cv-menu` flotantes). "Estaba mejor como estaba antes en la conversación esta" = antes de los 24 PRs. Buscar en git history del repo principal la implementación anterior del library/presets (probablemente un panel expandible simple anclado a la izquierda, no un flyout flotante). `git log --oneline main -- web/src/` en /Users/fausto/agent-canvas para encontrar el commit pre-redesign del hijo.
4. [x] Labels de cables más fuertes — HECHO (12px font-medium)
5. [ ] **Cables no deben atravesar cards** — routing prolijo. Actualmente los edges van en línea recta/curva simple y cruzan nodos. Implementar obstacle-aware routing (ver `web/src/board/edges.tsx` — custom edge component). Opciones: routing con waypoints que esquiva bounding boxes de nodos, o elevar z-index visual + curvar alrededor. Fausto: "el cable pasa por todo arriba de Atlas, no se nota, pero cuando hacés clic en dock se ve que se cortan las terminales".
6. [x] Minimap chico abajo-derecha + zoom controls — YA ESTÁ así (mmSize 148×96, marginRight 184). Confirmar visualmente con Fausto qué le pareció "horrible" — quizás eran los colores viejos (ya actualizados a verde working).
7. [ ] **File explorer NO debe abrir como sidebar** — debe ser panel flotante. Ver el componente que abre al clickear files junto a la terminal (probablemente en App.tsx o components/FilesPanel). Convertir de sidebar docked a floating panel draggable estilo Deska.
8. [ ] **Terminales usables de verdad** — el daemon canvasd nunca terminó de compilar. Relanzado: `cargo build -p canvasd` en el worktree (background shell). Cuando esté: correrlo en :4242 y spawnear agentes reales para probar escribir en las PTYs. Nota: el hijo encontró una vuln de path traversal y estaba implementando sandbox allowedRoots — verificar estado de eso en main.

## Decisiones de diseño ya aplicadas (no revertir)
- IBM Plex Sans/Mono (tipografía Deska)
- Tokens Deska: blur 20px saturate 1.15, surfaces color-mix, radii 12/14
- Hairline de identidad CLI en borde superior de card + tile del logo en color CLI
- Grain + luz ambiental en canvas (sutil, vignette suavizado)
- Un solo acento fuerte por card (regla Deska)
- working/running = VERDE #34c77b (Fausto lo pidió explícitamente, reverte el naranja Deska)
- Aristas de delegación en amber fluyendo

## Pendiente grande después del checklist
- Densidad de contenido en cards (texto más grande, más aire)
- Chrome general pulido (topbar, rails, bottom bar estilo Deska)
- Reconciliar/pushear branch: Fausto decide si mergear a main vía la sesión madre
- Modelo: todo este trabajo corre en swe-2-1-medium gratis (Fausto no tiene créditos para frontier)

## Relay con la sesión madre web
- Archivo: `/Users/fausto/devin-relay.md` — la madre escribe ahí, Fausto dice "leé el relay"
- Madre = session a46c5af5d6134e5a8f22eff849b96dd2, hija = 42f5459b7f654bd8ae31bdd7debfe7bd
- Mensajes no-interactivos: `devin --cloud -r <url> -p "msg"` (async)

## REFERENCIA DESKA REAL (screenshot 2026-11-24 22:14, enviado por Fausto)
Fausto respondió la pregunta de la library con este screenshot — ES la respuesta:
- **Tools panel (derecha)**: panel DOCKED oscuro, no flyout. Rows con ícono+label: Inbox, Source Control, Pull request, Explorer, Dex Tickets, Artifacts. Header "Tools" con íconos de pin/collapse. Botón + abajo. => La library de Canvas tiene que ser ESTO: un panel anclado al borde derecho con rows labelleadas, no menús flotantes hover.
- **Spaces rail (izquierda)**: rail vertical delgado con íconos, badge numérico en el space activo (cuadrado con borde teal/verde), íconos de tools debajo, + para nuevo, avatar/ícono abajo. Canvas ya tiene esto aproximado — pulir.
- **Topbar Deska**: logo+nombre, "This Mac", proyecto, branch master, "1 task" — luego derecha: Automations, Marketplace, iPhone, search, settings, bell, avatar.
- **Cards**: flotan sobre el wallpaper real del desktop (el canvas ES transparente al escritorio). Terminal cards muestran contenido real de shell. Headers minimalistas: título chico centrado/izquierda, chrome casi invisible.
- **Inbox panel**: muestra "0 agents running", "Needs you", items con status Failed en rojo, botones Details/Dismiss — bandeja de atención.
- Wallpaper visible => la ambientación con grano/luz que hicimos es la aproximación correcta para Canvas (que no es transparente al desktop).
