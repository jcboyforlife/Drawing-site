/* ==========================================================================
   SKETCH — Drawing App Logic
   --------------------------------------------------------------------------
   This file is organized into clearly labeled sections:
     1. Grab references to DOM elements
     2. Set up the canvas (including high-resolution / retina support)
     3. State: what tool is selected, what color, what brush size
     4. Drawing logic (mouse + touch)
     5. Undo / Redo history
     6. Toolbar & settings panel interactions
     7. Clear canvas
     8. Download as PNG
     9. Init (runs everything on page load)
   Every function has a short comment explaining WHY it exists, not just
   what it does — the goal is that a beginner can follow the reasoning.
   ========================================================================== */


/* ----------------------------------------------------------------------
   1. DOM REFERENCES
   Grabbing every element we'll need once, up front, so the rest of the
   code can refer to short variable names instead of repeating querySelector.
   ---------------------------------------------------------------------- */
const canvas = document.getElementById('drawingCanvas');
const ctx = canvas.getContext('2d');
const canvasCard = document.querySelector('.canvas-card');

const pencilTool = document.getElementById('pencilTool');
const eraserTool = document.getElementById('eraserTool');

const colorPicker = document.getElementById('colorPicker');
const swatchesContainer = document.getElementById('swatches');

const brushSize = document.getElementById('brushSize');
const brushSizeMini = document.getElementById('brushSizeMini');
const brushSizeLabel = document.getElementById('brushSizeLabel');
const brushPreview = document.getElementById('brushPreview');

const clearBtn = document.getElementById('clearBtn');
const downloadBtn = document.getElementById('downloadBtn');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');


/* ----------------------------------------------------------------------
   2. CANVAS SETUP
   Canvas elements have two sizes: their CSS display size (how big they
   LOOK on the page) and their internal drawing resolution (how many
   actual pixels they have to draw on). If we only set the CSS size, the
   canvas gets blurry on high-resolution (retina) screens. To fix this we
   multiply by `devicePixelRatio` and scale the drawing context to match.
   ---------------------------------------------------------------------- */

/**
 * Resizes the canvas's internal pixel resolution to match how large it is
 * currently being displayed on screen, while preserving whatever was
 * already drawn (so resizing the browser window doesn't erase the art).
 */
function resizeCanvas() {
  // Save the current drawing as an image before we resize, because
  // changing canvas.width/height instantly clears the canvas.
  const previousDrawing = canvas.toDataURL();

  const dpr = window.devicePixelRatio || 1;
  const displayWidth = canvasCard.clientWidth - 16; // minus the card's padding
  const displayHeight = canvasCard.clientHeight - 16;

  // The canvas's CSS size (controlled by style.css) stays at 100%,
  // but we set its true pixel dimensions here, scaled for sharpness.
  canvas.width = displayWidth * dpr;
  canvas.height = displayHeight * dpr;

  // Scale the drawing context so that 1 unit we draw = 1 CSS pixel,
  // even though the canvas itself has more actual pixels than that.
  ctx.scale(dpr, dpr);

  // Lines should have round ends/joins so pencil strokes look natural
  // rather than blocky at corners.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Restore whatever was drawn before the resize.
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, displayWidth, displayHeight);
  };
  img.src = previousDrawing;
}


/* ----------------------------------------------------------------------
   3. APP STATE
   A single object holding "what is currently true" about the drawing
   tool — keeping it in one place avoids scattering loose variables.
   ---------------------------------------------------------------------- */
const state = {
  tool: 'pencil',       // 'pencil' or 'eraser'
  color: '#5b5fef',     // current stroke color
  size: 6,              // current brush thickness in pixels
  isDrawing: false,     // true while the mouse/finger is held down
  lastX: 0,             // last known X position, used to draw line segments
  lastY: 0,
};

// A curated set of preset colors — enough variety for a portfolio demo,
// without overwhelming the settings panel.
const PRESET_COLORS = [
  '#1f2430', '#ef4444', '#f59e0b', '#22c55e',
  '#3b82f6', '#5b5fef', '#ec4899', '#ffffff',
];


/* ----------------------------------------------------------------------
   4. DRAWING LOGIC
   The core idea: on "pointer down" we remember the starting position and
   start a new path. On "pointer move" (while held down) we draw a line
   from the last position to the current one, then update the last
   position. This is what makes a series of short segments look like one
   continuous stroke, no matter how fast the mouse moves.
   ---------------------------------------------------------------------- */

/** Converts a mouse or touch event into canvas-relative x/y coordinates. */
function getCanvasCoordinates(event) {
  const rect = canvas.getBoundingClientRect();
  // Support both mouse events and touch events in one function.
  const clientX = event.touches ? event.touches[0].clientX : event.clientX;
  const clientY = event.touches ? event.touches[0].clientY : event.clientY;

  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

/** Begins a new stroke when the user presses down on the canvas. */
function startDrawing(event) {
  state.isDrawing = true;
  const { x, y } = getCanvasCoordinates(event);
  state.lastX = x;
  state.lastY = y;

  // Draw a single dot immediately, so a simple click (with no movement)
  // still leaves a visible mark instead of doing nothing.
  drawLineSegment(x, y, x, y);
}

/** Draws a line segment as the user moves while pressing down. */
function draw(event) {
  if (!state.isDrawing) return;
  event.preventDefault(); // stops touchscreens from scrolling the page

  const { x, y } = getCanvasCoordinates(event);
  drawLineSegment(state.lastX, state.lastY, x, y);
  state.lastX = x;
  state.lastY = y;
}

/** Ends the current stroke and saves a snapshot for undo/redo. */
function stopDrawing() {
  if (!state.isDrawing) return;
  state.isDrawing = false;
  saveHistorySnapshot();
}

/**
 * The actual pixel-drawing function. Both the pencil and the eraser use
 * this — the only difference is the composite mode and color, which is
 * decided by whichever tool is currently selected.
 */
function drawLineSegment(fromX, fromY, toX, toY) {
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.lineWidth = state.size;

  if (state.tool === 'eraser') {
    // 'destination-out' makes new drawing erase existing pixels instead
    // of painting over them — this is what makes an eraser an eraser
    // rather than just "drawing in white".
    ctx.globalCompositeOperation = 'destination-out';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = state.color;
  }

  ctx.stroke();
}


/* ----------------------------------------------------------------------
   5. UNDO / REDO HISTORY
   Approach: keep an array of full canvas snapshots (as data URLs), plus
   a pointer to where in that array we currently are. Undo moves the
   pointer back and redraws; Redo moves it forward. Drawing a new stroke
   after undoing discards any "future" redo states, which matches how
   undo/redo works in most real apps.
   ---------------------------------------------------------------------- */
const history = {
  stack: [],
  pointer: -1,
  maxSize: 30, // cap how many snapshots we keep, to limit memory use
};

/** Saves the current canvas as a new history entry. */
function saveHistorySnapshot() {
  // If the user had undone some steps and then drew something new,
  // remove the "redo" states that are now invalid.
  history.stack = history.stack.slice(0, history.pointer + 1);

  history.stack.push(canvas.toDataURL());
  if (history.stack.length > history.maxSize) {
    history.stack.shift(); // drop the oldest snapshot to save memory
  } else {
    history.pointer++;
  }

  updateUndoRedoButtons();
}

/** Loads a given history snapshot back onto the canvas. */
function restoreHistorySnapshot(index) {
  const dataUrl = history.stack[index];
  const img = new Image();
  img.onload = () => {
    const dpr = window.devicePixelRatio || 1;
    // Clear using the CSS (display) size, since the context is already
    // scaled by devicePixelRatio.
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.drawImage(img, 0, 0, canvas.width / dpr, canvas.height / dpr);
  };
  img.src = dataUrl;
}

function undo() {
  if (history.pointer <= 0) return;
  history.pointer--;
  restoreHistorySnapshot(history.pointer);
  updateUndoRedoButtons();
}

function redo() {
  if (history.pointer >= history.stack.length - 1) return;
  history.pointer++;
  restoreHistorySnapshot(history.pointer);
  updateUndoRedoButtons();
}

/** Enables/disables the Undo and Redo buttons based on our position in history. */
function updateUndoRedoButtons() {
  undoBtn.disabled = history.pointer <= 0;
  redoBtn.disabled = history.pointer >= history.stack.length - 1;
}


/* ----------------------------------------------------------------------
   6. TOOLBAR & SETTINGS PANEL INTERACTIONS
   ---------------------------------------------------------------------- */

/** Switches the active tool and updates which button looks "selected". */
function selectTool(toolName) {
  state.tool = toolName;
  pencilTool.classList.toggle('active', toolName === 'pencil');
  eraserTool.classList.toggle('active', toolName === 'eraser');

  // While erasing, the cursor becomes a circle-outline hint isn't built
  // in by default, so we keep the crosshair cursor for both tools —
  // simple and consistent.
}

/** Builds the row of preset color swatches from the PRESET_COLORS array. */
function renderSwatches() {
  PRESET_COLORS.forEach((hex) => {
    const swatchBtn = document.createElement('button');
    swatchBtn.className = 'swatch';
    swatchBtn.style.backgroundColor = hex;
    swatchBtn.style.border = hex === '#ffffff' ? '2px solid #e4e4ea' : '';
    swatchBtn.setAttribute('aria-label', `Select color ${hex}`);
    if (hex === state.color) swatchBtn.classList.add('active');

    swatchBtn.addEventListener('click', () => {
      setColor(hex);
      // Move the "active" ring to whichever swatch was just clicked.
      document.querySelectorAll('.swatch').forEach((el) => el.classList.remove('active'));
      swatchBtn.classList.add('active');
    });

    swatchesContainer.appendChild(swatchBtn);
  });
}

/** Updates the current color everywhere it needs to be reflected. */
function setColor(hex) {
  state.color = hex;
  colorPicker.value = hex;
  updateBrushPreview();

  // Picking a color while the eraser is active doesn't make sense visually,
  // so switch back to the pencil automatically — this avoids a confusing
  // "I picked a color but nothing changed" moment for the user.
  if (state.tool === 'eraser') selectTool('pencil');
}

/** Updates the brush size and keeps both sliders (toolbar + panel) in sync. */
function setBrushSize(newSize) {
  state.size = Number(newSize);
  brushSize.value = state.size;
  brushSizeMini.value = state.size;
  brushSizeLabel.textContent = `${state.size}px`;
  updateBrushPreview();
}

/** Resizes and recolors the little preview dot in the settings panel. */
function updateBrushPreview() {
  const previewSize = Math.min(state.size, 48); // cap so huge brushes don't overflow the box
  brushPreview.style.width = `${previewSize}px`;
  brushPreview.style.height = `${previewSize}px`;
  brushPreview.style.backgroundColor = state.tool === 'eraser' ? '#c7c9d1' : state.color;
}


/* ----------------------------------------------------------------------
   7. CLEAR CANVAS
   ---------------------------------------------------------------------- */
function clearCanvas() {
  const confirmed = window.confirm('Clear the whole canvas? This cannot be undone once you draw again.');
  if (!confirmed) return;

  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  saveHistorySnapshot();
}


/* ----------------------------------------------------------------------
   8. DOWNLOAD AS PNG
   ---------------------------------------------------------------------- */
function downloadDrawing() {
  // Create a temporary link element, point it at the canvas image data,
  // click it programmatically, then discard it. This is the standard
  // trick for triggering a file download from JavaScript alone.
  const link = document.createElement('a');
  link.download = `sketch-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}


/* ----------------------------------------------------------------------
   9. INIT
   Wires up every event listener and runs first-time setup. Kept at the
   bottom so all the functions above are already defined when this runs.
   ---------------------------------------------------------------------- */
function init() {
  // --- Canvas sizing ---
  resizeCanvas();
  // Debounce resize handling slightly so we're not resizing on every
  // single pixel while the user drags the browser window edge.
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(resizeCanvas, 150);
  });

  // --- Drawing events (mouse) ---
  canvas.addEventListener('mousedown', startDrawing);
  canvas.addEventListener('mousemove', draw);
  window.addEventListener('mouseup', stopDrawing); // window, so releasing outside the canvas still registers

  // --- Drawing events (touch, for tablets/phones) ---
  canvas.addEventListener('touchstart', startDrawing, { passive: false });
  canvas.addEventListener('touchmove', draw, { passive: false });
  canvas.addEventListener('touchend', stopDrawing);

  // --- Tool buttons ---
  pencilTool.addEventListener('click', () => selectTool('pencil'));
  eraserTool.addEventListener('click', () => {
    selectTool('eraser');
    updateBrushPreview();
  });

  // --- Color controls ---
  renderSwatches();
  colorPicker.addEventListener('input', (e) => setColor(e.target.value));

  // --- Brush size controls (kept in sync between toolbar and panel) ---
  brushSize.addEventListener('input', (e) => setBrushSize(e.target.value));
  brushSizeMini.addEventListener('input', (e) => setBrushSize(e.target.value));

  // --- Action buttons ---
  clearBtn.addEventListener('click', clearCanvas);
  downloadBtn.addEventListener('click', downloadDrawing);
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);

  // --- Keyboard shortcuts: Ctrl/Cmd+Z to undo, Ctrl/Cmd+Y (or Shift+Z) to redo ---
  window.addEventListener('keydown', (e) => {
    const cmdOrCtrl = e.ctrlKey || e.metaKey;
    if (!cmdOrCtrl) return;

    if (e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
      e.preventDefault();
      redo();
    }
  });

  // --- First-time visual setup ---
  setBrushSize(state.size);
  saveHistorySnapshot(); // save the initial blank canvas so "undo" has somewhere to go back to
}

// Run everything once the page has loaded.
init();
