# Receipt share — final fix (publicReceipts + permissions)

## Problem

**Compartir** failed with `FirebaseError: Missing or insufficient permissions` when writing the old top-level **`receiptPublic`** snapshot (or rules / paths did not match production expectations). Customers need a stable link that works from WhatsApp.

## Approach (no public access to orders)

- **Do not** expose `businesses/{businessId}/orders/{orderId}` to the public.
- **Do** write a customer-only snapshot under:

  `businesses/{businessId}/publicReceipts/{receiptId}`

  where **`receiptId`** is an opaque UUID (stored on the order as **`publicReceiptId`** after the first publish).

## Fields stored on `publicReceipts`

Only customer-safe fields (as required):

- `receiptId` (must match document id; enforced in rules)
- `orderId`
- `businessName`
- `logoUrl`
- `phone`
- `website` — always **`https://your-color.com`**
- `clientName`, `clientPhone`, `product`, `quantity`
- `total`, `deposit`, `balance`
- `deliveryDate`, `status`
- `createdAt` — set once on first `setDoc`

**Not** stored: expenses, profit, labor, internal notes, or other order internals.

## Firestore rules

- Removed top-level **`receiptPublic`** rules.
- Under each **`businesses/{businessId}`**:
  - **`publicReceipts/{receiptId}`**: **`get`** allowed for anyone (public receipt by link); **`list`** denied.
  - **create / update**: authenticated business owner only; **`receiptId`** in data must equal path id; blocked keys include `expenses`, `netProfit`, `laborCost`, `notes`, etc.
  - **delete**: owner only (used when the order is deleted from Cloud Functions).

## Share URL (WhatsApp / Web Share)

Fixed public base (GitHub Pages):

**`https://diazmarvin445-stack.github.io/clientflow-ai/recibo.html?id={receiptId}`**

Defined as **`RECEIPT_SHARE_PAGE_BASE_URL`** in **`receipt-config.js`**.

## Public receipt page (`recibo.html`)

- Reads **`publicReceipts`** via **collection group** query: `where(documentId(), "==", receiptId)` (single doc).
- Does **not** read from **`orders`**.
- Shows logo, business name, phone, default address lines from **`RECEIPT_BUSINESS`** for layout, fixed **Visitar YourColor** → **`https://your-color.com`**, order + payment blocks, **Descargar PDF**.

## Desktop / share fallback

If **`navigator.share`** is missing or fails (other than user cancel), the app copies the receipt URL to the clipboard and shows:

**`Link del recibo copiado`**

## Cloud Functions

On order delete (**`deleteOrderCascade`** and **`mayaDeleteOrderCascade`**), if the order has **`publicReceiptId`**, delete:

`businesses/{businessId}/publicReceipts/{publicReceiptId}`

## Indexes

**`firestore.indexes.json`** includes a **collection group** index on **`publicReceipts`** for **`__name__`** so the public page query can run.

## Client code

| File | Change |
|------|--------|
| **`receipt-public-sync.js`** | `ensurePublicReceiptDocument` → writes nested **`publicReceipts`**, sets **`publicReceiptId`** on order once |
| **`pedidos.js`** | Share uses **`RECEIPT_SHARE_PAGE_BASE_URL`** + **`receiptId`**; fallback alert text updated |
| **`recibo.js`** | Loads via **`collectionGroup("publicReceipts")`** + **`documentId`** |
| **`receipt-config.js`** | **`RECEIPT_SHARE_PAGE_BASE_URL`** |
| **`firestore.rules`** | **`publicReceipts`** nested rules; **`receiptPublic`** removed |

## Deploy checklist

1. **`firebase deploy --only firestore:rules,firestore:indexes`** (rules + index before relying on the query).
2. **`firebase deploy --only hosting`** (`recibo.html`, `recibo.js`, `receipt-public-sync.js`, `pedidos.js`, `receipt-config.js`).
3. **`firebase deploy --only functions`** (delete cleanup).

Old **`receiptPublic`** documents (if any) are unused; you can delete them manually in the console.
