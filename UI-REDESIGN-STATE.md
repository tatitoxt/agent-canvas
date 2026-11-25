# UI Redesign — estado del trabajo (actualizado 2026-11-25)

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
7. [x] **File explorer como ventana del canvas** — E2E crea un workspace, agrega Explorer al canvas, lo mueve, lo redimensiona con persistencia y abre `README.md`.
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

## FEEDBACK FAUSTO — ronda 2 (dictado 2026-11-24 ~22:30, tras probar la app en vivo)
**Regla nueva de Fausto: "Siempre preguntame antes que otra cosa" — confirmar interpretaciones con él antes de implementar.**

1. **Outline completo y más fuerte**: nada de hairline solo arriba en color CLI — el outline de estado tiene que recorrer TODO el perímetro de la card y con colores MÁS fuertes/vivos. (La hairline CLI superior probablemente debe eliminarse o subordinarse.)
2. **Estela animada en running**: cuando está running, el outline lleva una luz/estela corriendo alrededor del borde ("como algo corriendo, una luz corriendo"). Lo mismo para waiting y demás estados (cada uno con su color). Implementación sugerida: border animado vía conic-gradient rotando en una máscara de borde, o SVG rect con stroke-dasharray animado — cuidar performance.
3. **Selección por clic = outline distinto**: independiente del estado, clickear una card le pone otro tipo de outline diferenciado.
4. **CERO flyout tipo iOS** — reconfirmado.
5. **"Swiss"**: hay algo en la UI etiquetado "Swiss" que no se entiende — buscarlo y renombrar/quitar.
6. **Botones del chrome de panel están muy mal**: el menos (minimizar), "una flecha rara que no tiene que estar" (¿maximize/restore nuevo del PR #25?), un cuadrado que no cambia nada, y la cruz. Rediseñar todos los símbolos — más lindos, estilo Deska. **Todos los botones en BLANCO** (decisión previa de Fausto).
7. **Cards de automations/artifacts agregadas al board se ven mal** — hacerlas más facheras, más Deska.
8. **Gather desordena**: junta las cards una encima de la otra — necesita layout ordenado (grid/flow con spacing).
9. **Library = sidebar extendida estilo bubbles del bottom bar**: íconos con el NOMBRE al lado de cada item, más íconos de los que hay (incluir GitHub, etc.). Inspirarse en los bubbles inferiores.
10. **Toda card de terminal arranca con el glyph de terminal `>_`** como primer ícono, ANTES del logo del CLI. Cada tipo de cosa tiene su símbolo (artifacts tienen simbolitos, etc.).
11. **Topbar**: en Deska, hover sobre los items del top nav los fusiona en una sola bubble. El pill de status "canvas · working · needs you · blocked · done · demo" — moverlo a otro lado o eliminarlo directamente.
12. Fausto enviará foto(s) de Deska como referencia adicional — revisar su Desktop o pedírsela a la vuelta.

## Pendiente de ronda 1 sin tocar: library docked (#3), edge routing (#5), file explorer flotante (#7), terminales reales verificar (#8), crowding del header.

## DATA CLAVE DEL RELAY MADRE (verificado en main por ella)
- **Maximize ▢ SÍ funciona en main** (card llena viewport y restaura) — si en el branch no hace nada es REGRESIÓN DEL REDISEÑO, revisar.
- **Gather en main ordena en grid** (no apila) — idem: si apila es regresión del branch.
- Selección en main = ámbar #e8b25a — usarlo para el outline de selección por clic.
- PR #33 (fallback chain daemon) mergeado; main verde para rebasear.
- Madre e hijo NO tocan el worktree — quedan en lógica/daemon/tests sobre main.
- "Swiss": probablemente Fausto leyó mal un label de la UI — verificar qué elemento dice algo parecido (¿"switch"? ¿un nombre de preset?).

## IMÁGENES DE REFERENCIA ENVIADAS POR FAUSTO/MADRE
- `/tmp/canvas-design/madre-ref.png` — screenshot 2026-11-24 19:46 (copiado del Desktop, nombre original tiene U+202F). ANALIZAR AL RETOMAR — probablemente referencia Deska.
- `/Users/fausto/Desktop/Screenshot 2026-11-24 at 10.14.47 PM.png` — Deska real completo (ya analizado, ver sección REFERENCIA DESKA REAL).
- Desktop tiene más screenshots del 21/11 — revisar por si son referencias viejas de Deska/Symvibe.

## CÓMO LEVANTAR EL ENTORNO COMPLETO (live)
1. Daemon: `cd /Users/fausto/agent-canvas-ui && ./target/debug/canvasd` (si no corre). Al arrancar escupe `CANVASD_TOKEN=...` en stdout/log — cambia en cada reinicio.
2. Web: abrir `http://localhost:5173/?token=<TOKEN>` — la app conecta (punto verde junto a Tasks). Sin token queda "offline" y muestra el demo mock.
3. Para screenshots de diseño usar el modo offline (demo con 5 cards); para probar terminales reales usar el token.
4. Verificar: ¿el token se puede fijar fijo en dev? mirar si canvasd acepta env var o config — sería más cómodo que leerlo del log cada vez.

## FEEDBACK FAUSTO — ronda 3 (2026-11-24 ~22:28, con captura live real)
Hecho ya:
- [x] UNA sola estela (el conic tenía dos arcos — él quiere un solo cometa)
- [x] Selección ámbar con PRIORIDAD TOTAL: seleccionar oculta ring y border de estado, solo queda ámbar
- [x] Símbolo pin/note ◈ eliminado del chrome de agent cards
- [x] Chrome unicode → SVG icons (x/minus/zoom para maximize) en paneles y cards

Pendiente ronda 3:
- [ ] LIBRARY: el label "Library" está vertical (writingMode) y tiene que ser horizontal; el expand tiene que abrir HORIZONTALMENTE; sigue estando el flyout — eliminar
- [ ] RESIZE: no se puede resizear NADA — todo tiene que ser resizeable (agent cards no tienen NodeResizer! panels sí pero quizás roto)
- [ ] GATHER: no anda — solo crea grupos/regions pero no junta las cards. Texto "Gather / No loose windows" aparece mal posicionado cerca del minimap (bottom)
- [ ] Terminales en card = "imitación" (preview MiniTerm) vs terminal real popped-out — él quiere la terminal REAL usable en la card. Además cards de terminales spawneadas como bash no muestran logo CLI (dice "Terminal" en vez de Codex) — posiblemente esperable en bash puro, verificar con agente codex real
- [ ] La cruz × y el menos — ya cambiados a SVG, CONFIRMAR con él si le gustan
- [ ] "el color mal, la versión light, tóquenlo lo máximo" — INCLARO, preguntarle qué quiso decir (¿theme light roto?)
- [ ] Topbar: fusión en una sola bubble on hover (sigue pendiente de ronda 2)
- [ ] Fausto manda otra foto de Deska — revisar Desktop al retomar
- [ ] En su captura se veía panel Juice/Inbox/Automations muy plain — pendiente "cards más facheras estilo Deska"

## Ronda 4 (2026-11-24 ~22:45) — library surgery + resize v1
- [x] Library sin flyout (git menu eliminado, 65 líneas borradas), sin label vertical, expanded persiste en localStorage
- [x] Resize v1: NodeResizer en agent cards cuando selected, ancho persiste en cv-agentsizes. LIMITACIÓN conocida: el resize visual se aplica al soltar (no live durante drag), y height se guarda pero no se aplica al layout — pendiente hacer la card flex-column con el área de terminal flex-1. La forma correcta final: width/height en el nodo RF nativo (nodes array en App.tsx) para feedback live.
- [x] Gather verificado en E2E con cuatro paneles de tamaños distintos: grilla sin solapamientos dentro del viewport; Undo restaura todas las posiciones y borra el frame. No se encontró regresión en el branch.
- [ ] Topbar bubble-fusion on hover — pendiente
- [ ] deska.dev web crawl — las notas 10/12 del vault ya cubren casi todo; fetch pendiente solo si hace falta algo específico

## Ronda 5 (2026-11-24 ~23:00)
- [x] Resize v2 LIVE: nodes llevan style width/height en construcción (App.tsx), memo rebuild con agentSizes en deps, onResize stream durante drag. Falta: height layout interno flex (minHeight aplicado).
- [x] Gather fix verificado — era mismatch 360 vs 460 de card size
- [x] Topbar fusion: cluster derecho se fusiona en una bubble glass on hover (.cv-fuse en index.css)
- [x] MissionStrip eliminado del centro + botón Mission Map muerto eliminado (data vive en topbar live count + Inbox)
- [ ] Próximo: transcript rows estilo Deska (verb bold + detalle) en cards, per-window color tint, input steering inline (esperando research hija), edge routing

## Performance pass (2026-11-24 late, after "anda re mal la web local")
Committed:
1. Ring orbit animation — removed `filter: saturate() brightness()` from the
   animating element (was repainting the whole ring every frame per card)
2. Resize — was writing localStorage synchronously at 60fps during drags;
   now in-memory while dragging, persisted once on release
3. Glass blur 20px → 14px (cost scales with radius; visual diff minimal)
Already-optimized (verified, NOT bottlenecks): activity/lastLine updates are
coalesced at 400ms; pty screen parsing is incremental via headless xterm
(fed counter); MiniTerm memoized; onlyRenderVisibleElements on.
REMAINING LEVERS if still slow:
- vite dev mode + React dev build is inherently 2-3x slower than prod —
  test `npm run build && npm run preview` for true feel
- backdrop-filter blur on all glass during pan/zoom is the known canvas
  cost — could drop blur on large cards, keep on chrome only (aesthetic call)
- edge obstacle routing recomputes per render during pan (small)

## Continuación del roadmap (2026-11-25)
- [x] Terminal drawer: resize con persistencia y redimensionado de xterm/PTY; estilo sólido oscuro en vez de glass. Commit `04a3955` en PR #47.
- [x] Título de terminal por rol: `reviewer-1` → `Review 1`, `builder_2` → `Builder 2`, `tester-4` → `Test 4`; mantiene nombres custom y numeración para `Terminal` genérico. En validación local: 8 unit tests, 6 E2E terminal, typecheck y build.
- [x] Add to Board de Obsidian verificado en E2E: cierra Tools y monta Vault Explorer en vivo como ventana del canvas. Add Inbox también tiene cobertura de cierre + montaje.
- [x] Add to Board de Artifacts verificado en E2E: cierra Tools y monta la biblioteca con su control `+ new` activo.
- [x] Tools: corregido el cierre prematuro del submenú compartido; New workspace y Add shape ahora mantienen sus opciones abiertas. Las formas nuevas se ubican dentro del viewport visible. E2E cubre ambas rutas.
- [x] Explorer: el E2E crea un workspace, agrega la ventana al canvas, lista y abre README.md. La prueba corre al final porque crea estado compartido en el daemon del harness.
- [x] Explorer resize: el E2E agranda el panel y verifica que ancho/alto persisten en el estado del board.
- [x] Suite E2E robustecida: selectores de terminal apuntan a nodos agente, selección evita controles del header, doble clic busca una zona despejada y el resize apunta al grip bottom-right. 25/25 E2E pasan localmente.
- [x] Edge routing: los cables detectan colisiones con múltiples tarjetas y prueban rutas ortogonales compactas antes de rodear el campo completo. Unit tests cubren obstáculos múltiples, conexiones verticales en ambas direcciones y trayectos despejados.
- [x] Validación integral tras el router: typecheck, build, 23 unit tests y 25/25 E2E pasan localmente; `git diff --check` limpio.
- [ ] Próximo orden sugerido: revisar el file explorer flotante y su consistencia visual; después seguir con los pendientes visuales de topbar y chrome. Mantener cada lote pequeño y verificable en PR #47, sin merge.
