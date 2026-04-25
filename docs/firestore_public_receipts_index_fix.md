# Firestore publicReceipts Index Fix

## Issue
`firebase deploy` failed while deploying Firestore indexes with:
- `Index must have at least one field`
- Path: `collectionGroups/publicReceipts/indexes`

## Root cause
- `firestore.indexes.json` contained a `publicReceipts` composite index entry that was not valid for deployment.
- The index definition for `publicReceipts` was unnecessary and caused Firestore index validation failure.

## Fix applied
- Removed the `publicReceipts` index block from `firestore.indexes.json`.
- Left only valid structure:
  - `"indexes": []`
  - `"fieldOverrides": []`

## Files changed
- `firestore.indexes.json`
- `docs/firestore_public_receipts_index_fix.md`

## Safety
- No changes to Firestore rules.
- No changes to receipt sharing logic.
- No changes to chat logic.
- No UI changes.
