# Maya Quote Summary Cleanup Report

## What was fixed
- Removed rendering of the extra `RESUMEN DE PRESUPUESTO` UI card in Chat IA.
- Maya now shows quote information only once, inside the main assistant bubble.

## Root cause
- The assistant bubble was already showing Maya's text response.
- In parallel, the UI also generated and appended a secondary quote card (`yc-quote-card`) using parsed quote data.
- This created duplicated quote content and poor mobile readability.

## Change made
- In `chat.js`, inside `appendAssistantBubble(...)`, the quote metadata is still parsed and stored in `wrap.dataset.quoteJson` for action logic, but the quote card append call was removed.
- Removed line:
  - `col.appendChild(buildQuoteCardEl(quote));`

## Why this is safe
- `Copiar` remains functional (copies the cleaned main bubble text).
- `Convertir a orden` remains functional because it still reads `dataset.quoteJson` when available.
- Maya response generation logic is unchanged.
- Microphone/send behavior is unchanged.
- WhatsApp tab logic is unchanged.

## Mobile impact
- Eliminates duplicate visual block and reduces vertical clutter.
- Keeps only one wrapped message bubble for quote details.
- No extra card overflow path remains for quotes.
- Chat scroll behavior remains unchanged.

## Files changed
- `chat.js`
- `docs/maya_quote_summary_cleanup_report.md`
