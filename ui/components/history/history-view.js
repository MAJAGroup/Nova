import { layoutHistory, graphBounds, zoomAt } from "./graph.mjs";

const svgNS = "http://www.w3.org/2000/svg";
function element(tag, className, text) {
  const node = document.createElement(tag); node.className = className || "";
  if (text !== undefined) node.textContent = text;
  return node;
}
function svg(tag, attrs) {
  const node = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}
function domain(url) { try { return new URL(url).hostname; } catch { return url; } }
const date = value => new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export function createHistoryView({ browser, onVisibilityChange }) {
  const root = document.getElementById("history");
  const viewport = root.querySelector(".history-viewport");
  const scene = root.querySelector(".history-scene");
  const edgesLayer = root.querySelector(".history-edges");
  const nodesLayer = root.querySelector(".history-nodes");
  const inspector = root.querySelector(".history-inspector");
  const search = root.querySelector("input");
  const mini = root.querySelector(".history-minimap");
  const list = root.querySelector(".history-list");
  const count = root.querySelector(".history-count");
  const empty = root.querySelector(".history-empty");
  let visits = [], selected = null, graph = { nodes: [], edges: [] };
  let camera = { x: 50, y: 80, zoom: 1 }, positions = {}, collapsed = new Set();
  let listMode = false, gesture = null, suppressClick = false, saved = false;
  try {
    const state = JSON.parse(localStorage.getItem("orbit.history.layout") || "null");
    if (state) {
      positions = state.positions || {};
      if ([state.camera?.x, state.camera?.y, state.camera?.zoom].every(Number.isFinite)) {
        camera = { ...state.camera, zoom: Math.max(.15, Math.min(2.5, state.camera.zoom)) }; saved = true;
      }
      collapsed = new Set(state.collapsed || []);
    }
  } catch {}
  function save() {
    try { localStorage.setItem("orbit.history.layout", JSON.stringify({ positions, camera, collapsed: [...collapsed] })); } catch {}
  }
  function nodeButton(visit, className) {
    const button = element("button", className);
    button.type = "button"; button.dataset.id = visit.id;
    button.setAttribute("aria-label", `${visit.title || domain(visit.url)}, ${date(visit.at)}${visit.liveTabId ? ", open tab" : ""}`);
    return button;
  }
  function select(id, focus = false) {
    selected = id;
    for (const button of nodesLayer.children) {
      button.classList.toggle("selected", button.dataset.id === id);
      button.setAttribute("aria-pressed", String(button.dataset.id === id));
    }
    const ancestors = new Set(); let node = visits.find(n => n.id === id);
    while (node && !ancestors.has(node.id)) { ancestors.add(node.id); node = visits.find(n => n.id === node.parent); }
    for (const edge of edgesLayer.querySelectorAll("path")) edge.classList.toggle("traced", ancestors.has(edge.dataset.to));
    showDetails();
    if (focus) {
      const n = graph.nodes.find(n => n.id === id);
      if (n) { camera.x = viewport.clientWidth / 2 - n.x * camera.zoom; camera.y = viewport.clientHeight / 2 - n.y * camera.zoom; transform(); }
      nodesLayer.querySelector(`[data-id="${id}"]`)?.focus({ preventScroll: true });
    }
  }
  async function openVisit(id) {
    const result = await browser.openHistory(id);
    if (result) close();
  }
  function showDetails() {
    inspector.replaceChildren();
    const visit = visits.find(n => n.id === selected);
    if (!visit) {
      inspector.append(element("span", "history-eyebrow", "YOUR BROWSING JOURNEY"), element("h2", "", "Follow the thread."), element("p", "", "Every star is a page you visited. Lines trace where you went next, preserving each fork along the way."), element("p", "history-muted", "Select a star to inspect it. Double-click to open. Drag stars to arrange your constellation."));
      return;
    }
    inspector.append(element("span", "history-eyebrow", visit.liveTabId ? "✦ OPEN IN A TAB" : "✧ SAVED VISIT"), element("h2", "", visit.title || domain(visit.url)), element("p", "history-url", visit.url), element("p", "history-muted", date(visit.at)));
    const open = element("button", "history-primary", visit.liveTabId ? "Return to this tab ↗" : "Open page in a new tab ↗");
    open.onclick = () => openVisit(visit.id); inspector.append(open);
    const children = visits.filter(n => n.parent === visit.id);
    const parent = visits.find(n => n.id === visit.parent);
    function related(label, nodes) {
      if (!nodes.length) return;
      inspector.append(element("h3", "", label));
      for (const n of nodes) {
        const button = element("button", "history-related", (n.kind === "new-tab" ? "↗ " : "✦ ") + (n.title || domain(n.url)));
        button.onclick = () => { collapsed.delete(visit.id); render(); select(n.id, true); }; inspector.append(button);
      }
    }
    related("ARRIVED FROM", parent ? [parent] : []);
    related("TRAVERSED TO · " + children.length, children);
    if (children.length) {
      const fold = element("button", "history-secondary", collapsed.has(visit.id) ? "Expand this branch" : "Collapse this branch");
      fold.onclick = () => { collapsed.has(visit.id) ? collapsed.delete(visit.id) : collapsed.add(visit.id); render(); save(); }; inspector.append(fold);
    }
    inspector.append(element("p", "history-muted", "Saved title, address and visit time. Opening a past visit loads the page as it exists now."));
  }
  function drawEdges() {
    edgesLayer.replaceChildren();
    const defs = svg("defs", {}), marker = svg("marker", { id: "history-arrow", viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: "auto" });
    marker.append(svg("path", { d: "M0 0 L10 5 L0 10", fill: "#7593b6" })); defs.append(marker); edgesLayer.append(defs);
    const byId = new Map(graph.nodes.map(n => [n.id, n]));
    for (const edge of graph.edges) {
      const a = byId.get(edge.from), b = byId.get(edge.to);
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
      const line = svg("path", { d: `M${a.x + dx / length * 22} ${a.y + dy / length * 22} L${b.x - dx / length * 27} ${b.y - dy / length * 27}`, "marker-end": "url(#history-arrow)", class: edge.kind === "new-tab" ? "new-tab-edge" : "" });
      line.dataset.to = edge.to; edgesLayer.append(line);
    }
  }
  function render() {
    if (root.hidden || gesture) return;
    const focused = document.activeElement?.dataset.id;
    graph = layoutHistory(visits, { query: search.value.trim(), collapsed, positions });
    nodesLayer.replaceChildren(); list.replaceChildren();
    for (const n of graph.nodes) {
      const button = nodeButton(n, "history-star" + (n.liveTabId ? " live" : "") + (!n.matched ? " ancestor" : ""));
      button.style.left = n.x + "px"; button.style.top = n.y + "px";
      button.style.setProperty("--star-hue", String([...n.journey].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 100 + 175));
      const glyph = element("span", "history-star-light", "✦"); glyph.setAttribute("aria-hidden", "true");
      button.append(glyph, element("strong", "", n.title || domain(n.url)), element("span", "history-star-domain", domain(n.url)), element("small", "", n.liveTabId ? "● OPEN TAB" : new Date(n.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })));
      if (collapsed.has(n.id)) button.append(element("span", "history-folded", "+ branch"));
      button.onclick = () => { if (!suppressClick) select(n.id); };
      button.ondblclick = () => openVisit(n.id);
      button.onkeydown = event => {
        if (event.key === "Enter") { event.preventDefault(); openVisit(n.id); }
        const target = event.key === "ArrowLeft" ? n.parent : event.key === "ArrowRight" ? n.children[0] : null;
        if (target) { event.preventDefault(); select(target, true); }
      };
      nodesLayer.append(button);
      const row = nodeButton(n, "history-list-row");
      row.append(element("span", "", "✦ " + (n.title || n.url)), element("small", "", `${domain(n.url)} · ${date(n.at)}${n.liveTabId ? " · Open tab" : ""}`));
      row.onclick = () => select(n.id); row.onkeydown = event => { if (event.key === "Enter") { event.preventDefault(); openVisit(n.id); } }; row.ondblclick = () => openVisit(n.id); list.append(row);
    }
    count.textContent = search.value ? `${graph.matches} matching visits · ${graph.nodes.length} stars with context` : `${visits.length} visits · ${graph.edges.length} visible connections`;
    empty.hidden = graph.nodes.length > 0;
    empty.textContent = visits.length ? "No matching visits. Try a different page title or address." : "Your constellation begins with your next page. Browse normally to trace your journey.";
    drawEdges(); select(selected); transform();
    if (focused) nodesLayer.querySelector(`[data-id="${focused}"]`)?.focus({ preventScroll: true });
  }
  function transform() {
    scene.style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`;
    root.querySelector(".history-zoom").textContent = Math.round(camera.zoom * 100) + "%";
    const bounds = graphBounds(graph.nodes);
    mini.setAttribute("viewBox", `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
    mini.replaceChildren();
    for (const n of graph.nodes) mini.append(svg("circle", { cx: n.x, cy: n.y, r: 7, fill: n.liveTabId ? "#c7f6ff" : "#768ea9" }));
    mini.append(svg("rect", { x: -camera.x / camera.zoom, y: -camera.y / camera.zoom, width: viewport.clientWidth / camera.zoom, height: viewport.clientHeight / camera.zoom, fill: "#79cfff10", stroke: "#a7dfff", "stroke-width": 2, "vector-effect": "non-scaling-stroke" }));
  }
  function fit() {
    const b = graphBounds(graph.nodes);
    camera.zoom = Math.max(.15, Math.min(1.15, (viewport.clientWidth - 60) / b.width, (viewport.clientHeight - 80) / b.height));
    camera.x = (viewport.clientWidth - b.width * camera.zoom) / 2 - b.x * camera.zoom;
    camera.y = (viewport.clientHeight - b.height * camera.zoom) / 2 - b.y * camera.zoom;
    transform(); save();
  }
  function zoom(factor, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) { camera = zoomAt(camera, factor, x, y); transform(); save(); }
  viewport.addEventListener("wheel", event => { event.preventDefault(); const r = viewport.getBoundingClientRect(); zoom(Math.exp(-event.deltaY * .0015), event.clientX - r.left, event.clientY - r.top); }, { passive: false });
  viewport.addEventListener("pointerdown", event => {
    if (event.button !== 0 && event.button !== 1) return;
    const id = event.target.closest(".history-star")?.dataset.id;
    const node = graph.nodes.find(n => n.id === id);
    gesture = { id, node, x: event.clientX, y: event.clientY, initial: node ? { x: node.x, y: node.y } : { ...camera }, moved: false };
    suppressClick = false;
    // Keep ordinary button clicks on their target; capture only after a drag starts.
  });
  viewport.addEventListener("pointermove", event => {
    if (!gesture) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (Math.hypot(dx, dy) < 4 && !gesture.moved) return;
    gesture.moved = true; suppressClick = true; viewport.setPointerCapture(event.pointerId);
    if (gesture.node) {
      gesture.node.x = gesture.initial.x + dx / camera.zoom; gesture.node.y = gesture.initial.y + dy / camera.zoom;
      positions[gesture.id] = { x: gesture.node.x, y: gesture.node.y };
      const button = nodesLayer.querySelector(`[data-id="${gesture.id}"]`);
      button.style.left = gesture.node.x + "px"; button.style.top = gesture.node.y + "px"; drawEdges();
    } else { camera.x = gesture.initial.x + dx; camera.y = gesture.initial.y + dy; }
    transform();
  });
  function endGesture(event) { if (!gesture) return; const moved = gesture.moved; gesture = null; if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId); save(); if (moved) render(); }
  viewport.addEventListener("pointerup", endGesture); viewport.addEventListener("pointercancel", endGesture);
  viewport.addEventListener("pointerleave", event => { if (gesture && !gesture.moved) endGesture(event); });
  mini.onclick = event => {
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(mini.getScreenCTM().inverse());
    camera.x = viewport.clientWidth / 2 - point.x * camera.zoom; camera.y = viewport.clientHeight / 2 - point.y * camera.zoom; transform(); save();
  };
  root.querySelector('[data-history="fit"]').onclick = fit;
  root.querySelector('[data-history="plus"]').onclick = () => zoom(1.2);
  root.querySelector('[data-history="minus"]').onclick = () => zoom(1 / 1.2);
  root.querySelector('[data-history="close"]').onclick = close;
  root.querySelector('[data-history="list"]').onclick = event => {
    listMode = !listMode; root.classList.toggle("list-mode", listMode);
    event.target.textContent = listMode ? "Constellation" : "List"; event.target.setAttribute("aria-pressed", String(listMode));
  };
  const confirmation = root.querySelector(".history-clear-confirm");
  root.querySelector('[data-history="clear"]').onclick = () => { confirmation.hidden = false; confirmation.querySelector("button").focus(); };
  root.querySelector('[data-history="cancel-clear"]').onclick = () => { confirmation.hidden = true; root.querySelector('[data-history="clear"]').focus(); };
  root.querySelector('[data-history="confirm-clear"]').onclick = async () => {
    await browser.clearHistory(); positions = {}; collapsed.clear(); selected = null; confirmation.hidden = true; save(); render(); fit(); search.focus();
  };
  confirmation.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.stopPropagation(); confirmation.hidden = true; root.querySelector('[data-history="clear"]').focus(); }
    if (event.key === "Tab") {
      event.preventDefault();
      const buttons = [...confirmation.querySelectorAll("button")];
      buttons[(buttons.indexOf(document.activeElement) + 1) % buttons.length].focus();
    }
  });
  search.oninput = () => { render(); fit(); };
  root.addEventListener("keydown", event => {
    if (event.target.matches("input")) return;
    if (event.key.toLowerCase() === "f") { event.preventDefault(); fit(); }
    if (event.key === "+" || event.key === "=") { event.preventDefault(); zoom(1.2); }
    if (event.key === "-") { event.preventDefault(); zoom(1 / 1.2); }
    if (event.target === viewport && event.key.startsWith("Arrow")) {
      event.preventDefault(); camera.x += event.key === "ArrowLeft" ? 60 : event.key === "ArrowRight" ? -60 : 0;
      camera.y += event.key === "ArrowUp" ? 60 : event.key === "ArrowDown" ? -60 : 0; transform(); save();
    }
  });
  new ResizeObserver(() => { if (!root.hidden) transform(); }).observe(viewport);
  let receivedUpdate = false;
  browser.onHistoryUpdated(payload => { receivedUpdate = true; visits = payload; render(); });
  browser.getHistory().then(payload => { if (!receivedUpdate) visits = payload; render(); });
  function open() {
    root.hidden = false; onVisibilityChange(true); render(); if (!saved) { fit(); saved = true; } search.focus();
  }
  function close() { if (root.hidden) return; root.hidden = true; save(); onVisibilityChange(false); document.getElementById("history-toggle").focus(); }
  return { open, close, toggle: () => root.hidden ? open() : close(), isOpen: () => !root.hidden };
}
