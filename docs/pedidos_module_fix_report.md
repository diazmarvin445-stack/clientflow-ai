# Pedidos module fix — `@babel/runtime` / jsPDF on plain HTML

## Symptom

The Pedidos page failed at runtime with:

`Failed to resolve module specifier '@babel/runtime/helpers/typeof'`

## Cause

`receipt-pdf.js` imported jsPDF from the **npm ES build** (`jspdf.es.min.js` on jsDelivr). That bundle is intended for bundlers and pulls **bare specifiers** (e.g. `@babel/runtime/...`) that **browsers cannot resolve** on GitHub Pages (no Vite/Webpack/Babel).

## Fix

1. **Stop importing jsPDF as an ES module** from npm/CDN ESM.
2. **Load the UMD build** in `pedidos.html` **before** the `pedidos.js` module:

   ```html
   <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
   <script type="module" src="pedidos.js"></script>
   ```

3. In **`receipt-pdf.js`**, obtain the constructor from the global:

   - `const { jsPDF } = globalThis.jspdf` (via a small `getJsPDF()` helper that validates the global exists).

4. **`pedidos.js`** keeps only **browser-safe** `import`s: Firebase from `gstatic` URLs and local `./` modules (`firebase.js`, `dash-shell.js`, `receipt-config.js`, `receipt-pdf.js`). No npm-style specifiers.

5. **Smoke signal:** `pedidos.js` logs `Pedidos fixed and loading correctly` at the start of `boot()` so you can confirm the module graph loads in DevTools.

## What was not changed

- Order CRUD, filters, table/mobile UI, Firebase listeners, and receipt button wiring are unchanged aside from how jsPDF is loaded.

## Files touched

| File | Change |
|------|--------|
| `pedidos.html` | UMD `<script>` for jsPDF before the module |
| `receipt-pdf.js` | Remove ESM import; use `globalThis.jspdf.jsPDF` |
| `pedidos.js` | `console.log` in `boot()` |
| `docs/pedidos_module_fix_report.md` | This document |
