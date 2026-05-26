# Interface Research Experience

Date: 2026-05-25

Scope: pure research only. No gameplay, backend, frontend, or asset implementation was changed. This note records what was learned about the original JX and MY interface behaviors related to buff enhancement, team buff monitoring, combat statistics, and color systems, and how those findings could map into Zhenchuan later.

## Sources Checked

- `interface/JX/JX_Buff/info.ini.zh_TW` identifies the addon as `BUFF辅助`, described as `BUFF效果提示、倒计时时间显示增强等`.
- `interface/JX/JX_Buff/manifest.dat` loads `data/buff_info.db`, `JX_Buff_Data.lua`, `JX_Buff.lua`, and UI templates under `ui/`. `JX_BuffList.lua` is packaged but commented out in `info.ini`.
- `interface/JX/JX_Target/**` was checked because the feature was expected near target UI, but it does not appear to contain this custom buff enhancement. The relevant module is `interface/JX/JX_Buff`.
- The Lua files in `interface/JX/JX_Buff` are packaged/encrypted binary data, not readable source. Behavior had to be inferred from UI templates, demo data, manifest metadata, and the SQLite database.

## Original Feature Model

The addon is not just drawing a prettier icon. It appears to add a classification/filter layer over game buffs, then uses that layer to decide whether a buff should be shown and which display treatment it receives.

The decoded demo file `interface/JX/JX_Buff/data/CustomDataDemo.jx3dat` shows two main tables:

```lua
return {
    tClass = {
        ["决斗"] = {
            bBorderEnable = true,
            nBorder = 45,
            bFontEnable = true,
            nFont = 23,
            bEnable = true,
        },
        ["扶摇"] = {
            bBorderEnable = false,
            nBorder = 0,
            bFontEnable = false,
            nFont = 0,
            bEnable = true,
        },
    },
    tBuff = {
        [10212] = {
            tLevel = {[0] = true},
            nClass = "决斗",
            nPower = 0,
        },
        [208] = {
            tLevel = {[0] = true},
            nClass = "扶摇",
            nPower = 10,
        },
    }
}
```

Meaning inferred from comments:

- `tClass` is the display category/preset list. The category name is expected to be short, preferably no more than two Chinese characters.
- `bBorderEnable` and `nBorder` enable a custom icon border and choose the border frame ID. Recommended border IDs are `1, 7, 9, 10, 11, 12, 13, 14, 45, 61`.
- `bFontEnable` and `nFont` enable a custom font style and choose the font scheme ID. Recommended font IDs include `2, 40, 187, 205, 226, 17, 99, 159, 186, 245, 246, 256, 23, 235, 253, 271, 199, 200, 210`.
- `bEnable` disables a whole class when false; buffs assigned to that class stop displaying.
- `tBuff[buffId]` binds a game buff ID to a class/preset.
- `tLevel = {[0] = true}` means all levels of that buff are matched. The original game has buff ID plus level; our current runtime does not really model buff levels, so `[0] all` maps naturally to our current behavior.
- `nClass` chooses the class label/preset. The demo comment says forcing it to an empty string can hide or override an unwanted plugin-provided category.
- `nPower` is an importance threshold. User display levels are described as low `>= 0`, medium `>= 10`, high `>= 30`. The comments recommend using the buff's damage reduction or burst percentage for this value, while very important effects like immunity should be `0` so they always show.

This means the feature the user described, such as changing `你好` to `重要` and adding a gold border, is likely represented as assigning that buff ID to a short class/display label like `重要`, then applying that class's border/font preset.

## UI Templates

`ui/JX_BuffList.ini` defines the live buff display template:

- Icon container: `Handle_Box`, 50x50.
- Border/background image: `Image_IconBg`, using `UI\Image\Common\Box.UITex`, `Frame=45`, 50x50.
- Actual icon: `Box_Icon`, 46x46, offset 2px from the border.
- Stack count: `Text_StackNum`, lower-right aligned.
- Timer: `Text_Time`, upper-left aligned.
- Display name: `Text_Name`, placed below the icon at `Top=50`, width 46, font scheme `187`.

`ui/JX_CustomBuffListTemp.ini` defines the custom buff management list:

- Search input with `MaxLen=6`, implying the custom/category display text is intentionally short.
- List rows contain `Box_ItemIcon`, `Text_ItemName`, and `Text_ItemType`.
- Buttons exist for new and delete.
- There is a config button using `MainBarPanel.UITex`, likely opening broader addon settings.

`ui/JX_NewBuff.ini` defines a searchable buff picker:

- Search window with clear/search buttons.
- Result list preview count 20.
- Each result row has a buff icon (`Box_Buff`) and name (`Text_BuffName`).

So the original user workflow appears to be: search/select a buff, assign it to a short custom type/class, optionally tune class style/filter settings, then let the live buff list render icons with that class name, timer, stack count, font scheme, and border frame.

## Resource Findings

The important border resource is not stored inside `JX_Buff` as a standalone addon asset. The display template references built-in game UI resources:

- `UI\Image\Common\Box.UITex` with `Frame=45` for the icon border/background.
- Recommended border IDs from the demo are frame IDs in that texture family.
- Other referenced built-ins include `ui\Image\UItimate\UICommon\PanelBg.UITex`, `Common.UITex`, `Button.UITex`, `Button_Paper.UITex`, `MainBarPanel.UITex`, and `ui\Image\Minimap\Minimap.UITex`.

The packaged `data/buff_info.db` is SQLite and has one table:

```sql
CREATE TABLE buff_type(
  BuffID INTEGER NOT NULL,
  Level INTEGER NOT NULL,
  Attrib_1 INTEGER,
  Value_1 INTEGER,
  Attrib_2 INTEGER,
  Value_2 INTEGER,
  Attrib_3 INTEGER,
  Value_3 INTEGER
)
```

It contains 10,182 rows. It looks like a machine-readable map from original game buff ID/level to semantic attributes and values, probably used to auto-classify buff importance/type. The demo buff IDs checked (`10212`, `208`, `3219`) were not present in that database, so the demo examples are manual override examples rather than proof that every custom buff must exist in the DB.

Asset implication: to get the exact gold-border feeling, the real target is the original `Box.UITex` frame set, especially frame `45`. That asset is not directly present as a normal PNG in this repo. Later implementation needs a rights-safe asset decision: use licensed converted frames if available, or recreate a visually close Zhenchuan-native border atlas/style.

## Resource Gap Checklist

For JX and MY, the biggest remaining gaps are not abstract behavior ideas anymore. The missing pieces are mostly exact original atlases, frame sets, font presets, and opaque packaged logic.

Resources confirmed missing from this repo if we want a closer 1:1 clone:

- JX built-in border atlas source for `UI\Image\Common\Box.UITex`, especially the recommended frame IDs `1, 7, 9, 10, 11, 12, 13, 14, 45, 61`.
- JX built-in UI atlases referenced by the management/search UIs: `ui\Image\UItimate\UICommon\PanelBg.UITex`, `Common.UITex`, `Button.UITex`, `Button_Paper.UITex`, `MainBarPanel.UITex`, and `ui\Image\Minimap\Minimap.UITex`.
- JX font scheme definitions for the style IDs used or recommended by the addon: live UI uses `7`, `15`, `16`, `18`, `187`, `228`, `237`; the demo also recommends `2, 17, 23, 40, 99, 159, 186, 199, 200, 205, 210, 226, 235, 245, 246, 253, 256, 271`. We know the IDs, but not the actual font rendering definitions from the original client.
- MY built-in raid/common/target atlases used by `MY_Cataclysm` and `MY_Recount` for exact official visuals: `ui\Image\UICommon\RaidTotal.UITex`, `ui\Image\UICommon\CommonPanel.UITex`, `ui\Image\UICommon\CommonPanel2.UITex`, `ui\Image\Common\CommonPanel.UITex`, `ui\Image\Common\Box.UITex`, `ui\Image\Common\Money.UITex`, `ui\Image\Common\Animate.UITex`, `ui\Image\TargetPanel\Target.UITex`, `ui\Image\TargetPanel\Player.UITex`, `ui\Image\UITga\Voice.UITex`, `ui\Image\button\FrendNPartyButton.UITex`, `ui\Image\button\CommonButton_1.UITex`, `ui\Image\Minimap\MapMark.UITex`, `ui\Image\UICommon\JiangHu2.UITex`, and `ui\Image\UICommon\AssistNewbie.UITex`.
- MY_Recount readable source logic. The addon title, language file, and UI are readable, but the main `src...lua` remains packaged binary data, so the exact fight segmentation rules, serialization format, and publish/chat output logic are still not directly readable.
- MY_Recount history-file format. The UI and language file prove it can save and reload history, but the binary source prevents us from seeing the exact on-disk schema.

Resources already present locally and usable as references:

- `interface/MY/MY_Cataclysm/images/border.Tga`, `border.UITex`, and `border.txt` provide the monitored-buff border atlas and frame list.
- `interface/MY/MY_Cataclysm/images/Cataclysm.Tga` and `Cataclysm.UITex` provide the panel skin used by the custom Cataclysm frame style.
- `interface/MY/MY_Cataclysm/images/ForceColorBox.Tga` and `ForceColorBox.UITex` provide the colored background frame used in the Cataclysm panel.
- `interface/MY/MY_LifeBar/config/default/zhtw.jx3dat` gives a readable RGB table for MY's school-color system, so for color values themselves we are already covered.

Bottom line:

- For MY colors, the RGB data is already good enough to copy conceptually.
- For exact original frame art, official panel chrome, warning sprites, and font look, we are still missing multiple built-in client atlases and font definitions.
- For MY_Recount behavior parity, we are still missing the readable packaged source and history format.

## MY Recount Research

The MY combat-stat feature the user asked for is clearly the addon `interface/MY/MY_Recount`, not `MY_TeamMon` and not `MY_TeamTools`.

Readable proof:

- `info.ini.zh_TW` names the addon `伤害统计`, described as `记录战斗信息方便日后分析总结`.
- `lang/zhtw.jx3dat` exposes feature labels such as `当前统计`, `战斗统计`, `化解统计`, `记录战斗统计数据`, `显示战斗统计界面`, `显示每秒平均数值`, `显示战斗有效数值`, `除去玩家暂离时间`, `退出游戏时保存数据`, `脱离战斗时保存数据`, `发布数量`, and publish modes for effective/total values.
- `ui/MY_Recount_UI.ini` shows the compact live ranking window.
- `ui/MY_Recount_DT.ini` shows the expanded detail window.

What the addon definitely does based on readable files:

- Records combat data while fighting and can keep both current-fight and history views.
- Supports history saving and loading.
- Can filter out short fights.
- Can switch display mode between per-second values and other effective/total views.
- Can filter records by NPC-only, player-only, or all.
- Can publish top results with configurable limits and output mode.
- Has a separate `化解统计` mode, so it is not only raw outgoing damage.

What the compact live window shows:

- A ranked list with colored percentage bars.
- Left text for actor name/rank and right text for values like `8457588 DPS`.
- A personal summary row with fight duration on the left and DPS on the right, for example `7:25` and `84575 DPS`.
- Buttons for previous/next mode, history, output/publish, clear, and options.

What the detail window shows:

- Skill table: rank, skill name, count, total value with DPS, and proportion.
- Detail table per damage/effect type: type, minimum, average, maximum, count, and proportion.
- Target table: target name, total damage, highest hit, hit count, critical count, miss count, and proportion.

This is enough to confirm the feature model the user described:

- It is battle-scoped.
- It tracks who dealt damage.
- It breaks the result down by skill.
- It can break the result down by target.
- It can present values as DPS.

What remains unknown because the source is packaged:

- Exact event-capture hooks and edge-case rules.
- Exact fight start/end segmentation logic.
- Exact format for saved history files.
- Exact publish/chat message formatting implementation.

Adaptation implication for Zhenchuan:

- We would need an authoritative combat event log carrying timestamp, source player, target entity, skill/effect id, numeric value, result type, and fight segment id.
- Backend should aggregate current-fight and archived-fight summaries.
- Frontend could mirror MY with a compact ranking panel plus a detail window for skill and target breakdowns.

## MY School Color Findings

Yes. MY definitely has a built-in `门派染色` system.

Readable proof:

- `interface/MY/MY_LifeBar/lang/zhtw.jx3dat` maps `Differentiate force color` to `门派染色`.
- The same file also contains `Draw School Color = 绘制门派颜色` for the head-top alert path.
- `interface/MY/MY_LifeBar/config/default/zhtw.jx3dat` contains the readable RGB table.

School colors found in the MY config:

- 江湖: `rgb(255, 255, 255)`
- 少林: `rgb(255, 178, 95)`
- 万花: `rgb(196, 152, 255)`
- 天策: `rgb(255, 111, 83)`
- 纯阳: `rgb(22, 216, 216)`
- 七秀: `rgb(255, 129, 176)`
- 五毒: `rgb(55, 147, 255)`
- 唐门: `rgb(121, 183, 54)`
- 藏剑: `rgb(214, 249, 93)`
- 丐帮: `rgb(205, 133, 63)`
- 明教: `rgb(240, 70, 96)`
- 苍云: `rgb(180, 60, 0)`
- 长歌: `rgb(100, 250, 180)`
- 霸刀: `rgb(106, 108, 189)`

Relationship colors used when `DifferentiateForce` is off:

- Self player/npc base: `rgb(26, 156, 227)`
- Party player/npc base: `rgb(23, 133, 194)`
- Enemy player/npc base: `rgb(203, 53, 9)`
- Neutrality player/npc base: `rgb(238, 238, 15)`
- Ally player/npc base: `rgb(63, 210, 94)`
- Foe player base: `rgb(197, 26, 201)`

Important interpretation:

- If `DifferentiateForce` is `false`, MY can use a relation-based unified color.
- If `DifferentiateForce` is enabled, it has a concrete per-school color table ready to use.
- So for `门派染色`, color values are already known; the missing part is only whether we want to mirror the exact original art frames around those colors.

## MY Later Class Follow-up

The earlier MY color list was not the complete late-era class roster. After a focused follow-up search for `蓬莱`, `凌雪`, `衍天`, `药宗`, `万灵`, `刀宗`, and `段氏`, the result is split into two parts: class recognition exists in MY's shared base data, but readable Lifebar color tables still stop at the older roster.

Later classes confirmed in readable MY data:

- `蓬` for 蓬莱 凌海诀
- `凌` for 凌雪 隐龙诀
- `衍` for 衍天 太玄经
- `素` for 药宗 灵素
- `方` for 药宗 无方
- `刀` for 刀宗 孤锋诀
- `灵` for 万灵 山海心诀
- `段` for 段氏 周天功

These come from `interface/MY/MY_!Base/lang/lib/zhtw.jx3dat`, which proves the MY shared base layer already knows these newer schools/heart methods.

Readable force-type references found outside Lifebar color config:

- `MY_RoleStatistics/data/task/zhtw_hd.jx3dat` contains `env.FORCE_TYPE.PENG_LAI`
- `MY_RoleStatistics/data/task/zhtw_hd.jx3dat` contains `env.FORCE_TYPE.LING_XUE`
- `MY_RoleStatistics/data/task/zhtw_hd.jx3dat` contains `env.FORCE_TYPE.YAN_TIAN`

Important negative finding:

- In all readable `MY_LifeBar` configs currently present in this repo, the school color tables still stop at `霸刀`.
- The readable configs do not expose explicit RGB entries for `蓬莱`, `凌雪`, `衍天`, `药宗`, `万灵`, `刀宗`, or `段氏`.
- A string scan across all packaged `MY_LifeBar/src*.lua` snapshots did not reveal those later class names or force identifiers either.

This means the current evidence is:

- MY base/shared data recognizes these later classes.
- The readable MY Lifebar color tables we currently have do not yet show their RGB colors.
- So those later-class color values are still missing from the accessible research surface in this repo.

Complete currently confirmed MY class roster by readable evidence:

- Older readable Lifebar color roster: 江湖、少林、万花、天策、纯阳、七秀、五毒、唐门、藏剑、丐帮、明教、苍云、长歌、霸刀
- Later classes recognized by MY shared/base data: 蓬莱、凌雪、衍天、药宗（灵素/无方）、刀宗、万灵、段氏

Practical conclusion:

- If the target is “all classes,” then the current readable MY color table is incomplete.
- If the target is “all classes known by MY,” then the plugin clearly knows the newer classes by name/abbreviation, but their color RGB values are not exposed in the readable Lifebar configs available here.

## System-Level Recheck For Later School Colors

I re-traced the already known old-school RGB values back to their actual source instead of relying on second-hand summaries.

Confirmed source of the readable MY school palette:

- `interface/MY/MY_LifeBar/config/default/*.jx3dat`
- `interface/MY/MY_LifeBar/config/official/*.jx3dat`
- `interface/MY/MY_LifeBar/config/xlifebar/*.jx3dat`
- `interface/MY/MY_LifeBar/config/clear/*.jx3dat`

In each readable profile, the concrete `FORCE_TYPE -> { r, g, b }` table runs from `江湖` through `霸刀` and then stops. It does not contain commented-out later entries, alternate later profiles, or hidden fallback rows for:

- `蓬莱`
- `凌雪`
- `衍天`
- `药宗`
- `万灵`
- `刀宗`
- `段氏`

Shared system-layer evidence found outside MY Lifebar:

- `interface/JX/JX_0Base/lang/zhtw.lang` includes shared school names for `PengLai`, `LingXue`, `YanTian`, `YaoZong`, `DaoZong`, `WanLing`, and `DuanShi`.
- `interface/MY/MY_!Base/lang/lib/zhtw.jx3dat` includes the corresponding later-school short labels and heart-method mappings.
- `interface/MY/MY_RoleStatistics/data/task/*.jx3dat` exposes `env.FORCE_TYPE.PENG_LAI`, `LING_XUE`, and `YAN_TIAN`, but these are not RGB color rows.

System-level conclusion:

- The extracted interface data in this repo preserves newer school names and some newer force identifiers.
- The extracted readable RGB palette still stops at `霸刀`.
- So after re-reading both MY and shared JX system data, the later-school colors are still not recoverable as explicit RGB values from the accessible system files currently in this repo.

## Simplified Chinese Decoding Recheck

Important correction: many `zhcn` and JX `default.lang` files in this interface dump are GB18030/GBK-like text, not UTF-8. Reading them directly makes the Chinese comments and values look broken. Use an on-the-fly decode when searching them:

```bash
iconv -f gb18030 -t utf-8 path/to/zhcn.jx3dat
```

After decoding simplified Chinese files and searching again:

- `interface/MY/MY_Chat/lang/zhcn.jx3dat` reads correctly; for example `always show *` becomes `总是显示※号`.
- `interface/MY/MY_LifeBar/lang/zhcn.jx3dat` confirms `Differentiate force color = 门派染色` and `Draw School Color = 绘制门派颜色`.
- `interface/MY/MY_LifeBar/config/*/zhcn.jx3dat` exposes the same two readable RGB palette families as the `zhtw` files, but still stops at `霸刀`.
- `interface/MY/MY_!Base/lang/lib/zhcn.jx3dat` confirms later school labels through `段氏`.
- `interface/JX/JX_0Base/lang/zhcn.lang` and `default.lang` confirm shared school names through `段氏`.
- `interface/MY/MY_RoleStatistics/data/task/zhcn_*.jx3dat` confirms `PENG_LAI`, `LING_XUE`, and `YAN_TIAN`, but the values are task/quest id pairs like `{19225, 16747}`, not RGB colors.

Decoded simplified search did not reveal explicit RGB colors for:

- `蓬莱`
- `凌雪`
- `衍天`
- `药宗`
- `万灵`
- `刀宗`
- `段氏`

Combat-stat implication:

- `MY_Recount` is the combat-stat addon. Its decoded simplified language file exposes labels such as `战斗统计`, `记录战斗统计数据`, `当前统计`, and `化解统计`.
- The readable `MY_Recount` UI files contain generic UI colors such as shadow colors, not school palettes.
- `MY_Recount/src*.lua` files are packaged `data`, so its internal aggregation logic and any possible private color use are not readable here.
- For a faithful combat-stat UI, class identity and class colors should be treated separately: the readable data can identify some later classes, but the complete later-class RGB palette is still missing from the accessible files.

## Latest Addendum: Encoding, Colors, Recount, CombatText, Global Settings, Team Panel

### Editor Encoding Note

The active simplified addon files are not corrupted. They are GB18030/GBK-style text. If VS Code opens a file such as `interface/MY/MY_Chat/lang/zhcn.jx3dat` as UTF-8, the window will still look unreadable even though command-line decoding works.

Non-writing fix for the editor view:

1. Use the VS Code status bar encoding selector in the bottom-right corner, or run Command Palette -> `Reopen with Encoding`.
2. Choose `Simplified Chinese (GB 18030)` if available. `GBK` is the next reasonable choice.
3. Do not choose `Save with Encoding` unless we intentionally want to rewrite the file bytes.

This keeps the addon file untouched while making the editor display readable.

### External School Color Table Comparison

The user-provided table strongly matches the readable MY bright/default palette for older schools. The first RGB column matches the repo-confirmed bright values for:

- 江湖, 少林, 万花, 天策, 纯阳, 七秀, 唐门, 藏剑, 丐帮, 明教, 苍云, 长歌, 霸刀

One old-school mismatch remains:

- 五毒: repo bright value is `rgb(55, 147, 255)` / `#3793ff`; user table gives `rgb(95, 159, 255)` / `#5f9fff`.

The user-provided first column fills several colors that are missing from the readable repo palette:

- 蓬莱: `rgb(171, 227, 250)` / `#abe3fa`
- 凌雪: `rgb(161, 9, 34)` / `#a10922`
- 衍天: `rgb(166, 83, 251)` / `#a653fb`
- 药宗: `rgb(0, 172, 153)` / `#00ac99`

Important caveat: those four values were not found in this repo's decoded interface files. They are useful external fill-ins, not repo-confirmed values.

The second RGB column in the user table does not match the repo's `clear` / `xlifebar` alternate palette. Treat it as an external darker companion palette unless a later source proves otherwise.

The user table still does not provide colors for:

- 万灵
- 刀宗
- 段氏, written earlier by the user as `段式`

Provisional invented fill-ins if Zhenchuan needs a complete modern roster before source-confirmed values are found:

- 万灵: `rgb(88, 205, 123)` / `#58cd7b`; dark companion `rgb(28, 105, 60)` / `#1c693c`
- 刀宗: `rgb(86, 153, 238)` / `#5699ee`; dark companion `rgb(32, 77, 128)` / `#204d80`
- 段氏: `rgb(232, 190, 90)` / `#e8be5a`; dark companion `rgb(126, 83, 30)` / `#7e531e`

These three are design placeholders only. They should be named `provisional` in code/config if used, so later evidence can replace them cleanly.

### 战斗记录: 自定义界面风格选择

Decoded `MY_Recount/lang/zhcn.jx3dat` exposes:

- `Theme = 自定界面风格选择`

So the setting exists in the readable language layer. The readable UI files show colors, but only generic component colors:

- Compact window percentage bars use `ShadowColor=red3` in `MY_Recount_UI.ini`.
- Detail window sections use generic values such as `ShadowColor=blue1` and `GrayColor=0` in `MY_Recount_DT.ini`.
- These are UI surface/bar colors, not school colors and not a discovered global palette.

The exact theme options and theme-switching logic are still hidden in packaged `src*.lua` data. Current conclusion: `自定义界面风格选择` exists, but no readable class/school color table was found inside `MY_Recount`.

### 战斗字体 / 战斗文字 System

The relevant module is `interface/MY/MY_CombatText`. The user-facing name is `战斗文字`, and it is the system that should be studied for the planned combat-font behavior.

Decoded labels show support for:

- Enable combat text.
- Use render frame / smoothing.
- Show related-only combat text.
- Max count, timing, text size, and critical style.
- Combat text formatting for damage, healing, skill text, buff/debuff, miss/dodge, immunity, messages, and critical messages.
- Font modification, shown as `当前字体：%d`.
- Color modification, distinct critical colors, and reset color.

Decoded `data/CombatText.jx3dat` is especially important. It is not just labels; it is an editable config model containing:

- `COMBAT_TEXT_TYPE` enum entries for damage, therapy, effective therapy, steal life, physical/solar/neutral/lunar/poison damage, reflected damage, spirit, staying power, shield/absorb/parry/insight damage, buff/debuff text, miss, immunity, dodge, exp, normal message, and critical message.
- `COMBAT_TEXT_CRITICAL`, `COMBAT_TEXT_SCALE`, and `COMBAT_TEXT_POINT` for animation/timing/position behavior.
- `COMBAT_TEXT_EVENT` for included event categories.
- `COMBAT_TEXT_SKILL_IGNORE` and `COMBAT_TEXT_SKILL_TYPE_IGNORE` for filters.
- `COMBAT_TEXT_COLOR`, a concrete RGB table by combat text type.
- `COMBAT_TEXT_CRITICAL_COLOR`, empty by default, meaning critical color falls back to normal color unless overridden.

Confirmed color examples from `COMBAT_TEXT_COLOR`:

- Self damage received: `rgb(253, 86, 86)`
- Healing/effective healing/life steal: `rgb(0, 255, 0)`
- Physical damage: `rgb(255, 255, 255)`
- Solar damage: `rgb(255, 128, 128)`
- Neutral damage: `rgb(255, 255, 0)`
- Lunar damage: `rgb(12, 242, 255)`
- Poison damage: `rgb(128, 255, 128)`
- Debuff/dodge/critical message emphasis: red-family values

Adaptation implication: Zhenchuan should model combat font/color as an event-type styling system, not as school color. It should probably have a separate config table from class colors and status-bar buff styling.

### 全局配色 / Global Color Interpretation

An exact decoded label `全局配色` was not found in the accessible files. The closest proven concepts are:

- `MY_!Base/lang/lib/zhcn.jx3dat`: `全局设置`, `全局`, and `全局共享`, meaning settings can be stored as role-only, server-shared, or globally shared.
- `MY_!Base/lang/lib/zhcn.jx3dat`: `Color Picker = 颜色选择器`, a shared color picking UI concept.
- `MY_LifeBar/lang/zhcn.jx3dat`: `颜色配置`, `统一染色`, and `门派染色`.
- `MY_CombatText`: `颜色修改` and `重置配色` for combat text type colors.
- `MY_TeamMon`: `修改颜色（报警通用颜色）`, meaning some alarm colors are common/shared across TeamMon entries.
- `MY_Cataclysm`: `文字&颜色&距离`, `距离颜色`, `其他状态颜色`, buff entry colors, and screen-head alarm colors.

Best current interpretation: the remembered `全局配色` may be a user-facing way of describing color settings stored under `全局设置` / `全局共享`, not a single central official palette table. In the readable files, color systems are module-specific: LifeBar school/relation colors, CombatText event colors, Cataclysm team-panel/buff/alarm colors, and TeamMon alarm common colors.

### 团队面板 UI And 团队气劲 Connection

The real team-panel module is `MY_Cataclysm`, displayed as `团队面板`. It is separate from but connected to `MY_TeamMon` / `团队监控`.

Key Cataclysm labels and behavior:

- `Enable Cataclysm Team Panel = 启用团队面板`
- `Color settings = 文字&颜色&距离`
- `Colored as official team frame = 官方着色`
- `Name colored by force = 名字门派着色`
- `Buff settings = 气劲设置`
- `Edit buff = 团队气劲监控`
- `Enable official data = 启用官方团队气劲数据`
- `Enable MY_TeamMon data = 启用团队监控数据联动`
- `Buff list = 气劲列表`
- `From MY_TeamMon data = 来自团队监控数据`
- `From official raid buff data = 来自官方团队气劲数据`
- `From custom data = 来自用户自定义数据`

Default Cataclysm config confirms the runtime shape:

- `nBGColorMode = 1` means background color by distance; official profile uses mode `3` for official coloring.
- `nColoredName = 1` enables colored name behavior.
- `nMaxShowBuff = 4` limits displayed buff slots per member.
- `bShowBuffTime`, `bShowBuffNum`, and `bShowBuffReminder` are enabled.
- `bBuffPushToOfficial = true` links monitored buffs to the official panel.
- `bBuffDataTeamMon = true` enables TeamMon data linkage.
- `bShowAttention`, `bShowCaution`, and `bShowScreenHead` enable mask/effect/head warning paths.
- `aBuffList = {}` is the custom user buff list container.

Cataclysm UI structure:

- The team frame skin uses `interface/MY/MY_Cataclysm/images/Cataclysm.UITex`.
- Member cells use life and mana handles plus `ForceColorBox.UITex` for a colored background element.
- The panel has both `OFFICIAL` and `CATACLYSM` style variants.
- Buff UI items render icon, time, stack/reminder, border/mask/effect/head-warning concepts through the team member cell rather than a separate global buff strip.

TeamMon connection:

- `MY_TeamMon` has `团队重要气劲列表`, `团队气劲列表`, `团队面板`, `添加团队面板气劲监控`, and `团队面板关联气劲显示`.
- `MY_TeamMon` also has `团队面板条件监控`, meaning some TeamMon rules can become conditional team-panel buff display rules.
- TeamMon is the data/event monitor system; Cataclysm is the team-panel display target.

Adaptation implication: if Zhenchuan copies this idea, the clean model is `team member -> monitored buff rules -> per-member buff slots and warning overlays`, with optional data import from a broader event-monitor system. It should not be merged mentally with the standalone player status bar.

## Zhenchuan Current Buff Display

Current runtime/display flow:

- Backend runtime sends `ActiveBuff` entries with `buffId`, `name`, `category`, `effects`, `expiresAt`, `appliedAt`, and optional `stacks`.
- Frontend `StatusBar` resolves each runtime buff through `preload.buffMap[buffId]`. If no preload metadata exists, the buff does not display.
- `buildAbilityPreload()` is the backend source for frontend buff metadata. It builds `buffs` and `buffMap`, applies editor overrides, and assigns `iconPath` defaults.
- Existing buff editor overrides already support `name`, `description`, `hidden`, `attribute`, `durationMs`, behavior properties, manual cancel, and QinYinGongMing stealability.
- Current `StatusBar` label is `meta.name.slice(0, 2)` for names longer than two characters. Both buff and debuff label colors are currently the same yellow. Icon border is a simple CSS border, not a frame/sprite overlay.

Important adaptation warning: our current `name` override is not display-only. It changes the preload name and can affect fallback icon path generation. The JX-style feature should probably introduce a separate display label, not reuse engine/preload `name`, unless the intent is to rename the buff everywhere.

## Adaptation Idea

The clean Zhenchuan adaptation should be a display-profile layer over existing buff metadata, not a runtime buff mutation.

Suggested model:

```ts
type BuffDisplayProfile = {
  enabled?: boolean;
  displayName?: string;
  textColor?: string;
  fontSizePx?: number;
  fontWeight?: number;
  borderStyleId?: string;
  className?: string;
  minImportance?: number;
};
```

Possible storage choices:

- Extend `buff-attribute-overrides.json` if this is a global admin/editor feature.
- Add a separate `buff-display-overrides.json` if we want to avoid mixing gameplay-ish buff properties with visual-only HUD preferences.
- Use account/user settings if this should behave like JX's local user customization rather than an admin-global game rule.

Suggested rendering path:

- Keep `meta.name` and `meta.iconPath` as canonical data.
- Compute `displayLabel = profile.displayName || meta.shortName || meta.name.slice(0, 2)`.
- Use the display label only in the StatusBar icon label unless explicitly desired elsewhere.
- Add a border overlay element or pseudo-element on top of `iconWrapper`, so the icon remains unchanged and the border can sit above it like the original `Box.UITex` frame.
- Map original frame-like presets to semantic IDs, for example `gold-45`, `red-7`, `blue-9`, rather than exposing raw numbers in the UI.
- For JX compatibility/import later, raw `nBorder` and `nFont` could be preserved internally, but editor UI should show readable presets/swatches.

Suggested editor UX for a future implementation:

- Add a `BUFF增强` section to the existing buff detail page or a new tab under the buff editor.
- Fields: enable toggle, display name, text color swatch/custom color, font size text input, border swatches, and live preview.
- Avoid native number inputs; use text input with numeric filtering.
- Avoid native dropdowns if adding preset pickers; use custom app-styled menus or segmented/swatches.
- Do not add explanatory helper text in-app unless asked; the editor can rely on labels and preview.

## Open Questions For The Next Session

- Should this customization be global/admin-owned or per-user HUD preference? JX feels per-user; our current buff editor is global/admin.
- Should the custom display name affect only the tiny status label, or also tooltip title, action history, combat logs, and debug views? Recommended first implementation: status label only.
- Should importance filtering (`nPower`) be included in the first version? It is powerful but probably secondary unless the UI has too many buffs.
- Do we have rights-safe access to the original `Box.UITex` frame art? If not, build a Zhenchuan-native border atlas that follows the same layout idea without copying raw game art.
- Do we want class/preset groups like JX (`tClass`) from the start, or simple per-buff overrides first? Recommended path: per-buff override first, then extract reusable presets if repetition appears.

## Recommended First Implementation Slice

1. Add display-only fields to buff metadata overrides: `displayName`, `displayTextColor`, `displayFontSizePx`, `displayBorderStyleId`.
2. Extend preload so each `buffMap` entry carries those display fields without changing canonical `name` or `iconPath`.
3. Update `StatusBar` to render `displayName` and style/border overlays while preserving current timers, stack badges, hidden buffs, and compact/player scale behavior.
4. Add editor controls with a live preview in the buff detail page.
5. Add a small built-in border preset set. Defer exact original-game border frame copying until the asset/legal path is clear.

## Verification Notes

No build, PM2 restart, or browser test was run because this session intentionally stayed research-only and only added this markdown experience note.

Localization follow-up on 2026-05-25: converted the remaining Traditional Chinese prose in this note to Simplified Chinese and verified the note with a focused text search.
