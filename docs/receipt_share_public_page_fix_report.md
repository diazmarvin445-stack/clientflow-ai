# Receipt share + public digital receipt page

## Problem

The **Compartir** action in Pedidos shared only **`https://your-color.com`**, so customers did not get a link to their specific receipt.

## Solution overview

1. **Public page** **`recibo.html`** — Loads a **customer-safe snapshot** from Firestore (not the private order document, which remains owner-only under existing rules).

2. **Collection `receiptPublic`** — Document id **`{businessId}__{orderId}`**. Contains branding + order + payment fields only (no expenses, net profit, or labor). **Anyone with the URL can read that document** (intended for sharing).

3. **Owner sync** — When the owner opens the receipt modal or taps **Compartir**, **`syncReceiptPublicSnapshot`** (in **`receipt-public-sync.js`**) writes/updates the snapshot so the public link works.

4. **Share URL** — Built as:

   `recibo.html?id={orderId}&b={businessId}`

   (relative to the site origin, e.g. `new URL("recibo.html", window.location.href)`).

   The **`b`** query parameter is required so the app knows which business the order belongs to (multi-tenant). The **`id`** parameter is the Firestore order document id, as requested.

5. **Web Share API** — Uses:

   - `title`: `Recibo YourColor`
   - `text`: `Aquí está tu recibo digital de YourColor Corporation.`
   - `url`: full **`recibo.html?...`** link

   Fallback: copy **`url`** to the clipboard, or show **“Compartir no disponible en este dispositivo.”**

6. **Public page contents** — Logo, business name/contact/address from the snapshot, fixed link **`https://your-color.com`** (“Visitar YourColor”), order details, payment block (total, deposit, balance), **Descargar PDF** (same **`generateOrderReceiptPdf`** pipeline as Pedidos).

7. **Cleanup** — **`deleteOrderCascade`** and **`mayaDeleteOrderCascade`** (Cloud Functions) delete **`receiptPublic/{businessId}__{orderId}`** when the order is removed.

## Files touched

| File | Role |
|------|------|
| **`receipt-public-sync.js`** | Build payload, doc id, `syncReceiptPublicSnapshot` |
| **`recibo.html` / `recibo.js`** | Public receipt UI + PDF button |
| **`pedidos.js`** | Sync on modal open; share uses receipt URL |
| **`firestore.rules`** | `receiptPublic` rules: public `get`, owner write/delete |
| **`functions/index.js`** | Delete public snapshot on order delete |

## Confirmation: marketing site link

The receipt page still shows the visible storefront link:

**`https://your-color.com`**

(as **`Visitar YourColor`** in **`recibo.html`**).

## Deploy

Publish **Firestore rules**, **Hosting** (`recibo.html`, `recibo.js`, `receipt-public-sync.js`, `pedidos.js`, `styles.css`), and **Functions** so deletes stay in sync with the new collection.
