# Buff Rules Notes

This file records user-stated rules about buffs so the rules can be extended over time.

## Editor Rules

- Every buff should have an attribute field in the buff editor.
- Buffs default to `未选择`.
- `未选择` means the buff still needs to be categorized.
- `无` is a real attribute and means the buff cannot be dispelled.
- Available buff attributes currently include: `未选择`, `无`, `阴性`, `阳性`, `毒性`, `外功`, `持续伤害`, `混元`, `蛊`, `点穴`.
- `隐藏` is not a buff attribute. It is a separate boolean flag.
- Hidden-state filtering in the editor should support `全部状态`, `隐藏`, and `显示`.
- The default hidden-state filter is `显示`.

## Presentation Rules

- Buff cards show the subtitle in the top-right corner.
- Buff cards do not show the buff number.
- The source ability is shown with its ability icon at the bottom-right of the buff card.
- Missing buff icons use `fallback.png`.
- Editing a buff name must not break icon lookup.

## Classification Rules

- Buffs are split into `有利` and `不利` groups.
- If a buff is a debuff and its attribute is `阴性`, the subtitle is `阴性不利效果`.
- If a buff is beneficial and no attribute is selected yet, the subtitle is `有利效果`.

## Hidden Buff Rules

- If a buff is hidden, it should not carry a normal visible attribute classification.
- When a buff becomes hidden, its attribute should be cleared.
- Hidden buffs should not be allowed to receive a new attribute until they are no longer hidden.
- Hidden Buff decisions are edited separately from buff attributes.

## 减伤被顶 Rules

- `减伤被顶` applies only to damage-reduction Buffs marked as `可以被顶`.
- If a player already has a lower `可以被顶` damage-reduction Buff and gains a higher matching damage-reduction Buff, the lower one is removed immediately regardless of remaining duration.
- If a player already has a higher or equal matching damage-reduction Buff and gains a lower `可以被顶` damage-reduction Buff, the lower incoming Buff is not applied.
- A `不可被顶` damage-reduction Buff is never removed by this rule and can coexist with higher damage reduction or other `不可被顶` Buffs.
- Damage-reduction matching respects damage type: global damage reduction covers typed damage reduction; typed damage reduction only compares against the same damage type.
- Multiple active damage-reduction effects add together during damage calculation. When total damage reduction reaches or exceeds `100%`, the target loses no health and combat text displays white `-0`.

## 手动点掉 Buff Rules

- `手动点掉 Buff` applies only to beneficial `BUFF` entries, never `DEBUFF` entries.
- Only Buffs marked `可以主动取消` may be removed by right-clicking the player-owned status icon.
- Manual removal must use the same runtime cleanup expectations as expiration or dispel: remove linked shields, remove the active Buff, and emit a `BUFF_EXPIRED` event so dependent effects can react.
- Hidden Buffs are not normally cancelable from the status bar because they have no visible status icon to right-click.