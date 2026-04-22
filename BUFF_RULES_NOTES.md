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