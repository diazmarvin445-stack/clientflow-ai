# Order PDF receipt (Recibo) — implementation report

## Goal

Client receipts must be generated **automatically** from the selected order in **Pedidos**, plus **fixed business branding**. Staff must **not** type invoice fields, and the PDF must **not** show internal costs or profit.

## Business branding (config)

Predefined values live in **`receipt-config.js`** (`RECEIPT_BUSINESS`):

- **Legal name:** YourColor Corporation  
- **Phone:** 772-212-3882  
- **Email:** optional (`email`); if left empty, no email line is printed on the header band  
- **Address lines:** Fort Pierce, FL; delivery area note (editable list)  
- **Logo:** optional `logoUrl` (PNG/JPEG, CORS-friendly or same-origin). If unset or load fails, a **“YC”** monogram is drawn in the PDF header  
- **Accent color:** RGB aligned with the app indigo (`brandRgb`)

To change branding globally, edit **`receipt-config.js`** only.

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
| Estado del pedido    | `status` (Spanish labels via `receiptStatusLabel`) |
| No. de recibo        | Firestore document id (`row.id`)              |

**Not included:** `expenses`, net profit, projected profit, or any finance line meant for internal use.

## PDF generation

- **Module:** `receipt-pdf.js` exports `generateOrderReceiptPdf(row, RECEIPT_BUSINESS)`  
- **Library:** [jsPDF](https://github.com/parallax/jsPDF) **2.5.2** loaded as an ES module from jsDelivr (`dist/jspdf.es.min.js`). The browser needs network access the first time the module is loaded.  
- **Output:** download `recibo-<orderId>.pdf` via `save()`.

## UI: where to generate the receipt

1. **Desktop table:** actions column — **📄** icon button (`data-receipt`), tooltip “📄 Recibo PDF”.  
2. **Mobile cards:** **📄 Recibo** button in the card actions.  
3. **Order detail panel:** **📄 Recibo** next to other actions (uses the currently selected order).

Clicks call `generateOrderReceiptPdf` with **no** prompts and **no** manual invoice form.

## Files touched

| File                 | Role                                                |
|----------------------|-----------------------------------------------------|
| `receipt-config.js`  | Reusable business constants + status labels         |
| `receipt-pdf.js`     | Build and download the client PDF                   |
| `pedidos.js`         | Buttons + handlers; imports receipt modules         |
| `pedidos.html`       | Detail panel “📄 Recibo” button                     |

## Operational notes

- Set **`RECEIPT_BUSINESS.email`** when you have a public contact address you want on every receipt.  
- For a real logo file, add a PNG/JPEG under the static site (e.g. `assets/...`) and set **`logoUrl`** to a path reachable from the page (e.g. `assets/yourcolor-logo.png`).  
- If PDF generation fails (offline, CDN blocked), the user sees an alert suggesting connectivity; check the browser console for the underlying error.
