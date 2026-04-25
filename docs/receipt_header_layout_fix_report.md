# Receipt Header Layout Fix Report

## Issue fixed

In the public digital receipt header, the **"Visitar YourColor"** link could visually collide with address text. The header now has clear structural separation between:

- logo
- business name/contact
- address / delivery lines
- website link on its own line

## Files updated

- `recibo.html`
- `pedidos.html`
- `recibo.js`
- `pedidos.js`
- `styles.css`

## What changed

1. **Header structure normalized**
   - Both public receipt (`recibo.html`) and in-app preview (`pedidos.html`) now use:
     - logo wrapper
     - `receipt-business-info` block
     - individual text lines
     - website link as a dedicated element in that block

2. **Address lines render as separate paragraphs**
   - `recibo.js` and `pedidos.js` now render address/delivery lines as multiple `<p>` rows instead of a single newline-joined text node.
   - This avoids wrapping conflicts and keeps spacing consistent.

3. **Responsive CSS layout improvements**
   - Header is now a clean flex layout (`logo + info`) on desktop.
   - On small screens (`max-width: 560px`), layout stacks vertically for readability.
   - Logo sizing and spacing were tightened to prevent overlap with text.
   - Website link remains on its own line with top margin and clear click target.

## Result

- No overlap between address and website link.
- Header reads like a professional invoice block.
- Mobile layout remains clean and readable.

## Not changed

- Receipt data fields
- Public receipt permissions / Firestore paths
- PDF generation logic
- Share logic
