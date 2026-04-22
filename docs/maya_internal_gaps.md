# Maya Internal Gaps

## What Maya Still Does Not Know Well

- Exact confidence level for entity resolution when names are similar (beyond basic ambiguity handling).
- Reliable distinction between "projected" vs "realized" financial outcomes in all edge cases.
- Full business intent when user messages mix multiple operations in one sentence (e.g., create + expense + delivery at once).
- Historical causality across modules (why a record ended in current state) without explicit audit timeline.

## Missing Context

- Unified, explicit "action result contract" returned to chat for every mutation (standard success/error payload shape).
- Rich relational context bundle by default:
  - open orders grouped by client
  - finance movement linkage quality
  - unresolved/orphaned references
- Consistent confidence metadata for resolver outcomes.
- Versioned action schema context exposed to prompt/runtime (for safer prompt evolution).

## What Should Be Improved Next

- Add response templates tied to action outcomes so Maya always reports state accurately.
- Add stronger structured disambiguation responses (candidate list + recommended next question).
- Add backend integrity checks surfaced to Maya context:
  - delivered orders without finance entries
  - finance entries linked to non-delivered orders
- Add action idempotency keys for repeated user requests.
- Add explicit "operator mode policy" in prompt/context to standardize concise internal responses.
- Prepare shared action pipeline adapters for WhatsApp so internal and external channels reuse identical mutation logic.
