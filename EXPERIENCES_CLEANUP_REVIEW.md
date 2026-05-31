# EXPERIENCES Cleanup Review

Source: EXPERIENCES.md

| # | Line | Point | Keep? |
|---:|---:|---|---|
| 1 | 6 | adControl 列表改为按系数表逐行驱动 (2026-05-31) | Yes |
| 2 | 8 | 首页下拉样式二次修复：去阴影、抗底部裁切、固定最小宽度 + 登录标题文案 (2026-05-31) | Yes |
| 3 | 29 | 首页模式下拉回归修复：非管理员无法展开 + 管理员选项裁切 (2026-05-31) | Yes |
| 4 | 49 | 测试模式默认缩短CD + 首页模式下拉合并与缩窄 (2026-05-31) | Yes |
| 5 | 51 | Point 1 — 测试模式默认缩短CD开启 / Implemented | Yes |
| 6 | 55 | Point 2 — 首页 legacy 模式并入主模式下拉，且仅管理员可见 / Implemented | Yes |
| 7 | 60 | Point 3 — 模式下拉宽度缩小 30% / Implemented | Yes |
| 8 | 75 | 驭羽骋风双 Buff 合并为单 Buff (2026-05-31) | Yes |
| 9 | 96 | 测试模式新增“测试缩短CD(3秒)”按钮，对齐玉门关行为 (2026-05-31) | Yes |
| 10 | 120 | adControl 4列布局 + 状态置顶 + 数值近实时自动保存 (2026-05-31) | Yes |
| 11 | 152 | no_damage_output_coeff_check.csv 批量入表（无加成 + 已修正）(2026-05-31) | Yes |
| 12 | 173 | 继续收敛剩余未匹配行（18 → 0）(2026-05-31) | Yes |
| 13 | 212 | 离线包下载入口迁移与管理员限制 (2026-05-31) | Yes |
| 14 | 222 | 主页与资源管理器细化：未通过隐藏房间 + 常驻进度条 + 通过提示 (2026-05-31) | Yes |
| 15 | 233 | 首页通过态入口整理：新增资源管理器并移除100%文案 (2026-05-31) | Yes |
| 16 | 235 | 资源管理器收口：校验通过自动关闭 + 进度条回归 + 文案裁剪 (2026-05-31) | Yes |
| 17 | 237 | 通过态资源管理器行为回调：禁用自动校验与自动关闭 (2026-05-31) | Yes |
| 18 | 264 | 资源包反复缺文件最终修复：移除 _next/static + 显式动作同步 (2026-05-31) | Yes |
| 19 | 281 | 资源包通过后主页不解锁：显式动作同步修复 (2026-05-31) | Yes |
| 20 | 293 | 资源包两段式主页 + 缺失反复问题修复 (2026-05-31) | Yes |
| 21 | 307 | 加载离线包移到主页 + 导入完成自动校验 (2026-05-31) | Yes |
| 22 | 318 | 资源包自动补齐（免点击）+ 去除缓存完整度条 (2026-05-31) | Yes |
| 23 | 331 | 资源包策略回调：取消隐式补齐，仅保留显式下载到100% (2026-05-31) | Yes |
| 24 | 342 | 资源包“显示100%但大厅仍锁”定位与修复 (2026-05-31) | Yes |
| 25 | 353 | 资源包按钮行为更新：先校验再继续下载 + 下载中仅主按钮切换 (2026-05-31) | Yes |
| 26 | 371 | Live Playwright验收：资源包100%后首页解锁/自动加入 (2026-05-31) | Yes |
| 27 | 383 | Homepage 校验假阴性（资源页100%但大厅仍锁）修复 (2026-05-31) | Yes |
| 28 | 395 | Homepage auto-join toggle + 100% 校验 join gate (2026-05-31) | Yes |
| 29 | 412 | Resource pack freshness + coverage expansion (2026-05-31) | Yes |
| 30 | 431 | Homepage legacy dropdown admin-only + create label update (2026-05-31) | Yes |
| 31 | 441 | Yumenguan testing UI admin gating + add-skill default off (2026-05-31) | Yes |
| 32 | 452 | Ability description source audit and backup (2026-05-30) | Yes |
| 33 | 463 | 五项技能平衡调整（天地低昂/春泥护花/狂龙乱舞/疾/太阴指）(2026-05-30) | Yes |
| 34 | 475 | 天地低昂减伤覆盖回退与烈日斩/破风降防语义修复 (2026-05-30) | Yes |
| 35 | 487 | 百足/五方行尽区域圈显示时长下调为0.5秒 (2026-05-30) | Yes |
| 36 | 497 | 千蝶吐瑞无减伤语义与啸如虎Buff类别调整 (2026-05-30) | Yes |
| 37 | 506 | Yumen duplicate shrink-start guard (2026-05-29) | Yes |
| 38 | 508 | Camera dash collision-aware prediction (2026-05-29) | Yes |
| 39 | 519 | Camera ground-clamp sky-look split (2026-05-30) | Yes |
| 40 | 530 | Camera smooth sky-look blend and W preserve (2026-05-30) | Yes |
| 41 | 541 | Yumen mountain spawn anti-stuck lift (2026-05-29) | Yes |
| 42 | 543 | Yumen spectator ghost cooldown zeroing (2026-05-29) | Yes |
| 43 | 545 | Yumen sandstorm defeat announcement real-name fix (2026-05-29) | Yes |
| 44 | 547 | Yumen spectator frontend GCD/cooldown sync fix (2026-05-29) | Yes |
| 45 | 549 | GCD bar flashing stabilization (2026-05-29) | Yes |
| 46 | 551 | Yumen auto-settle shared-state sync fix (2026-05-29) | Yes |
| 47 | 609 | Yumen settlement exit footer layout update (2026-05-29) | Yes |
| 48 | 618 | Consumable gray-out softening (2026-05-29) | Yes |
| 49 | 627 | Chat input channel color tint (2026-05-29) | Yes |
| 50 | 636 | Chat slash command handling (2026-05-29) | Yes |
| 51 | 646 | React error-boundary startup crash fix (2026-05-29) | Yes |
| 52 | 656 | Ctrl+left-click ability mention insertion in chat (2026-05-29) | Yes |
| 53 | 673 | Tab auto-target range/facing refinement (2026-05-29) | Yes |
| 54 | 683 | Ability tooltip cast text wording update (2026-05-29) | Yes |
| 55 | 692 | Ability tooltip zero-cooldown wording update (2026-05-30) | Yes |
| 56 | 701 | Ability editor charge cooldown review fix (2026-05-30) | Yes |
| 57 | 712 | Charge cast lock and 生死劫月劫 timing adjustment (2026-05-30) | Yes |
| 58 | 726 | 七星拱瑞 / 疾如风 / 魂压怒涛数值校准 (2026-05-30) | Yes |
| 59 | 738 | 七星拱瑞加速缩时修正 (2026-05-30) | Yes |
| 60 | 748 | Ability tooltip cooldown should use real CD, not 3s test cap (2026-05-29) | Yes |
| 61 | 759 | Yumen remaining-count label style tweak (2026-05-29) | Yes |
| 62 | 770 | Ability/consumable hover intensity softened by 30% (2026-05-29) | Yes |
| 63 | 780 | GCD-only cooldown overlay should keep arc, hide number (2026-05-29) | Yes |
| 64 | 791 | Ability cooldown spinner regression fix for >1s cooldowns (2026-05-29) | Yes |
| 65 | 800 | Yumen spawn-facing alignment legacy-mode compatibility (2026-05-29) | Yes |
| 66 | 809 | Mode code rename: yumenguan-classic and test (2026-05-29) | Yes |
| 67 | 820 | Chat bracket color parity for class-highlighted names (2026-05-29) | Yes |
| 68 | 829 | Yumen minimap two-style ring rule (2026-05-29) | Yes |
| 69 | 838 | Yumen minimap waiting-phase blue-circle correction (2026-05-29) | Yes |
| 70 | 847 | Yumen minimap merged-ring blue-priority adjustment (2026-05-29) | Yes |
| 71 | 856 | Yumen minimap future-zone visual regression fix (2026-05-29) | Yes |
| 72 | 866 | Yumen auto-settle immediate trigger correction (2026-05-29) | Yes |
| 73 | 875 | Battle-start consumable stock correction (2026-05-29) | Yes |
| 74 | 885 | Yumen prep restart and multiplayer follow-up (2026-05-29) | Yes |
| 75 | 901 | Yumen prep phase, presence chat, and cooldown HUD (2026-05-29) | Yes |
| 76 | 917 | Dash identity, diagnostics stalls, and live regression proof (2026-05-29) | Yes |
| 77 | 932 | Lobby visibility and dash snapback regression (2026-05-28) | Yes |
| 78 | 944 | Yumen cooldown toggle, Z rescue, and dash HUD correction (2026-05-28) | Yes |
| 79 | 957 | Target mark SVG refinements (2026-05-28) | Yes |
| 80 | 969 | Cooldown import and six-player Yumen controls (2026-05-28) | Yes |
| 81 | 986 | 玉门关 KILL / 观战 death state (2026-05-28) | Yes |
| 82 | 1039 | 临时飞爪 crash, minimap target zone, and diagnostics pressure (2026-05-28) | Yes |
| 83 | 1057 | 玉门关 battle-log, arena line, ESC, and lag probes (2026-05-28) | Yes |
| 84 | 1070 | 玉门关 safe-zone speed, PM2 cleanup, and movement lag correlation (2026-05-28) | Yes |
| 85 | 1087 | 玉门关 safe-zone corrective pass 3 (2026-05-28) | Yes |
| 86 | 1102 | HP nameplate CJK text, jump intent latch, and speed-buff expiry (2026-05-26) | Yes |
| 87 | 1116 | Knockback, jump carry, shield, and stealth sound parity (2026-05-26) | Yes |
| 88 | 1132 | Expired buff runtime cleanup (2026-05-25) | Yes |
| 89 | 1146 | In-game chat window/account layout polish (2026-05-25) | Yes |
| 90 | 1187 | Alpha passed / beta stage start (2026-05-24) | Yes |
| 91 | 1233 | Local DB config drift and dash smoothing (2026-05-25) | Yes |
| 92 | 1255 | China VM deployment planning (2026-05-23) | Yes |
| 93 | 1274 | Shortcut locked role actions and backend storage audit (2026-05-23) | Yes |
| 94 | 1285 | Ability grayout combat warnings (2026-05-22) | Yes |
| 95 | 1294 | Common qinggong stale displacement grayout (2026-05-22) | Yes |
| 96 | 1303 | Post-dash jump prediction hitch (2026-05-22) | Yes |
| 97 | 1313 | Hidden buff display and shortcut settings (2026-05-23) | Yes |
| 98 | 1323 | Resource pack predownload and cache service (2026-05-22) | Yes |
| 99 | 1343 | Ability and item bar minimum readable size (2026-05-22) | Yes |
| 100 | 1352 | Network diagnostics flight recorder for China-to-US testing (2026-05-22) | Yes |
| 101 | 1374 | Generated crash/frontend logs should stay untracked (2026-05-22) | Yes |
| 102 | 1383 | Refresh movement sequence reset (2026-05-22) | Yes |
| 103 | 1394 | Crash recorder normal-end cleanup and refresh checklist (2026-05-22) | Yes |
| 104 | 1407 | PC hard-disconnect finding after state-diff sampling (2026-05-21) | Yes |
| 105 | 1419 | PC crash diagnostics overhead finding (2026-05-21) | Yes |
| 106 | 1430 | Random white-screen crash recorder implementation (2026-05-21) | Yes |
| 107 | 1453 | Random white-screen crash investigation plan (2026-05-21) | Yes |
| 108 | 1464 | Qi-field channel timing, sound, and terrain visibility (2026-05-21) | Yes |
| 109 | 1482 | Qi-field ground placement and owner colors (2026-05-21) | Yes |
| 110 | 1500 | AoE vertical cylinder hit range (2026-05-21) | Yes |
| 111 | 1517 | Jump branch verification and Jiu Xiao cast sound (2026-05-21) | Yes |
| 112 | 1532 | Camera distance display remap and jump parity research (2026-05-21) | Yes |
| 113 | 1555 | ESC camera settings for game matching (2026-05-21) | Yes |
| 114 | 1573 | Horizontal-only exported map footprint scale (2026-05-21) | Yes |
| 115 | 1590 | BattleArena camera centering at upward pitch (2026-05-21) | Yes |
| 116 | 1606 | Exported map cache and warmup optimization (2026-05-21) | Yes |
| 117 | 1637 | Scene loading timeline report and loader parallelism (2026-05-21) | Yes |
| 118 | 1656 | Channel completion stealth and load diagnostics (2026-05-21) | Yes |
| 119 | 1673 | Ground dash targeting and power lock warnings (2026-05-21) | Yes |
| 120 | 1694 | Live ESC sound settings deployment verification (2026-05-21) | Yes |
| 121 | 1711 | ESC ability sound settings range and mute (2026-05-21) | Yes |
| 122 | 1731 | Browser-like 任驰骋 sound and self-AOE cast readiness (2026-05-20) | Yes |
| 123 | 1750 | Carrier-centered 百足 explosion and channel sound teardown (2026-05-20) | Yes |
| 124 | 1770 | Ability-level sound review decisions (2026-05-20) | Yes |
| 125 | 1786 | Dash-complete sounds without audio speed-up (2026-05-20) | Yes |
| 126 | 1804 | Targeted and exact-duration ability sounds (2026-05-20) | Yes |
| 127 | 1824 | Ability sound special playback rules (2026-05-20) | Yes |
| 128 | 1845 | PM2 restart scope for Zhenchuan checks (2026-05-20) | Yes |
| 129 | 1858 | Sound review ability-level judging and channel labels (2026-05-20) | Yes |
| 130 | 1878 | Sound review simplified identity and count filters (2026-05-20) | Yes |
| 131 | 1895 | Sound review live crash and Playwright guard (2026-05-20) | Yes |
| 132 | 1912 | Sound review ability editor decision tab (2026-05-20) | Yes |
| 133 | 1928 | Sound browser grouped review UI (2026-05-20) | Yes |
| 134 | 1944 | Ability sound browser, haste playback, and volume settings (2026-05-16) | Yes |
| 135 | 1961 | Ability sound playback integration (2026-05-16) | Yes |
| 136 | 1978 | Ability and transmission audit (2026-05-10) | Yes |
| 137 | 1998 | In-game warning overlay and controls (2026-05-09) | Yes |
| 138 | 2017 | Charge stack box border removal (2026-05-09) | Yes |
| 139 | 2030 | Consumable count badge simplified (2026-05-09) | Yes |
| 140 | 2044 | Consumable stock counts and control-panel refill (2026-05-09) | Yes |
| 141 | 2060 | Consumable bar greys out unopened items (2026-05-09) | Yes |
| 142 | 2075 | 浮光掠影 遁影 only protects movement (2026-05-09) | Yes |
| 143 | 2091 | 月影沙 blocked by 伪装 root state (2026-05-09) | Yes |
| 144 | 2105 | 伪装 special bar cancel ability (2026-05-09) | Yes |
| 145 | 2122 | 伪装 facing preservation and GLB rotation sync (2026-05-09) | Yes |
| 146 | 2138 | 伪装 leash area on channel completion (2026-05-09) | Yes |
| 147 | 2152 | 月影沙 grounded/control correction and disguise-stealth overlap correction (2026-05-09) | Yes |
| 148 | 2174 | Forward-channel stealth timing correction (2026-05-09) | Yes |
| 149 | 2192 | Disguise duration cap, status hover time formatting, and 月影沙 consumable (2026-05-09) | Yes |
| 150 | 2211 | 御骑 root lock, disguise strip, and highlighted minute cooldown labels (2026-05-09) | Yes |
| 151 | 2227 | Root-locked 扶摇直上 and minute-style HUD cooldown text (2026-05-09) | Yes |
| 152 | 2243 | Bandage channel should not break disguise (2026-05-09) | Yes |
| 153 | 2258 | Ability charge frame fit and status stack badge alignment (2026-05-09) | Yes |
| 154 | 2276 | iPad in-game load failure from missing ResizeObserver support (2026-05-09) | Yes |
| 155 | 2292 | Combat icon darkening and right-drag camera smoothing (2026-05-09) | Yes |
| 156 | 2312 | Consumable bar settings, disguise texture, and root-facing fixes (2026-05-09) | Yes |
| 157 | 2337 | 砂石伪装 consumable and disguise targeting (2026-05-09) | Yes |
| 158 | 2356 | Debuff combat keep-alive and consumables (2026-05-09) | Yes |
| 159 | 2375 | LayoutShell home background and F11 fullscreen correction (2026-05-08) | Yes |
| 160 | 2392 | BattleArena 战斗中 status and fullscreen HUD fixes (2026-05-08) | Yes |
| 161 | 2412 | BattleArena ESC scaling, Catcake defaults, and WebGL recovery (2026-05-08) | Yes |
| 162 | 2434 | BattleArena compact ESC test/settings rework (2026-05-08) | Yes |
| 163 | 2456 | BattleArena ESC settings menu rework and top bar resize (2026-05-08) | Yes |
| 164 | 2476 | BattleArena compact top bar and custom UI guide visibility follow-up (2026-05-08) | Yes |
| 165 | 2496 | BattleArena top metrics bar and custom UI placement correction (2026-05-08) | Yes |
| 166 | 2516 | BattleArena item count, GCD/status sizing, and drag isolation follow-up (2026-05-08) | Yes |
| 167 | 2535 | BattleArena icon chrome, item slots, and reorder prediction follow-up (2026-05-08) | Yes |
| 168 | 2554 | BattleArena item bar, tooltip alpha, and optimistic hotbar reorder (2026-05-08) | Yes |
| 169 | 2573 | BattleArena slot order, charge frame, and status blink follow-up (2026-05-08) | Yes |
| 170 | 2594 | BattleArena tooltip, custom UI, and empty-slot hotbar round (2026-05-08) | Yes |
| 171 | 2616 | Ability bar pointer drag and hover styling round (2026-05-08) | Yes |
| 172 | 2636 | Ability bar drag/drop follow-up and visible hover overlay (2026-05-08) | Yes |
| 173 | 2657 | Ability bar hover, discard zone, and WebGL recovery round (2026-05-08) | Yes |
| 174 | 2679 | Ability shield, backpedal jump, hotbar scale, and leave prompt round (2026-05-08) | Yes |
| 175 | 2700 | BattleArena HUD correction round and Playwright coverage (2026-05-08) | Yes |
| 176 | 2722 | BattleArena HUD polish, shield display, and control panel formatting (2026-05-08) | Yes |
| 177 | 2741 | BattleArena HUD sizing and target-of-target custom UI split (2026-05-08) | Yes |
| 178 | 2760 | BattleArena HUD save moved from localStorage to user profile (2026-05-08) | Yes |
| 179 | 2775 | Fullscreen-safe BattleArena custom UI scaling (2026-05-08) | Yes |
| 180 | 2790 | In-game home button, timing-bar resize, and top-bar route gating (2026-05-08) | Yes |
| 181 | 2807 | Self timing bars custom-UI anchors and icon-bar title trim (2026-05-08) | Yes |
| 182 | 2824 | Target channel-bar width context and placement under icon bar (2026-05-08) | Yes |
| 183 | 2841 | Status countdown checkpoint blink and full-height edit overlay (2026-05-08) | Yes |
| 184 | 2859 | Custom UI status overlay restore and guide height retune (2026-05-08) | Yes |
| 185 | 2877 | Status-bar custom UI height correction after wrong-layer edit (2026-05-08) | Yes |
| 186 | 2892 | Target ability-bar split, status-frame resize, and self-bar width trim (2026-05-08) | Yes |
| 187 | 2911 | Custom UI editing for player/target/ability HUD anchors (2026-05-08) | Yes |
| 188 | 2929 | Slow one-second urgent buff fade correction (2026-05-08) | Yes |
| 189 | 2943 | Single HP-boundary divider, second-aligned blink, and borderless target-target icons (2026-05-08) | Yes |
| 190 | 2961 | Status-bar timing spacing frame retune and enemy divider restore (2026-05-08) | Yes |
| 191 | 2984 | Icon-bar empty-health gray state and white-track inset fix (2026-05-07) | Yes |
| 192 | 2999 | Self border darkening and target-target self relationship styling (2026-05-07) | Yes |
| 193 | 3014 | Shared icon-bar HP color retune (2026-05-07) | Yes |
| 194 | 3027 | Self icon bar conversion and silver-orange palette update (2026-05-07) | Yes |
| 195 | 3044 | Target-target title simplification and spacing retune (2026-05-07) | Yes |
| 196 | 3061 | Status bar scale trim and target-target icon bar spacing (2026-05-07) | Yes |
| 197 | 3081 | Enemy icon bar width reduction (2026-05-07) | Yes |
| 198 | 3092 | Status readability, shield display, icon bar, and HTTPS verification (2026-05-07) | Yes |
| 199 | 3115 | Target selection and split movable status bars (2026-05-07) | Yes |
| 200 | 3134 | Homepage start styling, status hover rules, and custom UI placement (2026-05-07) | Yes |
| 201 | 3154 | Status layout, disconnect prompt, target-target HUD, and BVH audit (2026-05-07) | Yes |
| 202 | 3176 | Exported map BVH helper regression (2026-05-07) | Yes |
| 203 | 3191 | Cast guards, leave flow, lobby controls, target HUD, and status rows (2026-05-07) | Yes |
| 204 | 3217 | Testing battle reset, channel cancellation, and manual battle exit (2026-05-07) | Yes |
| 205 | 3238 | Standing casts, active-channel errors, movement feel, and map loading (2026-05-06) | Yes |
| 206 | 3262 | Control-only immunity, dummy stats, restart HP, and client diff load (2026-05-06) | Yes |
| 207 | 3280 | Reverse channel finals, AD buffs, and purple defaults (2026-05-06) | Yes |
| 208 | 3301 | Percent ability corrections and movement recovery diagnostics (2026-05-06) | Yes |
| 209 | 3321 | Runtime reconnect, event history, 化劲, and HP percent gates (2026-05-06) | Yes |
| 210 | 3340 | Attack damage overhaul (2026-05-06) | Yes |
| 211 | 3361 | Haste stat and timing acceleration (2026-05-06) | Yes |
| 212 | 3385 | Ability Editor tab grouping cleanup (2026-05-06) | Yes |
| 213 | 3401 | GCD bar polish and jue mai cap tuning (2026-05-06) | Yes |
| 214 | 3419 | GCD runtime/editor/visual bar overhaul (2026-05-06) | Yes |
| 215 | 3446 | Pull/knockback buff audit (2026-05-06) | Yes |
| 216 | 3469 | C panel display settings and GCD audit (2026-05-06) | Yes |
| 217 | 3492 | Defense stat and combat display updates (2026-05-05) | Yes |
| 218 | 3509 | In-game ability and buff hover panels (2026-05-05) | Yes |
| 219 | 3531 | Editor session state, dummy buff cancel, and movement audits (2026-05-05) | Yes |
| 220 | 3556 | Buff links, display metadata, and support-target cleanup (2026-05-05) | Yes |
| 221 | 3576 | 减伤被顶 runtime + editor (2026-05-05) | Yes |
| 222 | 3608 | 渊落点修正 + 雾暗迷云混乱重定向 (2026-05-03) | Yes |
| 223 | 3640 | 凌然天风特殊跳跃实现 (2026-05-03) | Yes |
| 224 | 3684 | 御骑 mounted runtime (2026-05-03) | Yes |
| 225 | 3704 | 御骑高度 / 跳跃限制 follow-up (2026-05-03) | Yes |
| 226 | 3732 | 可以马上施展 editor property (2026-05-03) | Yes |
| 227 | 3749 | 任驰骋 + 纵轻骑 mounted follow-up (2026-05-03) | Yes |
| 228 | 3771 | 御骑后退限速 + 渊显示 Buff + 舍身诀命名 follow-up (2026-05-03) | Yes |
| 229 | 3792 | 友方目标技能第二轮修正 + 图标路径编码 (2026-05-03) | Yes |
| 230 | 3813 | 友方目标技能基础设施 + 舍身诀 / 渊 / 听风吹雪 (2026-05-02) | Yes |
| 231 | 3849 | 龙啸九天气场/机关摧毁 + 人剑合一气场联动 (2026-05-02) | Yes |
| 232 | 3869 | 无相诀改为施放时快照减伤档位 (2026-05-02) | Yes |
| 233 | 3888 | 反隐灰置兜底 + 碎星辰/破苍穹回调 (2026-05-02) | Yes |
| 234 | 3903 | 反隐灰置 + 云栖松/徐如林贯体化 + Buff 列表快速属性按钮 (2026-05-02) | Yes |
| 235 | 3925 | 风袖/千蝶数值调整 + 反隐 companion cleanup + 非贯体清单审计 (2026-05-02) | Yes |
| 236 | 3945 | 撼如雷 companion reveal fix + non-贯体 heal crits (2026-05-02) | Yes |
| 237 | 3961 | Live 会心 panel + split 会心效果 + 紫气东来/撼如雷 (2026-05-02) | Yes |
| 238 | 3981 | 碎星辰/破苍穹 channel-zone crit buffs (2026-05-02) | Yes |
| 239 | 4005 | 外功会心/内功会心 split + 风来吴山/狂龙乱舞 retune (2026-05-02) | Yes |
| 240 | 4035 | 会心 float polish + 龙吟 crit-reset follow-up (2026-05-02) | Yes |
| 241 | 4037 | High-damage pass retune (2026-05-02) | Yes |
| 242 | 4075 | 会心 panel toggle + damage float wording/layout follow-up (2026-05-02) | Yes |
| 243 | 4094 | Crit chance presets + global crit damage pipeline (2026-05-02) | Yes |
| 244 | 4115 | Special-bar GCD display, persistent per-ability cooldown, and silence bypass (2026-05-02) | Yes |
| 245 | 4132 | 九霄风雷 follow-up rule corrections: dependent buff cleanup, reverse channel, special-bar GCD, 真·下车 lockout breadth (2026-05-02) | Yes |
| 246 | 4155 | 洗兵雨 visual polarity + random ring placement + 九霄子技能 editor hiding + 魂压怒涛 retune (2026-05-02) | Yes |
| 247 | 4176 | 九霄风雷 temporary skill bar + disarm channel interruption (2026-05-02) | Yes |
| 248 | 4196 | Lockout family expansion: 缴械, 无需武器 editor, 洗兵雨 pickup zone, 抢珠式 (2026-05-02) | Yes |
| 249 | 4220 | Buff-channel shield fix + FEAR_IMMUNE addition (2026-05-02 round 12) | Yes |
| 250 | 4236 | Channel direction fixes + INTERRUPT_IMMUNE removal + 剑飞 dual-mode (2026-05-02 round 11) | Yes |
| 251 | 4256 | 不可被打断 flip + 沉默免疫 unification + 剑飞惊天 + uninterruptible shield (2026-05-02) | Yes |
| 252 | 4286 | 翔极碧落 + interruptible flag + channel filter (2026-05-02) | Yes |
| 253 | 4300 | Channel bar polish round 2: blue border, instant fade, larger enemy text, success-green only on enemy (2026-05-02) | Yes |
| 254 | 4314 | Channel bar polish: per-variant completion semantics, teal border, label centered over enemy bar (2026-05-01) | Yes |
| 255 | 4330 | Channel bar lifecycle: success/interrupt phases, fade-out, school-colored fill, timer label (2026-05-01) | Yes |
| 256 | 4345 | Channel bar visuals: enemy is a yellow bar with name inside, forward channels show no middle 段落 (2026-05-01) | Yes |
| 257 | 4357 | Channel detail pages should show forward/reverse type first, then the concrete maintain/timing answers (2026-05-01) | Yes |
| 258 | 4368 | Enemy channel UI needs normalized runtime channel metadata, and pure channels cannot be inferred from buffs[] alone (2026-05-01) | Yes |
| 259 | 4380 | Channeling should suppress jump pulses before movement consumes them, not cancel after jumpCount changes (2026-05-01) | Yes |
| 260 | 4391 | Replacement casts must validate through the new ability first, then cancel activeChannel and still run breakOnPlay for pure-channel starts (2026-05-01) | Yes |
| 261 | 4403 | Auto-derived editor lists should treat default metadata and manual decisions as separate buckets (2026-05-01) | Yes |
| 262 | 4416 | Ability-specific buff stealing should reuse addBuff for ownership transfer, then patch runtime timing from the stolen instance (2026-05-01) | Yes |
| 263 | 4428 | Observer-side instant-snap visuals need a server-shared trigger, not only the casting client's local timestamp (2026-05-01) | Yes |
| 264 | 4438 | A local hard-snap branch must update both localPositionRef and localRenderPosRef, or instant swaps still look like movement (2026-05-01) | Yes |
| 265 | 4448 | Instant backend swaps can still look like travel if opponent character rendering keeps an unconditional lerp (2026-05-01) | Yes |
| 266 | 4457 | If a hover-targeted dash already has a live world point, cast it immediately instead of routing through generic target validation (2026-05-01) | Yes |
| 267 | 4468 | Ground-target-only abilities need both a pending-ground cast on the client and an explicit ground-target requirement on the server (2026-05-01) | Yes |
| 268 | 4479 | Repositioning from one distance band to the same distance band should use circle intersections, not perpendicular shortcuts (2026-05-01) | Yes |
| 269 | 4489 | BattleArena cast-time ability hooks must key off AbilityInfo.abilityId, not AbilityInfo.id (2026-05-01) | Yes |
| 270 | 4500 | If a proc dash must stop on walls, let activeDash own the travel and only validate the destination band (2026-05-01) | Yes |
| 271 | 4511 | Instant swaps and forced pulls should use different client/runtime signals even if they share pull-immunity checks (2026-05-01) | Yes |
| 272 | 4522 | Pull-immunity cast gates should key off the exact pull-immunity effect, not generic control immunity (2026-05-01) | Yes |
| 273 | 4533 | Blink-like follow-up movement is safest here as a prevalidated 1-tick dash, not a raw teleport (2026-05-01) | Yes |
| 274 | 4544 | 盾立 reflect whitelist plumbed through ability override system (2026-04-30) | Yes |
| 275 | 4557 | Whole-cast reflection belongs in PlayAbility, not inside damage math, and it should only trigger on direct player-targeted casts (2026-04-30) | Yes |
| 276 | 4573 | If the effect should feel like another dimension, ease the overlay and tint it to the ability fantasy instead of snapping to flat black (2026-04-30) | Yes |
| 277 | 4587 | In React render scope, do not derive from a state variable before that state is declared (2026-04-30) | Yes |
| 278 | 4600 | For blackout effects, keep the blackout and self-only layers mounted so activation does not flash or hide self (2026-04-30) | Yes |
| 279 | 4614 | A blackout hole reads like a spotlight; if only self should remain, render self above a solid blackout instead (2026-04-30) | Yes |
| 280 | 4628 | If off-map space is still visible, scene hiding is not enough; add a viewport blackout layer (2026-04-30) | Yes |
| 281 | 4642 | Backend-only target-buff cast bans should usually be mirrored in frontend readiness too (2026-04-30) | Yes |
| 282 | 4655 | If the player should still see self and HUD, blind the world at the scene layer instead of painting over the viewport (2026-04-30) | Yes |
| 283 | 4669 | If a buff should make a target ineligible for a cast, reject it in validateAction instead of silently no-oping the effect (2026-04-30) | Yes |
| 284 | 4682 | A JSX overlay inside an event callback is dead code even if the file still compiles (2026-04-30) | Yes |
| 285 | 4695 | Some custom debuffs should bypass the shared diminishing-returns pipeline entirely (2026-04-30) | Yes |
| 286 | 4708 | When a status should blind the player, a canvas blackout layer is cheaper and safer than hiding every scene mesh (2026-04-30) | Yes |
| 287 | 4722 | If a player should become unable to see others, filter their local scene inputs once at BattleArena entry (2026-04-30) | Yes |
| 288 | 4738 | Forced-loss-of-control rolls can still depend on the target's current control state at cast time (2026-04-30) | Yes |
| 289 | 4752 | If a targeted channel should break on target range, use the standard channelCancelOnOutOfRange path (2026-04-30) | Yes |
| 290 | 4766 | Hidden untargetable states need a view-layer hide rule plus a natural-expiry follow-up buff (2026-04-30) | Yes |
| 291 | 4782 | Forced-movement debuffs should store their chosen mode on the runtime buff, and "target anyone" can be modeled as opponent-target + self opt-in (2026-04-30) | Yes |
| 292 | 4798 | Fixed-distance knockbacks must be tuned by dash duration, and cast-breaking buffs on pure channels need a pure-channel hook too (2026-04-30) | Yes |
| 293 | 4816 | Control-copy cleanse skills need a dedicated capture path, and BattleArena filter state can safely persist via localStorage (2026-04-30) | Yes |
| 294 | 4834 | New custom buffs must be declared for preload/status bar, and redirect callers must always trust `adjustedDamage` (2026-04-30) | Yes |
| 295 | 4852 | Full HP must never suppress HEAL events (system rule, 2026-05 session) | Yes |
| 296 | 4862 | Test-only target dummies (cheat) belong in their own panel and reuse `TargetEntity` (2026-04-29) | Yes |
| 297 | 4874 | Very-short refreshed buffs need duration headroom or `hiddenInStatusBar` (2026-04-29) | Yes |
| 298 | 4882 | Entity targets need first-class buff runtime, not damage-only support (2026-04-29) | Yes |
| 299 | 4896 | Entity-targeted casts must not consult the opposing player's dodge state (2026-04-29) | Yes |
| 300 | 4906 | Entity targets must flow through cast validation (2026-04-29) | Yes |
| 301 | 4920 | Entity targets need every shared damage loop, not just direct DAMAGE (2026-04-29) | Yes |
| 302 | 4934 | 化解 (Shield Absorption) Display System (2026-04-26) | Yes |
| 303 | 4950 | DISPLACEMENT Bypass for 镇山河 (2026-05 session) | Yes |
| 304 | 4964 | 捉影式 Pull Distance Fix (2026-05 session) | Yes |
| 305 | 4970 | Ability DamageType Tag System (2026-04-25) | Yes |
| 306 | 4987 | Buff Duration Override Not Taking Effect (2026-04-23) | Yes |
| 307 | 5001 | Icon Asset Reorganization | Yes |
| 308 | 5009 | Coordinate System | Yes |
| 309 | 5014 | Scaling the exported 3D map (50% scale-up, 2026-04-12) | Yes |
| 310 | 5025 | CORS / Nginx | Yes |
| 311 | 5034 | Mongoose Mixed Fields | Yes |
| 312 | 5041 | Collision System (collision-test mode) | Yes |
| 313 | 5048 | 玉门关 camera wall clamp + close-body hide (2026-04-15) | Yes |
| 314 | 5085 | Long-session React churn during collision-test (2026-04-16) | Yes |
| 315 | 5100 | Dashing Abilities | Yes |
| 316 | 5102 | Control-system redesign baseline and gaps (2026-04-17) | Yes |
| 317 | 5112 | Corrected control fixes for upward jump, knockback, and mohe cleanse (2026-04-17) | Yes |
| 318 | 5122 | DR visibility and stale-build lesson (2026-04-17) | Yes |
| 319 | 5130 | Realtime countdowns need server-time alignment (2026-04-17) | Yes |
| 320 | 5136 | Zone invulnerability needs effect-layer blocking, not target-validation failure (2026-04-17) | Yes |
| 321 | 5140 | Dash reach-hit + control immunity filtering updates (2026-04-19) | Yes |
| 322 | 5146 | 镇山河 guaranteed self-buff and single dash runtime lesson (2026-04-18) | Yes |
| 323 | 5158 | Abilities / Editor | Yes |
| 324 | 5160 | Range bonuses must extend channel cancel thresholds and actual ground-target dash travel, and lockout immunity must stay narrower than control immunity (2026-05-01) | Yes |
| 325 | 5165 | Buff-driven range bonuses must go through one shared effective-range helper on both backend and frontend (2026-05-01) | Yes |
| 326 | 5170 | Dynamic wall abilities need shared geometry helpers across backend validation, GameLoop, and BattleArena (2026-05-01) | Yes |
| 327 | 5175 | Follow-self protection fields are easier as visual zones plus buff-keyed runtime rules than as pure damage zones (2026-05-01) | Yes |
| 328 | 5180 | Forward strip walls and instant knockback follow-ups should reuse the existing geometry/knockback rules instead of inventing a parallel feel (2026-05-01) | Yes |
| 329 | 5185 | Wall visuals must use the same world-to-Three facing basis as characters, and forced displacement must bypass cosmetic easing in the render loop (2026-05-01) | Yes |
| 330 | 5190 | Thin translucent walls need unlit color-preserving materials, and fast movement against newly spawned walls needs sweep-based near-side resolution (2026-05-01) | Yes |
| 331 | 5195 | Charge-based rapid-cast abilities should keep tooltip timing and `chargeCastLockTicks` in sync (2026-05-01) | Yes |
| 332 | 5200 | If a wall should visually extend outward, animate only the mesh, but if it should stop airborne players only when it reaches them, both server and client collision must respect vertical overlap (2026-05-01) | Yes |
| 333 | 5205 | If a spawn animation should read clearly, the mesh must mount in its animated state on frame 1, not pop in full-size and only shrink on the next `useFrame` tick (2026-05-01) | Yes |
| 334 | 5210 | DAMAGE_IMMUNE must be checked in every damage code path (2026-04-29) | Yes |
| 335 | 5217 | Ability rarity system (2026-04-29) | Yes |
| 336 | 5223 | Cheat ability picker must exclude hidden special-bar skills (2026-05-02) | Yes |
| 337 | 5228 | 九霄风雷 form-skill rules must stay split per sub-ability (2026-05-02) | Yes |
| 338 | 5235 | Frontend lock-movement channels must not cancel active jump air-shift carry (2026-05-02) | Yes |
| 339 | 5240 | New abilities added 2026-04-20: 春泥护花, 圣明佑, 烟雨行, 太阴指 | Yes |
| 340 | 5246 | STACK_ON_HIT_GUAN_TI_HEAL effect type pattern (2026-04-20) | Yes |
| 341 | 5251 | Pull immunity via KNOCKBACK_IMMUNE (2026-04-20) | Yes |
| 342 | 5255 | Channel bar on jump (frontend, 2026-04-20) | Yes |
| 343 | 5260 | 绝脉 max stacks 3→12 (2026-04-20) | Yes |
| 344 | 5264 | Charged GCD must use `chargeLockTicks` (2026-04-19) | Yes |
| 345 | 5269 | Ability property editor should layer runtime JSON overrides over canonical abilities (2026-04-17) | Yes |
| 346 | 5281 | Dash in collision-test mode bypassed BVH (FIXED) | Yes |
| 347 | 5287 | 疾 ability visual "collision with opponent" in frontend | Yes |
| 348 | 5293 | LOS / Vision Checks | Yes |
| 349 | 5295 | Small terrain-level objects falsely blocking LOS (FIXED) | Yes |
| 350 | 5306 | Buff Editor (2026-04-22) | Yes |
| 351 | 5328 | LOS still false-blocking at range — eye-height + AABB-inside fix (2025) | Yes |
| 352 | 5340 | Build / Deployment | Yes |
| 353 | 5346 | Atlas connectivity failure is separate from gameplay/unit edits (2026-04-14) | Yes |
| 354 | 5355 | PM2 frontend restart can fail with stale port ownership (2026-04-14) | Yes |
| 355 | 5360 | PM2/frontend can flap when a separate `next dev` owns port 3000 (2026-04-19) | Yes |
| 356 | 5366 | Collision-test movement regression check after canonical-unit migration (2026-04-14) | Yes |
| 357 | 5377 | Atlas connect failure root cause: local nftables blocked outbound MongoDB port (2026-04-14) | Yes |
| 358 | 5389 | Post-dash jumps must not inherit dash-speed carry (2026-04-14) | Yes |
| 359 | 5396 | Prediction drift root cause: frontend duplicates backend movement state machine (2026-04-14) | Yes |
| 360 | 5405 | Collision-test player collision body reduced to 1.5h / 0.32r (2026-04-14) | Yes |
| 361 | 5410 | Collision-test player body width retuned to 1.5h / 0.384r (2026-04-14) | Yes |
| 362 | 5414 | House-wall and roof-edge behavior in collision-test (2026-04-14) | Yes |
| 363 | 5425 | Mobile Controls | Yes |
| 364 | 5427 | Virtual joystick for touch devices | Yes |
| 365 | 5434 | Touch camera rotation (iPad/iPhone) | Yes |
| 366 | 5443 | Frontend Client-Side BVH LOS | Yes |
| 367 | 5445 | Real-time ability LOS indicator without server round-trip | Yes |
| 368 | 5453 | Legacy "ghost" AABB entities blocking LOS (the root breakthrough) | Yes |
| 369 | 5462 | Dash Wall Tunneling | Yes |
| 370 | 5464 | Fast dashes clipping through walls (FIXED) | Yes |
| 371 | 5472 | Debug/Display Cleanup | Yes |
| 372 | 5474 | AABB "Part Boxes" button replaced with BVH mesh | Yes |
| 373 | 5479 | `instanceId` undefined crash in commonUpdated map | Yes |
| 374 | 5484 | `allowOverrangeCameraZoom` runtime crash from helper-scope leak (2026-04-19) | Yes |
| 375 | 5489 | `Cannot access 'nx' before initialization` from misplaced hook dependency (2026-04-19) | Yes |
| 376 | 5495 | `PCFSoftShadowMap` deprecation warning cleanup (2026-04-19) | Yes |
| 377 | 5506 | Export-reader sunlight is not static (collision-test lighting) | Yes |
| 378 | 5512 | Export-reader fill lights use linear colors, not hex approximations | Yes |
| 379 | 5517 | Remaining export-reader parity gaps after sun matching | Yes |
| 380 | 5522 | Centralize test UI behind one hotkey panel | Yes |
| 381 | 5527 | Use `Esc` as the primary in-game testing/debug panel hotkey | Yes |
| 382 | 5532 | Height / jump HUD must be floor-relative, not absolute-Z | Yes |
| 383 | 5537 | Double-jump prediction can feel wrong even when jump constants match | Yes |
| 384 | 5542 | Invalid extra jump input can corrupt local airborne state | Yes |
| 385 | 5548 | 鸟翔碧空 needs a local jump-cap prediction bridge | Yes |
| 386 | 5558 | 玉门关 mode should not surface pickups | Yes |
| 387 | 5563 | Fuyao directional jump has special travel budgets | Yes |
| 388 | 5573 | Frontend Fuyao arc smoothing depends on budget order and render follow-through | Yes |
| 389 | 5579 | Bird directional jumps can use the same travel budget as Fuyao follow-up jumps | Yes |
| 390 | 5586 | Mid-air facing must stay authoritative, and the combined 扶摇+鸟翔 opener can now use the boosted forward budget | Yes |
| 391 | 5594 | Unit rescale mistake: ability-layer distances were scaled when only locomotion needed scaling | Yes |
| 392 | 5599 | Explicit steer-dash speeds can still be old-scale even after dash-distance rollback | Yes |
| 393 | 5605 | Correction: explicit steer-dash `speedPerTick` values are literal authored units | Yes |
| 394 | 5610 | Uneven exported terrain can sink flat ground-effect visuals below the floor | Yes |
| 395 | 5615 | Exported-map ground casts need their own pointer surface | Yes |
| 396 | 5620 | Base movement must be normalized across all control modes | Yes |
| 397 | 5626 | RMB strafe facing + jump-phase travel budgets (2026-04-14) | Yes |
| 398 | 5647 | Unit Rescale (2026-04-14) | Yes |
| 399 | 5649 | Problem | No (merge into parent section) |
| 400 | 5652 | Solution — `UNIT_SCALE = 2.2` (1 new unit = 2.2 old world units) | Yes |
| 401 | 5655 | Collision-test canonical-unit migration (2026-04-14) | Yes |
| 402 | 5663 | Files changed | No (merge into parent section) |
| 403 | 5675 | Key principle | No (merge into parent section) |
| 404 | 5678 | Follow-up clarification — gameplay range must use new units end-to-end (2026-04-14) | Yes |
| 405 | 5693 | Remaining blocker — canonical runtime state is still raw coordinates (2026-04-14) | Yes |
| 406 | 5707 | 新增锁足技能与锁足施法限制联动 (2026-04-19) | Yes |
| 407 | 5714 | 五方行尽地面施法、递减层数与后半段受击解除修正 (2026-04-19) | Yes |
| 408 | 5722 | 条件强化技能“棒打狗头”实现经验 (2026-04-19) | Yes |
| 409 | 5727 | 读条同步与充能并行恢复修正 (2026-04-19) | Yes |
| 410 | 5733 | 新技能实现与位移预测核对 (2026-04-19) | Yes |
| 411 | 5738 | 捉影式时序与空中拉拽修正 (2026-04-19) | Yes |
| 412 | 5745 | Bug fixes and new abilities (2026-04-21) | Yes |
| 413 | 5786 | Buff Attribute Tag System (2025) | Yes |
| 414 | 5788 | Feature: Buff editor tab in ability editor | No (merge into parent section) |
| 415 | 5797 | Pitfall: replace_string_in_file only replaces the matched segment | No (merge into parent section) |
| 416 | 5803 | Buff property editor architecture — engine override path | Yes |
| 417 | 5812 | Buff detail page pattern | Yes |
| 418 | 5820 | Dispel system (DISPEL_BUFF_ATTRIBUTE effect type) | Yes |
| 419 | 5830 | ignoreDodge ability property | Yes |
| 420 | 5836 | Canonical Class (School) Ordering | Yes |
| 421 | 5846 | New Effect Types (April 2026 batch) | Yes |
| 422 | 5852 | 玄水蛊 Damage Redirect Design | Yes |
| 423 | 5859 | 七星拱瑞 On-Damage Break Design | Yes |
| 424 | 5865 | On-Damage Hooks Refactor (七星拱瑞 break + 玄水蛊 redirect) | Yes |
| 425 | 5889 | Pre-Damage Redirect Pattern (玄水蛊 Fix) | Yes |
| 426 | 5893 | Post-Pull Stun Pattern (极乐引) | Yes |
| 427 | 5897 | On-Play Trigger Hook (傍花随柳) | Yes |
| 428 | 5901 | Round 3: Ability Fixes + New Abilities (Session 3 Cont.) | Yes |
| 429 | 5903 | Fixes Applied | No (merge into parent section) |
| 430 | 5908 | New Abilities | No (merge into parent section) |
| 431 | 5914 | New Effect Types Added | No (merge into parent section) |
| 432 | 5918 | Lessons Learned | No (merge into parent section) |
| 433 | 5924 | Typed Damage Reduction + Zone Channel Abilities (2026-04-25) | Yes |
| 434 | 5926 | Architecture: damageType propagation gap | No (merge into parent section) |
| 435 | 5939 | Architecture: DAMAGE_REDUCTION stacking | No (merge into parent section) |
| 436 | 5950 | Zone channel buffs: use addBuff() | Yes |
| 437 | 5956 | PM2 restart loop deadlock | Yes |
| 438 | 5966 | Zone buff enter/exit architecture (2026-04-25) | Yes |
| 439 | 5984 | 4 new abilities: 无相诀, 应天授命, 斩无常, 灭 (2026-04-xx) | Yes |
| 440 | 6011 | 远程弹道技能 Editor Tab (2026-05 session) | Yes |
| 441 | 6026 | isProjectile Blocking Bug Fix (2026-05 session) | Yes |
| 442 | 6034 | 斩无常 Channel Range Display (2026-05 session) | Yes |
| 443 | 6042 | isProjectile Display Fix verification (2026-04 session) | Yes |
| 444 | 6047 | PROJECTILE_IMMUNE: Buff bypass fix (2026-04 session) | Yes |
| 445 | 6056 | Legacy Damage Route Audit (2026-04-26 session) | Yes |
| 446 | 6084 | 孤影化双 ability implementation (2025) | Yes |
| 447 | 6086 | Pattern: snapshot + deferred restore via buff expiry | No (merge into parent section) |
| 448 | 6094 | 逐云寒蕊 (zhu_yun_han_rui) — first targetable HP-bearing entity | Yes |
| 449 | 6116 | Entity-target combat surfaces (2026-04-22) | Yes |
| 450 | 6126 | TargetEntity 综合战斗作业 (Round 2) | Yes |
| 451 | 6128 | Pull on entities was a teleport | Yes |
| 452 | 6131 | Ground-AOE on entity targeted player position | Yes |
| 453 | 6134 | Tab cycling needed exclusion + front cone | Yes |
| 454 | 6137 | Knockback didn't push dummies | Yes |
| 455 | 6140 | 沧月 (multi-target test ability) | Yes |
| 456 | 6148 | TargetEntity Round 3 — wall stops, knockback angle, clear-all | Yes |
| 457 | 6150 | Entity knockback ignored walls/terrain | Yes |
| 458 | 6153 | 沧月 knockback direction must originate from the caster | Yes |
| 459 | 6156 | Clear-all-dummies button | Yes |
| 460 | 6159 | TargetEntity Round 3 hotfix — entity collision crash + revert 沧月 angle | Yes |
| 461 | 6161 | `resolveMapCollisions` is player-only (reads `velocity`) | Yes |
| 462 | 6165 | 沧月 angle reverted to primary-relative | Yes |
| 463 | 6168 | Round: 5 new test abilities + 沧月 polish | Yes |
| 464 | 6173 | Ability Editor 加成修正批量重置为未修正 (2026-05-31) | Yes |
| 465 | 6187 | Round: lifesteal-at-full-HP, ability tweaks, 4 new abilities | Yes |
| 466 | 6200 | 盾立 Reflect — Universal Coverage (round 2) | Yes |
| 467 | 6214 | 盾立 Reflect — regression fixes after round 2 | Yes |
| 468 | 6216 | 捉影式 reflected only the debuff, not the pull movement | Yes |
| 469 | 6220 | Ground-zone tick loops still had one raw `hasDamageImmune()` bypass | Yes |
| 470 | 6224 | 百足 / 五方 need payload-only reflect, not cast-entry reflect | Yes |
| 471 | 6228 | 盾立 Reflect — six-point follow-up round | Yes |
| 472 | 6230 | 百足 / 五方 still skipped 盾立 before the shared helper | Yes |
| 473 | 6234 | 少明指 dispel payload had no reflect path of its own | Yes |
| 474 | 6238 | 振翅图南 / 飞刃回转 follow-zones must resolve 盾立 before choosing the follow target | Yes |
| 475 | 6242 | 极乐引 reflected only the CC buffs, not the pull movement | Yes |
| 476 | 6246 | 连环弩 used a fully custom tick path outside the shared damage helper | Yes |
| 477 | 6250 | Ability description regex migration (41 -> 32 first batch) (2026-05-30) | Yes |
| 478 | 6252 | What was changed | No (merge into parent section) |
| 479 | 6257 | Why 41 became 32 | No (merge into parent section) |
| 480 | 6261 | Lesson | No (merge into parent section) |
| 481 | 6264 | Ability description parenthesis normalization + remaining 9 conversion (2026-05-30) | Yes |
| 482 | 6266 | What was changed | No (merge into parent section) |
| 483 | 6270 | Validation | No (merge into parent section) |
| 484 | 6273 | Lesson | No (merge into parent section) |

Total points: 484
