# Public order tracking link

## URL

- **`pedido.html?id={publicOrderId}`** — `id` is an opaque **32-character hex token** (not the Firestore order document id). Same token is stored as `publicOrderId` on the order and as the document id under **`orderPublicViews`**.

## Firestore

| Location | Purpose |
|----------|---------|
| `businesses/{businessId}/orders/{orderId}` | Fields `publicOrderId`, `publicLink` (full URL) |
| `orderPublicViews/{publicOrderId}` | Public-safe snapshot: status, client name, product, totals, payment hint, delivery date, `publicLink` |

**Rules:** `orderPublicViews` allows **unauthenticated `get`** by id only (`list` denied). Creates/updates/deletes are restricted to the business owner (`isBusinessOwner`).

## Backend (Cloud Functions)

- **`functions/order-public-tracking.js`**: `syncOrderPublicView`, `buildPublicOrderLink`, `deleteOrderPublicView`.
- **`processNewOrder`**: after creating the order, syncs public view and returns **`publicLink`** (used by HTTP `createManualOrder` and WhatsApp Maya flow).
- **`updateOrderAndSync`**, **`updateOrderStatus`**, **`finalizeOrderDeliveryAndProfit`**: refresh `orderPublicViews`.
- **`deleteOrderCascade`** and **`mayaDeleteOrderCascade`**: remove `orderPublicViews` when the order is deleted.

Default absolute origin for links from the server: **`https://clientflow-ai-7eb08.web.app`**. Override with env **`PUBLIC_ORDER_PAGE_ORIGIN`** if you use a custom domain.

## WhatsApp (Maya)

When a WhatsApp order is saved successfully, the outbound message appends:

`🔗 Tu recibo digital: {publicLink}`

## Panel (Pedidos)

- **`order-public-client.js`**: if an order has no `publicLink` yet, the owner can create the token + view (**`ensurePublicOrderTrackingClient`**) when generating the PDF or copying the link.
- **PDF receipt** (`receipt-pdf.js`): section **“Ver tu pedido en línea”** with a **clickable** URL (jsPDF `link()` per line for long URLs).
- **UI:** 🔗 in the table, **🔗 Copiar link** on mobile cards, **🔗 Copiar link** in the detail panel.

## Public page (`pedido.html` + `pedido.js`)

- No login; reads `orderPublicViews` only.
- Shows estado, cliente, producto, totales, estado de pago (texto), entrega, y texto de “vista previa” (el PDF con membrete sigue siendo del panel / WhatsApp).

## Deploy

Deploy **Firestore rules**, **Hosting** (`pedido.html`, JS, CSS), and **Functions** so `processNewOrder` and sync paths run in production.
