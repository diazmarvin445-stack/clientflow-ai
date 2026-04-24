# Order PDF receipt (Recibo) — implementation report

## Goal

Client receipts must be generated **automatically** from the selected order in **Pedidos**, plus **fixed business branding**. Staff must **not** type invoice fields, and the PDF must **not** show internal costs or profit.

## Business branding (config)

**Primary:** editable in **Configuración → Personalizar recibo**, stored in Firestore at `businesses/{businessId}/settings/receipt`. See **`docs/receipt_settings_customization_report.md`**.

**Fallback defaults** (when no doc or field missing) are in **`receipt-settings.js`** (`RECEIPT_SETTINGS_DEFAULTS`), seeded from **`receipt-config.js`**.

## Order fields on the PDF

Data is read from the Firestore order document already loaded in **`pedidos.js`** (same objects as the table/cards):

| PDF label            | Source (order fields)                          |
|----------------------|------------------------------------------------|
| Cliente              | `clientName`                                   |
| Teléfono             | `clientPhone`                                  |
| Producto             | `product`                                      |
| Cantidad             | `quantity`                                     |
| Total                | `total` or `amount` (`getOrderTotal` logic)    |
| Depósito             | `deposit`                                      |
| Saldo                | `balance`, or `total − deposit` if missing   |
| Fecha de entrega     | `deliveryDate` (Firestore `Timestamp` or date) |
| No. de recibo        | Firestore document id (`row.id`)              |

Order **status** is intentionally **not** shown on the client receipt.

**Not included:** `expenses`, net profit, projected profit, or any finance line meant for internal use.

## PDF generation

- **Module:** `receipt-pdf.js` exports `generateOrderReceiptPdf(row, biz)` where `biz` comes from **`getReceiptPdfBusiness(db, businessId)`** (`receipt-settings.js`).  
- **Library:** [jsPDF](https://github.com/parallax/jsPDF) **2.5.1** UMD from CDN (`jspdf.umd.min.js` in `pedidos.html`, before `pedidos.js`). `receipt-pdf.js` uses `globalThis.jspdf.jsPDF` so GitHub Pages does not need a bundler. See `docs/pedidos_module_fix_report.md`.  
- **Output:** download `recibo-<orderId>.pdf` via `save()`.

## UI: where to generate the receipt

1. **Desktop table:** actions column — **📄** icon button (`data-receipt`), tooltip “📄 Recibo PDF”.  
2. **Mobile cards:** **📄 Recibo** button in the card actions.  
3. **Order detail panel:** **📄 Recibo** next to other actions (uses the currently selected order).

Clicks call `generateOrderReceiptPdf` with **no** prompts and **no** manual invoice form.

## Files touched

| File                 | Role                                                |
|----------------------|-----------------------------------------------------|
| `receipt-config.js`  | Defaults seed + `receiptStatusLabel` (orders UI)   |
| `receipt-settings.js`| Firestore `settings/receipt` + merge for PDF        |
| `receipt-pdf.js`     | Build and download the client PDF                   |
| `pedidos.js`         | Loads settings + generates PDF                      |
| `pedidos.html`       | jsPDF UMD + module                                  |
| `configuracion.*`    | “Personalizar recibo” UI                            |

## Operational notes

- Set **`RECEIPT_BUSINESS.email`** when you have a public contact address you want on every receipt.  
- For a real logo file, add a PNG/JPEG under the static site (e.g. `assets/...`) and set **`logoUrl`** to a path reachable from the page (e.g. `assets/yourcolor-logo.png`).  
- If PDF generation fails (offline, CDN blocked), the user sees an alert suggesting connectivity; check the browser console for the underlying error.
