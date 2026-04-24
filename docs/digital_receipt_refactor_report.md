# Digital receipt refactor report

## What was removed (broken public flow)

- **`pedido.html` / `pedido.js`** — Standalone public page that read `orderPublicViews/{token}` and often led to **404** or stale hosting when users opened `pedido.html?id=…`.
- **`order-public-client.js`** — Client-side helpers that created **`publicOrderId`**, **`publicLink`**, and wrote to **`orderPublicViews`** (used for the old “copy public link” / PDF merge flow).
- **`functions/order-public-tracking.js`** — Cloud sync: **`syncOrderPublicView`**, **`deleteOrderPublicView`**, and URLs built as **`…/pedido.html?id=…`**.
- **Firestore rules** — The **`orderPublicViews`** collection match block (public unauthenticated `get`) was removed so the product no longer depends on a public order snapshot.
- **Cloud Functions (`functions/index.js`)** — All calls to sync or delete public views were removed from **`processNewOrder`**, **`finalizeOrderDeliveryAndProfit`**, **`updateOrderStatus`**, **`updateOrderAndSync`**, **`deleteOrderCascade`**, and **`mayaDeleteOrderCascade`**. **`processNewOrder`** no longer returns **`publicLink`**. The Maya / WhatsApp line **“Tu recibo digital: {publicLink}”** was removed.
- **Pedidos UI** — Any **public order link** row, **“Copiar link”** control, and routing that sent people to the broken public page were removed in favor of the in-app receipt.
- **`styles.css`** — Styles for **`.pub-order-*`** and the old **`.orders-detail-public-link`** block were deleted as unused.

## How the digital receipt opens now

- In **Pedidos**, the receipt actions (**table/mobile 📄** and detail **📄 Recibo**) call **`openDigitalReceipt(row)`** in **`pedidos.js`**.
- That loads business data via **`getReceiptPdfBusiness`** (same source as PDF / receipt settings), fills **`#orders-receipt-modal`**, and opens a **`<dialog>`** modal.
- The sheet shows: logo (if configured), legal name, phone, email when set, address lines, and a **visible** site link (see below). Order fields are filled from the selected Firestore order: receipt/order id, client name/phone, product, quantity, total, deposit, balance, delivery date, **status** (via **`receiptStatusLabel`**). **Internal** fields (expenses, net profit, labor) are **not** shown on this customer-facing receipt.

## PDF (“Descargar PDF”)

- **Descargar PDF** in the modal calls **`downloadOrderReceiptPdf(receiptModalOrder)`**, which uses **`getReceiptPdfBusiness`** and **`generateOrderReceiptPdf`** from **`receipt-pdf.js`** — the same jsPDF pipeline as before, still driven by **`receipt-settings.js`** / Firestore receipt customization.
- The PDF remains **optional**: the user sees the on-screen receipt first; PDF is only generated when they tap the button.

## Share (“Compartir”)

- If **`navigator.share`** exists, the app calls:
  - `title`: `Recibo YourColor`
  - `text`: `Aquí está tu recibo de YourColor Corporation.`
  - `url`: **`https://your-color.com`** (from **`CLIENT_PUBLIC_WEBSITE_URL`** in **`receipt-config.js`**).
- If share fails (other than user **`AbortError`**), or Web Share is unavailable, the code falls back to **clipboard** (`text` + `url`) or the message **“Compartir no disponible en este dispositivo.”**

## Website link (fixed URL)

The customer-facing link used everywhere for this feature is:

**`https://your-color.com`**

- **Modal (`pedidos.html`)**: `<a href="https://your-color.com" target="_blank" rel="noopener">Visitar YourColor</a>` in the receipt header.
- **PDF (`receipt-pdf.js`)**: Clickable “Visitar YourColor” uses the same URL via **`CLIENT_PUBLIC_WEBSITE_URL`**.
- **Share**: Same URL in the Web Share payload.

## Styling

- New **`.orders-receipt-*`** rules in **`styles.css`** center the receipt “document,” keep typography readable on small screens, and include the modal in light/dark dialog theming alongside **`.orders-modal`**.

## Deploy notes

After pull/deploy, update **Firestore rules** in the Firebase console so **`orderPublicViews`** rules are gone in production. Existing documents under **`orderPublicViews`** are orphaned and can be deleted manually if desired; the app no longer reads or writes them.
