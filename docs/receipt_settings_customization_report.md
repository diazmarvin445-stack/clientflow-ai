# Receipt settings customization

## Where settings are saved

Receipt branding is stored in **Firestore** at:

`businesses/{businessId}/settings/receipt`

The document is created/updated with **`setDoc(..., { merge: true })`** from **Configuración → Personalizar recibo → Guardar**.

### Security

`firestore.rules` includes:

`match /businesses/{businessId}/settings/{settingId}` → read/write allowed when **`isBusinessOwner(businessId)`**.

Deploy updated rules with Firebase CLI so clients can read/write this path.

### Stored fields

| Field | Purpose |
|--------|---------|
| `businessName` | Name printed on the PDF header |
| `logoUrl` | Public image URL and/or **data URL** (PNG/JPEG from upload, ≤ 400 KB recommended) |
| `phone` | Contact line on the receipt |
| `email` | Contact line on the receipt |
| `address` | Free text; line breaks become multiple lines on the PDF |
| `footerMessage` | Gray legal/disclaimer block above optional terms |
| `primaryColor` | Hex color (e.g. `#6366f1`) → RGB for header accent and text logo block |
| `notesTerms` | Optional “Notas y términos” section |
| `updatedAt` | Server timestamp on save |

Defaults when the document does not exist are defined in **`receipt-settings.js`** (`RECEIPT_SETTINGS_DEFAULTS`, aligned with **YourColor Corporation** as the sample name).

## What can be customized in the UI

Under **Configuración**, section **“Personalizar recibo”**:

- **Nombre en el recibo**
- **Logo**: file upload (PNG/JPG) and/or **URL del logo**
- **Quitar logo** clears the stored logo for the next save
- **Teléfono** / **Correo**
- **Dirección / ciudad** (textarea, multiple lines allowed)
- **Color principal** (color picker → `primaryColor`)
- **Mensaje al pie** (`footerMessage`)
- **Notas / términos** (`notesTerms`)

The main **Perfil del negocio** / **Marca** blocks are unchanged; receipt-specific values are separate so receipts can differ from the general business profile if needed.

## How the PDF uses these settings

**Pedidos** (`pedidos.js`) calls **`getReceiptPdfBusiness(db, activeBusinessId)`** before **`generateOrderReceiptPdf(row, biz)`**.

1. **`receipt-settings.js`** loads `settings/receipt`, merges with **`RECEIPT_SETTINGS_DEFAULTS`**, and maps to a **`ReceiptPdfBiz`** object (`legalName`, `brandRgb`, `logoUrl`, `addressLines`, `footerMessage`, `notesTerms`, `textLogo` for fallback initials).

2. **`receipt-pdf.js`** builds the PDF with:
   - Light header band, **primary color** rule under the header
   - **Logo** with aspect-preserving size (no hard square crop); if missing or invalid, a **colored block with initials** from the business name
   - Business name, phone, email, address lines
   - **Customer-only** order lines: cliente, teléfono, producto, cantidad, total, depósito, saldo, fecha de entrega, número de recibo — **no** gastos, ganancia, or estado interno
   - **Footer** from `footerMessage` and optional **Notas y términos**

3. **jsPDF** remains loaded via **UMD** on `pedidos.html` (GitHub Pages–friendly); no npm/babel imports.

## Code map

| File | Role |
|------|------|
| `receipt-settings.js` | Defaults, Firestore path, `getReceiptPdfBusiness`, form loader |
| `receipt-pdf.js` | PDF layout and customer-safe content |
| `receipt-config.js` | Shared defaults / status labels (still used for defaults) |
| `configuracion.html` / `configuracion.js` | “Personalizar recibo” UI and save |
| `pedidos.js` | Fetches settings per download |
| `firestore.rules` | Owner access to `settings/*` |
