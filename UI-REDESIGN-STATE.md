# UI Redesign — estado del trabajo (actualizado 2026-11-25)

## Branch / worktree
- Worktree: `/Users/fausto/agent-canvas-ui`, branch `ui-redesign`
- Repo principal: `/Users/fausto/agent-canvas` (main, 24 PRs ya mergeados)
- Dev server: `cd web && npm run dev` → localhost:5173 (vite proxea /api y /ws al daemon :4242)
- Screenshot tool: `cd /tmp/canvas-design && node shot.mjs http://localhost:5173 previewN.png` (playwright)

## Feedback de Fausto (mensaje dictado, prioridad literal) — checklist
1. [x] Outline de card en color de ESTADO (running=verde, waiting=ambar, blocked=rojo) + texto de estado en mismo color — HECHO (commit design: state-colored outlines)
2. [x] Naming: "Terminal N" primario + rol secundario + estado + logo CLI y nombre CLI en brand color — HECHO. OJO: numeración real viene del daemon; el mock parsea `rol-N`. Verificar que el daemon asigna nombres únicos incrementales.
3. [x] **Library rail sin flyout** — el panel Tools se acopla como dock con filas etiquetadas y conserva expand/collapse; los submenús no se cierran al elegir opciones. E2E confirma expansión y acciones de Add to canvas.
4. [x] Labels de cables más fuertes — HECHO (12px font-medium)
5. [x] **Cables evitan cards** — edge routing detecta obstáculos múltiples y busca trayectos ortogonales compactos; unit tests cubren conexiones y rutas despejadas.
6. [x] Minimap chico abajo-derecha + zoom controls — YA ESTÁ así (mmSize 148×96, marginRight 184). Confirmar visualmente con Fausto qué le pareció "horrible" — quizás eran los colores viejos (ya actualizados a verde working).
7. [x] **File explorer como ventana del canvas** — E2E crea un workspace, agrega Explorer al canvas, lo mueve, lo redimensiona con persistencia y abre `README.md`.
8. [~] **Terminales usables** — el drawer y la tarjeta flotante montan xterm sobre la PTY; E2E escribe comandos de shell y verifica la salida, split y resize. Falta una pasada manual con una sesión real de CLI de IA para validar esos TUIs concretos.

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
- Chrome general pulido (topbar, rails, bottom bar estilo Deska); Paper theme recibe tokens de superficie, sombras, viñeta y minimapa cálidos para que no conserve el aspecto dark.
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

Estado reconciliado con las implementaciones y pruebas posteriores:
- [x] LIBRARY sin etiqueta vertical ni flyout; expansión horizontal y navegación verificadas en E2E.
- [x] RESIZE en agent cards, paneles, terminales y workspaces; resize de terminal y workspace persiste y conserva la PTY, validado en E2E. Revisar visualmente alturas internas si aparece un nuevo recorte.
- [x] GATHER acomoda tarjetas en una grilla y Undo restaura posiciones; E2E lo verifica.
- [x] Terminal real en la drawer y en la card flotante; E2E envía comandos y confirma salida de shell en ambos casos. Pendiente la pasada manual con un CLI de IA real para confirmar detección de marca/modelo.
- [ ] Chrome SVG implementado; falta la aceptación visual de Fausto sobre los símbolos.
- [x] Tema Paper implementado y persistido; E2E valida colores y minimapa.
- [x] Topbar se fusiona en una bubble al hover; E2E valida unión y separación al salir.
- [x] La captura de referencia ya fue compartida en esta conversación y se conservó para la auditoría visual.
- [ ] Seguir puliendo densidad y alineación visual de paneles/chrome; próxima pasada pendiente.

## Ronda 4 (2026-11-24 ~22:45) — library surgery + resize v1
- [x] Library sin flyout (git menu eliminado, 65 líneas borradas), sin label vertical, expanded persiste en localStorage
- [x] Resize v1: NodeResizer en agent cards cuando selected, ancho persiste en cv-agentsizes. LIMITACIÓN conocida: el resize visual se aplica al soltar (no live durante drag), y height se guarda pero no se aplica al layout — pendiente hacer la card flex-column con el área de terminal flex-1. La forma correcta final: width/height en el nodo RF nativo (nodes array en App.tsx) para feedback live.
- [x] Gather verificado en E2E con cuatro paneles de tamaños distintos: grilla sin solapamientos dentro del viewport; Undo restaura todas las posiciones y borra el frame. No se encontró regresión en el branch.
- [x] Topbar bubble-fusion on hover — implementada en ronda 5 y cubierta por E2E.
- [ ] deska.dev web crawl — las notas 10/12 del vault ya cubren casi todo; fetch pendiente solo si hace falta algo específico

## Ronda 5 (2026-11-24 ~23:00)
- [x] Resize v2 LIVE: nodes llevan style width/height en construcción (App.tsx), memo rebuild con agentSizes en deps y `onResize` actualiza durante drag. La cobertura E2E comprueba resize y persistencia de las superficies principales.
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
- [x] Repo Explorer: descarta respuestas tardías de listado/archivo que pertenecen al repositorio anterior al cambiar de workspace. Evita mostrar un árbol cruzado o un archivo obsoleto durante la navegación.
- [x] Explorer: filtro instantáneo por ruta/nombre de archivo, estado visible para búsquedas sin resultados y prueba E2E de filtro + apertura de README en vivo.
- [x] Explorer preview: encabezado pegajoso con nombre y ruta completa, números de línea y scroll horizontal para preservar código largo sin cortes arbitrarios; empty state orienta cómo empezar.
- [x] Validación del Explorer: typecheck, build, 23 unit tests y E2E de montaje/resize/filtro/lectura pasan localmente. La suite general pasó 26/26 antes de esta extensión puntual.
- [x] Dock inferior: los accesos Terminal y Code Editor ahora muestran contadores de ventanas abiertas en el board actual; E2E confirma el incremento al abrir/spawnear.
- [x] Topbar bubble fusion: al hover, ambos grupos (Canvas/workspaces y controles de la derecha) comparten una sola superficie glass; al salir vuelven a sus bubbles independientes. E2E verifica activación, aspecto unido y retorno al estado inicial.
- [x] E2E completo tras topbar: 26/26 pasan; typecheck y build pasan.
- [x] Agent cards: controles de abrir terminal, colapsar y cerrar convertidos a botones nativos, accesibles por teclado; E2E abre la terminal con Enter y verifica el xterm interactivo.
- [x] E2E completo tras controles accesibles: 27/27 pasan localmente; typecheck, build, 23 unit tests y `git diff --check` pasan.
- [x] Paneles y terminales flotantes: chrome de minimizar/expandir/cerrar con nombres accesibles; los clicks no inician drag del header. E2E verifica minimizar/restaurar por teclado y cerrar el panel.
- [x] E2E completa tras pulir el chrome de paneles: 28/28; typecheck, build y 23 unit tests pasan.
- [x] Library: expand/collapse ahora expone `aria-expanded` y nombre accesible; E2E confirma expansión horizontal, labels (Source Control, Obsidian, Dex Tickets), navegación a Obsidian y ausencia de flyout.
- [x] E2E completa tras Library: 29/29; typecheck, build y 23 unit tests pasan.
- [x] Panel maximize/restore: E2E detectó que el store restauraba el rectángulo pero React Flow retenía la geometría maximizada; el cache de nodos ahora solo reutiliza nodos con posición y dimensiones sincronizadas. Prueba verifica maximize por teclado y restore al tamaño original.
- [x] E2E integral tras sincronización de geometría: 29/29; typecheck, build y 23 unit tests pasan.
- [x] Terminales flotantes: el header ahora ofrece maximizar/restaurar con persistencia del rectángulo anterior; la PTY permanece montada. E2E lo activa por teclado y verifica el tamaño al volver.
- [x] E2E completa tras maximize/restore de terminales: 29/29; typecheck, build y 23 unit tests pasan.
- [x] Demo offline: el chequeo de geometría del cache se restringió a cards `panel-` y `term-`; E2E detectó y previene el loop de actualizaciones que aparecía al arrancar sin daemon.
- [x] Validación completa tras aislar el chequeo geométrico: 30/30 E2E, 23 unit tests, typecheck, build y `git diff --check` pasan.
- [x] Panels switcher audit: las posiciones fallback de agentes y las dimensiones de workspace ahora coinciden con el layout real del canvas; los títulos respetan el orden Terminal N. E2E abre el switcher y verifica que una terminal se pueda enfocar.

## Obsidian en el canvas (2026-11-25)
- [x] Las ventanas de notas fijadas al board ahora reutilizan el renderer Markdown del Vault real: headings, formato inline, tareas, embeds, imágenes locales, wikilinks resueltos/no resueltos y previews compatibles con el vault conectado. La ventana mantiene su lectura viva del archivo y resize, con marca LIVE VAULT y el icono oficial.
- [x] E2E del flujo Add to Board guarda una nota con Markdown y comprueba formato y wikilink visible dentro de la ventana interactiva del canvas.
- [x] Validación: 23/23 unit tests, 30/30 E2E, typecheck, build y `git diff --check`.

## Tema Paper y estado del roadmap (2026-11-25)
- [x] Tema Paper: sombras cálidas suaves, viñeta reducida y minimapa con máscara clara; el lienzo, controles y tarjetas dejan de heredar sombras y overlay negros del tema dark.
- [x] Corrección visual del minimapa: sus variables de máscara, borde y trazo ahora se aplican en el estilo del SVG de React Flow; E2E valida el color realmente renderizado y persistencia del tema.
- [x] E2E cambia a Paper, verifica fondo/sombra/máscara y confirma persistencia tras recargar.
- [x] Roadmap reconciliado con evidencia actual: Library sin flyout y routing que esquiva tarjetas están completados; PTY interactiva queda validada para shell, pero falta una pasada manual con CLIs de IA reales.
- [x] Validación tras el tema Paper: 23/23 unit tests, 31/31 E2E, typecheck, build y `git diff --check`.
- [x] CI de PR #47 tras `753ae07`: Devin Review, canvasd, e2e, Tauri macOS, Tauri Ubuntu y web pasan.
- [x] Topbar: Panels y Mission Map ahora son controles etiquetados; el resumen live abre Mission Map y se eliminó el acceso duplicado con icono de orchestrator. E2E verifica navegación y panel.
- [x] Validación topbar: typecheck, build, 23/23 unit tests, 32/32 E2E, captura revisada y `git diff --check`.
- [x] Resumen del topbar y badges de tareas: conteos de sesiones, waiting, blocked y delegaciones se calculan en el board activo para no mezclar actividad de otros spaces. 32/32 E2E, 23/23 unit tests y typecheck pasan.
- [x] Spawn placement: agentes sin posición aparecen en espacios libres visibles; spawn múltiple reserva posiciones independientes antes de recibir eventos del daemon; `Gather` comparte la distribución fallback; workspace spawn crece el marco y apila tarjetas con el tamaño real. Validación: 26/26 unit tests, 32/32 E2E, typecheck, build y `git diff --check`. Captura revisada en `/tmp/canvas-design/spawn-layout-final3.png`.
- [x] Tarjetas de agentes: cabecera en dos filas para separar Terminal/rol/acciones de estado/CLI, con icono de terminal y marcas de modelo legibles. El demo ajusta tamaño/posición de workspaces para que React Flow no recorte tarjetas ni las apile en el borde.
- [x] Validación visual y automatizada de tarjetas: captura revisada; E2E comprueba nombre, estado, CLI, jerarquía de la cabecera y ausencia de solapamientos; build, typecheck, 23/23 unit tests, 32/32 E2E y `git diff --check` pasan.
- [x] Panels switcher actualizado para compartir la colocación real de agentes sin posición, el orden de Terminal N y el tamaño dinámico de workspaces. E2E valida apertura, fila de terminal y navegación a Mission Map.
- [x] Validación tras alinear Panels: 26/26 unit tests, typecheck, build, 32/32 E2E y `git diff --check`.
- [x] Badge de Inbox/notificaciones: aprobaciones ahora se cuentan solo para agentes del board activo, igual que waiting y blocked; cambiar de Space no arrastra approvals de otros boards. Validación: typecheck, 26/26 unit tests y 32/32 E2E.
- [x] Build de producción y `git diff --check` pasan tras el ajuste del badge.
- [x] Ajuste del badge publicado en el PR #47 como `bd21dbd`; mantener el PR abierto y sin merge.
- [x] Auditoría visual en modo demo encontró un loop de React en `onSelectionChange`: el callback recreaba el array de selección aunque nada hubiera cambiado. Ahora el callback es estable y conserva la referencia previa si ids/posiciones/dimensiones son iguales. La captura ya no muestra errores de update depth: `/tmp/canvas-design/roadmap-audit-fixed.png`.
- [x] Se añadió una regresión E2E que observa explícitamente errores `Maximum update depth exceeded` en demo offline. Suite actual: 26/26 unit tests, 33/33 E2E, typecheck, build y `git diff --check`.
- [ ] Hacer la próxima pasada visual de densidad/alineación y, en una sesión manual aparte, probar un CLI de IA real en el PTY. La captura actual ya se auditó tras el cambio de etiquetas.
- [ ] Siguiente lote: seguir auditando densidad y alineación de paneles/chrome contra la referencia Deska; mantener PR #47 abierto y sin merge.
- [x] Etiquetas de delegación: el ruteador busca tramos despejados y evita también las tarjetas de origen/destino. Las posiciones de nodos anidados se convierten a coordenadas absolutas antes de comprobar colisiones; la etiqueta usa el punto calculado incluso cuando el cable conserva el Bézier directo. Captura revisada en `/tmp/canvas-design/delegation-parent-offset.png` sin errores de consola.
- [x] Validación tras corregir las etiquetas: typecheck, 28/28 unit tests, 33/33 E2E, build de producción y `git diff --check` pasan. Las pruebas E2E incluyen shell/PTy y terminal flotante interactiva.
- [x] Regresión de coordenadas anidadas: pruebas unitarias cubren la suma de tres niveles de workspace y el uso de `positionAbsolute` calculado por React Flow; la detección de colisiones queda protegida ante ambos casos.
- [x] Validación tras añadir esa regresión: 30/30 unit tests, 33/33 E2E, typecheck, build de producción y `git diff --check` pasan.
