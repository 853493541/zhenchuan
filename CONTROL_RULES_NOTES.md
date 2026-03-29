# Control Rules Notes

Purpose: persist requested control interaction rules so future changes stay aligned.

## Core stun/control policy

- CONTROL (stun/knockdown-level lock) blocks cast, movement, jump, and turning.
- Only abilities/effects explicitly marked with allowWhileControlled can be used while controlled.
- CLEANSE-style effects are the standard override path for controlled state.

## Replacement / priority behavior

- Knockdown should replace existing stun-style CONTROL on the same target.
- Knockback should remove active stun-style CONTROL before applying knockback state.
- Pull-in effects should also remove active stun-style CONTROL before applying pull displacement.

## Example sequences to preserve

- shengsi_jie (stun) -> mohe_wuliang (knockdown): stun is replaced by knockdown state.
- mohe_wuliang follow-up stun active -> knockback event: follow-up stun should be removed, leaving knockback control.
- wu_jianyu timed knockback overlapping old stun: effective control should transition to knockback and not stack stale stun lock.

## Current implementation checkpoints

- Knockdown replacement for stun: implemented via incoming mohe knockdown handling.
- Knockback replacement for stun: implemented in GameLoop knockback handling.
- Pull-in replacement for stun: keep as required behavior for any future pull-in mechanic implementation.
