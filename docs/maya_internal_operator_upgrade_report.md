# Maya Internal Operator Upgrade Report

## What Was Added

- `functions/maya-response-builder.js`
  - Central response composer for strict operator actions:
    - `create_order`
    - `set_order_expenses`
    - `mark_order_delivered`
    - `add_income`
    - `add_expense`
  - Produces short operational confirmations with relevant amounts.

- `functions/maya-context-snapshot.js`
  - Compact operator snapshot builder for internal Maya context:
    - recent open orders
    - recent delivered orders
    - pending balances
    - recent finance activity
    - linkage summary
  - Designed to stay lightweight for prompt/runtime usage.

## What Changed

- `functions/maya-entity-resolver.js`
  - Ambiguity handling upgraded:
    - structured candidate list now includes:
      - `id`
      - `clientName`
      - `product`
      - `total`
      - `status`
      - `date`
    - includes `followUpQuestion` to drive next Maya prompt turn.
  - Added resolver metadata:
    - `matchType`
    - `confidence`
    - `ambiguityStatus`

- `functions/maya-action-executor.js`
  - Returns `resolutionMeta` with execution result for downstream response building/logging.

- `functions/index.js`
  - Internal context pipeline now includes `operatorSnapshot` in reduced context (`prepareMayaAnthropicPayload`).
  - Strict action flow now:
    1. schema lookup
    2. validation + normalization
    3. entity resolution
    4. centralized execution
    5. operator response building
  - Structured logs now include resolver metadata.
  - Resolver ambiguity errors now include follow-up question text when available.

## What Maya Internal Chat Does Better Now

- Understands current operational state more compactly via `operatorSnapshot`.
- Gives clearer post-action feedback instead of generic/noisy system text.
- Handles ambiguous order matches with actionable options and guided follow-up.
- Exposes resolver confidence/match mode so behavior can be tuned further.
- Keeps execution aligned to canonical business functions (especially delivery settlement).

## What Still Remains for Later

- Optional UI-level rendering of ambiguity candidates as selectable options.
- Broader strict-pipeline coverage for more action types (calendar/team/delete flows).
- Transactional batching for multi-action messages to avoid partial success edge cases.
- Full reuse of the same strict pipeline in WhatsApp execution path.
