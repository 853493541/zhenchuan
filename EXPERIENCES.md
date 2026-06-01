# Zhenchuan — Experiences Log

Record all problems solved, unresolved issues, and disproved approaches here.
Each entry goes under its relevant section header.


## 1. Ability Related Experiences
- Ability-related experiences are now maintained in `ABILITY_EXPERIENCES.md`.
- For ability changes, edits, and lessons, go to that file.
- Completed split on 2026-05-31: moved 159 ability-related top-level entries into `ABILITY_EXPERIENCES.md`.

## 2. EXPERIENCES structural cleanup execution: remove empty headings + merge template subheadings + full numbering (2026-05-31)

**Implemented / checked**:
- Removed empty/near-empty headings (shell headings with no meaningful body) based on the approved list.
- Merged template `###` subheadings (such as `Problem` / `What was changed`) into parent sections as inline bold labels.
- Renumbered the full `EXPERIENCES.md`: `##` uses `N.`, and `###` uses `N.M`.

**Verification**:
- This round only changed document structure with no code edits; per policy, no build or PM2 restart was run.

**Lesson**:
- For very long logs, doing structural noise reduction first (remove empty headings + merge template subheadings) before renumbering significantly improves readability and searchability.


## 3. Instruction rule update: Playwright accounts changed to 测试一/测试二 + long-log cleanup candidate extraction (2026-05-31)

**Implemented / checked**:
- Updated section 9.4 in `.github/copilot-instructions.md` to use test accounts `测试一` and `测试二`.
- Added rule: if those accounts are insufficient for a validation scenario, create additional test accounts as needed.
- Extracted cleanup candidates from `EXPERIENCES.md`, prioritizing empty/near-empty headings and template-style subheadings that can be merged into parent sections.

**Verification**:
- This round only changed documents with no code edits; per policy, no build or PM2 restart was run.

**Lesson**:
- For very long experience logs, extracting obvious delete/merge candidates by structure first and then applying manual approval is the lowest-risk workflow.


## 4. Instruction file refactor: numbered sections + mode/language/Playwright rule updates (2026-05-31)

**Implemented / checked**:
- Refactored `.github/copilot-instructions.md` into a numbered structure using sections/subsections from `1.x` to `9.x`.
- Updated mode rules: primary mode is `yumenguan`; `test` is the fast testing mode; `arena/pubg` remain legacy.
- Updated Playwright policy: run only for very large/high-impact changes or when explicitly requested; when required, default to the live target.
- Added language policy: primary project language is English; Chinese is allowed for in-game terms where needed; default responses should be primarily English.

**Verification**:
- This round only changed documents with no code edits; per policy, no build or PM2 restart was run.

**Lesson**:
- Long-term collaboration instruction files should use numbered sections and subsections to reduce ambiguity and support incremental maintenance.


## 5. EXPERIENCES cleanup inventory: full point numbering + keep recommendation list (2026-05-31)

**Implemented / checked**:
- Generated full cleanup review file `EXPERIENCES_CLEANUP_REVIEW.md` for `EXPERIENCES.md`.
- Output all `##` / `###` headings and explicit `Point N` entries with unified numbering, line references, and `Keep?` suggestions.
- Snapshot at that time: total points `484`, suggested keep `466`, suggested merge into parent `18`.

**Verification**:
- `cd backend && npm run build` passed.
- `cd frontend && npm run build` passed.
- `pm2 restart frontend backend` completed with both processes `online`.
- Frontend startup logs still showed historical `MaxListenersExceededWarning`; this round introduced no new startup-blocking errors.

**Lesson**:
- For very long experience logs, generating an automated point list plus merge recommendations before manual edits is safer, reduces accidental deletions, and supports staged cleanup.



## 6. 首页下拉样式二次修复：去阴影、抗底部裁切、固定最小宽度 + 登录标题文案 (2026-05-31)

**Implemented / checked**:
- `frontend/app/page.module.css`
  - 移除模式下拉面板阴影（`box-shadow: none`）。
  - 模式下拉按钮宽度改为固定最小宽度策略（`168px`），避免随选项文案频繁变化。
  - 下拉面板层级提高（`z-index: 3000`）并支持向上展开样式（`.modeMenuListUp`），缓解底部被截断。
  - “暂无可加入的房间”空态改为居中显示：跨列 + 最小高度 + flex 居中。
- `frontend/app/page.tsx`
  - `ModeDropdown` 增加可视区检测逻辑：打开时动态判断向下/向上展开（空间不足时自动上翻），减少底部裁切。
- `frontend/app/login/page.tsx`
  - 登录页 Logo 文案从“真传卡牌”改为“真传”。

**Verification**:
- `cd backend && npm run build` 通过。
- `cd frontend && npm run build` 通过。
- `pm2 restart frontend backend` 成功，前后端均 `online`。

**Lesson**:
- 下拉面板在列表页场景应具备“动态翻转方向 + 高层级”能力，否则在不同窗口高度下容易出现底部裁切回归。


## 7. 首页模式下拉回归修复：非管理员无法展开 + 管理员选项裁切 (2026-05-31)

**Implemented / checked**:
- 修复 `frontend/app/page.tsx` 回归：之前 `useEffect` 在非管理员场景下会在每次 `openModeMenu=true` 时立即强制关闭，导致“点不开下拉”。
- 现改为仅处理“非管理员且当前选中 legacy 模式”的回退逻辑，不再在打开菜单时自动收起。
- 调整 `frontend/app/page.module.css` 模式下拉尺寸策略为内容自适应：
  - `.modeMenuWrap` 改为 `width: max-content; max-width: 100%`；
  - `.modeMenuButton` 改为 `width: max-content; max-width: 100%; white-space: nowrap`；
  - `.modeMenuList` 改为 `width: max-content; min-width: 100%; max-width: min(90vw, 420px)`；
  - `.modeMenuItem` 增加 `white-space: nowrap`。
- 结果：非管理员可正常展开；管理员长选项不再半截裁切。

**Verification**:
- `cd backend && npm run build` 通过。
- `cd frontend && npm run build` 通过。
- `pm2 restart frontend backend` 成功，前后端均 `online`。

**Lesson**:
- 权限校验 effect 应只处理“非法选中值修正”，不要耦合菜单开闭状态，否则容易引入“可见但不可操作”的交互回归。


## 8. 测试模式默认缩短CD + 首页模式下拉合并与缩窄 (2026-05-31)

**Point 1 — 测试模式默认缩短CD开启 / Implemented**:
- 在 `backend/game/services/battle/battleService.ts` 的 `initializeBattleState` 中新增默认值：`testShortCooldown: isTestMode`。
- 结果：进入 `test` 模式开局即默认开启 3 秒冷却上限；其他模式默认不受此项影响。

**Point 2 — 首页 legacy 模式并入主模式下拉，且仅管理员可见 / Implemented**:
- 在 `frontend/app/page.tsx` 将主模式与 legacy 模式选择器合并为单一 `ModeDropdown`。
- legacy 选项仍仅在 `me?.isAdmin === true` 时出现在合并后的下拉中。
- 非管理员若本地缓存了 legacy 模式，会自动回退到默认主模式（玉门关基础）。

**Point 3 — 模式下拉宽度缩小 30% / Implemented**:
- 在 `frontend/app/page.module.css` 将 `.modeMenuWrap` 的 `min-width` 从 `210px` 调整为 `147px`（减少 30%）。

**Verification (each point followed protocol build/restart)**:
- 后端构建：`cd backend && npm run build` 通过（每个点后均执行）。
- 前端构建：`cd frontend && npm run build` 通过（每个点后均执行）。
- 进程重启：`pm2 restart frontend backend` 成功（每个点后均执行）。

**Observed (existing, not introduced by this change)**:
- frontend 仍有历史 `MaxListenersExceededWarning`。
- backend error log 仍以 lag probe / ws 断连为主，启动路径正常。

**Lesson**:
- 模式入口应保持“单入口 + 权限过滤”而非多入口分裂，可降低选择复杂度并避免非管理员误触 legacy 路径。


## 9. 测试模式新增“测试缩短CD(3秒)”按钮，对齐玉门关行为 (2026-05-31)

**Implemented / checked**:
- 在 `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx` 将“测试缩短cd”开关从“仅玉门关可见”调整为测试面板通用可见。
- 开关调用按模式分流：
  - 玉门关继续走 `/api/game/cheat/yumen/test-short-cooldown`。
  - 非玉门关测试模式走新接口 `/api/game/cheat/test-short-cooldown`。
- 前端冷却显示逻辑改为统一判定：`safeZone.testShortCooldown || state.testShortCooldown`，保证非玉门关下也按 3 秒上限显示与结算。
- 后端新增通用接口 `/cheat/test-short-cooldown`（`backend/game/routes/draft.routes.ts`），写入 `state.testShortCooldown` 并立即裁剪运行中冷却（含充能恢复队列）到 90 tick（3 秒）。
- `playService` 运行时冷却判定扩展为读取顶层 `state.testShortCooldown`（同时兼容玉门关的 `safeZone.testShortCooldown`）。
- 同步补充前后端 `GameState` 类型字段 `testShortCooldown?: boolean`。

**Verification**:
- `cd backend && npm run build` 通过。
- `cd frontend && npm run build` 通过。
- `pm2 restart frontend backend` 成功，两个进程 `online`。

**Observed (existing, not introduced by this change)**:
- `frontend` 进程日志存在历史 `MaxListenersExceededWarning`。
- `backend` 错误日志主要为历史 lag probe/deprecation 输出，本次启动阶段未见新的阻断性报错。

**Lesson**:
- “测试开关”若仅挂在 `safeZone` 上会把能力限制在特定模式；通用测试能力应有顶层状态位，并允许模式专属状态并存以保持兼容。

### 9.1 adControl 4列布局 + 状态置顶 + 数值近实时自动保存 (2026-05-31)

**Textbox readability polish / checked**:
- 用户反馈“输入框看不到数字”，定位到 `adSettingRow` 右侧控件列过窄（历史 `104px` 设计与新 `文本系数 > 输入框` 组合冲突）。
- 调整 `frontend/app/ability-editor/page.module.css`：
  - `adSettingRow` 右侧列改为 `minmax(220px, 42%)`；
  - `adSettingControl` 设置最小宽度，输入框最小宽度增大；
  - 输入框字号/对比度提升，确保数字可读；
  - 文本系数区域加可视化容器，避免和输入框挤压重叠。

**Lesson**:
- 新增快捷操作控件后必须同步回算“最小可读输入宽度”，否则会出现功能增强但主输入可用性退化。

**Follow-up UI efficiency update / checked**:
- 将 `adControl` 桌面布局改为固定 4 列同屏（`repeat(4, minmax(0, 1fr))`），避免第 4 列掉到第二行。
- 在每条可编辑加成行增加“文本系数一键覆盖”控件，顺序为：`文本系数值  >  [当前输入框]`。
- `>` 点击后会把输入框值直接覆盖成文本系数首个数字并立即保存，满足快速批量对齐需求。

**Lesson**:
- 审核/录入密集型页面应提供“来源值一键覆盖当前值”的短路径，显著减少键盘输入与焦点切换成本。

**Implemented / checked**:
- `frontend/app/ability-editor/AdControlTab.tsx` 改为 4 列：`无加成 / 需要补充 / 未修正 / 已修正`，并将 `无加成` 技能从 `已修正` 列中拆出到最左列。
- 对“状态切换为 `需要补充` 或 `已修正`”的技能增加置顶逻辑：切换成功后会在目标列顶端显示，减少来回滚动查找。
- 数值输入增强为“接近自动处理”：
  - 保留 `onBlur` 立即保存；
  - 新增短延迟自动保存（输入后约 450ms 自动提交）；
  - 避免依赖点击 `已修正` 才触发保存。

**Lesson**:
- 评审流 UI 里，“状态驱动的快速回看”很关键；状态更新后把目标条目置顶，能显著降低大列表操作成本。

### 9.2 no_damage_output_coeff_check.csv 批量入表（无加成 + 已修正）(2026-05-31)

**Follow-up fix / checked**:
- 发现 `AdControlTab` 的行匹配逻辑会把 `无加成` 行通过 fallback 绑定到任意可用 `damageSettings`，导致这类行出现可编辑输入框（看起来像在改某个真实数值）。
- 已在 `frontend/app/ability-editor/AdControlTab.tsx` 将 `outputType === "无加成"` 的行从“打分匹配”和“fallback 匹配”中都排除，强制保持 `setting = null`，仅显示灰态不可编辑。

**Lesson**:
- 审查用途的“展示行”如果业务语义是“无系数”，必须在匹配层做硬约束（不可被 fallback 绑定），不能只靠标签文本区分。

**Implemented / checked**:
- 使用 `reports/no_damage_output_coeff_check.csv` 作为来源，把其中 94 个技能批量加入 `adControl` 行数据源。
- 在 `frontend/app/ability-editor/adControlCoeffRows.ts` 为每个技能新增一行：
  - `outputType: "无加成"`
  - `textCoeff: ""`
  - `currentCoeff: ""`
- 在 `backend/game/abilities/ability-property-overrides.json` 将这 94 个技能对应的 `adControlStatus` 全部设为 `fixed`（已修正）。
- 复核脚本确认：`missingNoBonusRows=0`、`notFixedStatus=0`。

**Lesson**:
- 对“无伤害/无系数”技能，前端应显式建模为 `无加成` 行并配合 `fixed` 状态，否则这类技能会在审查列表中缺席，导致审查覆盖面不完整。

### 9.3 继续收敛剩余未匹配行（18 → 0）(2026-05-31)

**Implemented / checked**:
- 继续按“定义字段 + 提取字段 + 运行时读取同字段”的方法，把剩余未匹配行全部补齐，涉及能力：`银月斩 / 玉石俱焚 / 跃潮斩波 / 鹤归孤山 / 剑主天地 / 绛唇珠袖 / 连环弩 / 龙战于野 / 绿野蔓生 / 灭 / 人剑合一 / 万剑归宗 / 五方行尽 / 引窍 / 狂龙乱舞`。
- 在 `abilityPropertySystem.ts` 扩展伤害提取：
  - 新增类型标签与提取类型：`WUFANG_XINGJIN_AOE`、`YIN_YUE_ZHAN`、`PLACE_GROUND_ZONE`。
  - 增加非标准路径字段提取：`landingDamage / landDamage / closeBonusDamage / strikeDamage / explodeDamage / extraDamageValue / settleMultiplier / retaliateDamage / tickDamage1~3 / extraPerStackDamage`。
- 在 `immediateEffects.ts`、`GameLoop.ts`、`playService.ts` 将原硬编码伤害改为读取上述字段（包括 dash 落地、dot 结算、叠层附加伤害、反击伤害、触发伤害等）。
- `绛唇珠袖` 过程中验证到“自定义 effect type 在归一化/编辑器提取链路中可能丢失”的问题，最终改为使用标准 `DAMAGE` effect 作为系数载体，保证 `damageSettings` 稳定生成。
- 用与前端 `AdControlTab` 同逻辑的脚本复核，最终 `unmatchedCount = 0`。

**Lesson**:
- 对编辑器可调系数，优先复用标准 effect type 作为载体；临时自定义 type 若未同时接入完整类型链路，容易在快照/提取阶段被忽略，导致“代码有值但 UI 无匹配”。

**Implemented / checked**:
- 用户要求不是只重置状态，而是按 `reports/damage_output_coeff_check.md` 逐行重建 `adControl` 列表。
- 新增 `frontend/app/ability-editor/adControlCoeffRows.ts`，由系数表解析出的行数据驱动 UI（当前 90 行）。
- `frontend/app/ability-editor/AdControlTab.tsx` 改为 row-entry 模式：按系数表每一行绑定技能与对应第 N 个加成项，不再仅按技能去重。
- 进一步修正匹配策略：不再用“第 N 项”硬匹配，改为结合 `输出方式`（持续/额外/引爆）与系数字面值（`当前系数` + `文本系数` 数字候选）对 `damageSettings` 做打分分配，显著减少“未找到与系数表行匹配的加成项”。
- 额外修复 `棒打狗头` 无法匹配根因：其伤害来自自定义效果 `BANG_DA_GOU_TOU`，此前不在 `abilityPropertySystem.ts` 的伤害提取集合里，导致 `damageSettings` 为空。已把该效果加入 `DAMAGE_VALUE_EFFECT_TYPES` 与标签映射，UI 可正常显示并编辑该伤害系数。
- 继续修复 3 个“只有 1 个系数却无法匹配”的技能：`沧月 / 帝骖龙翔 / 撼地`。根因是这三者的伤害不在标准 `effect.value` 路径（两者为运行时硬编码，另一个只有群体加 buff），导致 `damageSettings` 为空。已把伤害参数改为可配置字段并接入提取：
  - `沧月`: `CANG_YUE_AOE.damageValue`
  - `帝骖龙翔`: `AOE_APPLY_BUFFS.damageValue`
  - `撼地`: `GROUND_TARGET_DASH.aoeDamage`
  同步把运行时结算改为读取这些字段，确保编辑器改值后对战结算也生效。
- adControl 展示结构调整：同一技能的多条系数行合并在同一技能卡片内展示，不再按“每行一张卡”拆散；技能图标在该页缩小；若 `md` 有行但代码侧未匹配到 setting，仍展示该行 `输出方式`，并将输入框灰态禁用（占位“未匹配”）。
- 按“手动逐条对齐”先修前 5 条未匹配：`横扫六合(造成伤害) / 九转归一(造成伤害) / 烈日斩(额外造成伤害) / 破风(造成伤害) / 潜龙勿用(造成伤害)`：
  - `横扫六合`: 将 `HENG_SAO_LIU_HE_AOE` 纳入伤害提取类型，直伤行可独立匹配。
  - `九转归一`: 为 `KNOCKBACK_DASH` 增加 `wallHitDamage` 并在撞墙结束时结算该伤害，新增可编辑项。
  - `烈日斩`: 增加 `extraDamageValue`，把“银月斩存在时的额外伤害”从倍率翻倍改为可独立系数字段。
  - `破风`: `PO_FENG_STRIKE` 增加 `strikeDamage`，不再只有流血 DoT 可编辑。
  - `潜龙勿用`: `QIAN_LONG_WU_YONG` 增加 `damageValue`，将伤害与范围参数拆开。
  校验脚本确认以上 5 条现在均可匹配到对应 setting。
- 每条加成标签改为显示系数表“输出方式”（如 `造成持续伤害`），替换原内部技术标签（如 `读条完成 · 延时范围伤害倍率`）。
- 删除中间版本 `frontend/app/ability-editor/adControlCoeffWhitelist.ts`，避免与逐行数据源冲突。

**Lesson**:
- 当业务数据源是“逐行对照表”时，前端必须按行建模；若按技能去重，会丢失同名技能的多输出方式审查维度。


## 10. 离线包下载入口迁移与管理员限制 (2026-05-31)

**Implemented / checked**:
- 将 `下载离线包` 从资源管理器页面工具栏移除（`frontend/app/resource-pack/page.tsx`）。
- 在顶部账户图标菜单（`frontend/app/components/auth/UserMenu.tsx`）新增 `下载离线包` 条目，并放在管理员工具区，仅 `isAdmin === true` 可见。
- 对下载接口 `frontend/app/resource-pack/package/route.ts` 增加服务端管理员鉴权：转发 cookie 到后端 `/api/auth/me`，非管理员返回 `403`，避免非管理员通过直链下载。

**Lesson**:
- 管理员能力限制不能只做前端隐藏；高价值下载入口应同时做接口层鉴权，避免直链绕过 UI。


## 11. 主页与资源管理器细化：未通过隐藏房间 + 常驻进度条 + 通过提示 (2026-05-31)

**Implemented / checked**:
- 首页 `frontend/app/page.tsx` 调整为“校验未通过时不显示房间列表”，通过后才渲染房间卡片区域。
- 资源管理器 `frontend/app/resource-pack/page.tsx` 去除下载区域重复百分比，仅保留一处百分比展示。
- 资源管理器进度条改为常驻显示（只要有资源清单就显示），下载完成或暂停后不再隐藏。
- 首页新增通过提示：资源 gate 从未通过切换为通过时，弹出系统 toast `资源已验证完整`。

**Lesson**:
- 资源流程提示应避免重复数值和状态跳变，常驻进度条与通过瞬时提示组合更利于用户判断当前可加入状态。




## 12. 通过态资源管理器行为回调：禁用自动校验与自动关闭 (2026-05-31)

**Implemented / checked**:
- 首页 `frontend/app/page.tsx` 移除 `resource-pack-verify-pass` 自动关闭逻辑，资源管理器不再因“校验通过”被自动关闭。
- 资源管理器页 `frontend/app/resource-pack/page.tsx` 调整 query-action 自动触发策略：当 `action=check` 且本地通过标记已是 true 时，不再自动执行校验。
- 首页去掉通过流程中残留的 `资源包校验中…` 提示行，避免进入实际游戏流程仍出现“校验xxx”提示。

**Lesson**:
- 通过态下资源管理器应是“手动工具窗口”而非自动流程步骤；避免自动触发与自动关闭可减少误判和打断测试。

**Implemented / checked**:
- 首页 `frontend/app/page.tsx` 新增对 `resource-pack-verify-pass` 消息处理：资源管理器内执行校验并通过后，主页会自动关闭资源管理器浮层并立即置为通过态。
- 资源管理器页 `frontend/app/resource-pack/page.tsx` 恢复主面板进度条显示：在 `downloading/importing` 状态显示百分比与进度条。
- 资源管理器页移除 `浏览器缓存` 统计卡片与 `缓存服务已启用/不可用` 文案，保留关键下载/校验信息。
- 首页移除未通过时提示文案 `资源包未完整：请先 下载 / 上传 / 校验`，仅在检查进行中显示 `资源包校验中…`。

**Lesson**:
- 资源管理器作为操作面板应优先呈现“当前动作进度”，而非暴露实现细节（缓存服务、配额）文案；通过态联动应以显式事件收口，避免用户额外手动关闭。

**Implemented / checked**:
- 在首页通过态操作行新增 `资源管理器` 按钮（`frontend/app/page.tsx`），点击后直接打开嵌入式 `校验资源包` 窗口，便于在通过态直接做清除/校验测试。
- 调整首页 gate 文案渲染：通过态不再显示 `资源包校验：100%（可加入房间 / 可自动加入）`，仅在“校验中”或“未完整”时显示提示。
- Live 页面确认：通过态可见 `资源管理器`，点击后出现 `校验资源包` 对话框；通过态顶部不再出现原 100% 提示文案。

**Lesson**:
- 通过态首页应突出可操作入口（资源管理）而不是重复状态描述，减少视觉噪音并方便回归测试。


## 13. 资源包反复缺文件最终修复：移除 _next/static + 显式动作同步 (2026-05-31)

**Implemented / checked**:
- 根因确认：资源包清单包含了构建产物目录 `_next/static`，会引入部署期 hash 文件与陈旧 chunk，导致下载阶段出现 404，进而“手动校验也不通过”。
- 在 `frontend/app/resource-pack/resourcePackFiles.ts` 中彻底移除 `_next/static` 目录采集，只保留 public 下稳定资源（icons/fonts/js/lib/tools/game/maps）。
- 在主页与嵌入资源包页之间补上显式状态同步：
  - 资源包页 `done/ready/failed` 向父页 `postMessage`。
  - 主页监听该消息即时更新 gate（无需依赖切 tab/重进才刷新）。
  - 关闭资源包面板时额外做一次显式 gate 刷新。
- Live Playwright 复核：
  - 资源包页总量稳定为 `1624`，下载到 `1624/1624` 后可通过。
  - 主页“下载到100%后”可自动切换为通过态。
  - 主页“上传离线包后”可自动触发校验并切换为通过态。

**Lesson**:
- 离线资源包不能依赖 Next 构建输出目录作为稳定内容来源；这会把部署时序问题直接暴露给终端用户。


## 14. 资源包通过后主页不解锁：显式动作同步修复 (2026-05-31)

**Implemented / checked**:
- 修复“下载到100%后主页仍不通过 / 手动校验也不解锁”的状态同步断点：
  - 在嵌入资源包页（`frontend/app/resource-pack/page.tsx`）对 `done/ready/failed` 状态发送 `postMessage`（`type: resource-pack-gate`，含 `ready` 布尔值）。
  - 在主页（`frontend/app/page.tsx`）监听该消息并即时更新 gate 状态，不再依赖 focus/re-enter 才反映结果。
  - 关闭资源包面板时再执行一次显式 gate 刷新，确保下载/校验后的最终状态落地。
- 保持“仅进入页面自动检查一次”的策略不变；新增同步仅发生在用户显式下载/校验操作路径。

**Lesson**:
- 当主页与嵌入页共享同一状态门禁时，必须有显式跨 frame 状态同步；否则会出现“子页已100%，父页仍锁定”的假失败。


## 15. 资源包两段式主页 + 缺失反复问题修复 (2026-05-31)

**Implemented / checked**:
- 主页改为两段式显示（`frontend/app/page.tsx`）：
  - 未通过资源包 gate 时，只显示 `下载资源包 / 上传离线包 / 校验`，隐藏 `模式选择 / 开始 / 创建 / 自动加入`。
  - 通过 gate 后，隐藏资源包三按钮，显示 `模式选择 / 开始 / 创建 / 自动加入`。
- 按要求移除“切出切回就重检”行为：删除 `focus` 触发重检与关闭面板后自动重检，改为“进入页面时检查一次”，其余仅由显式操作（如上传离线包后的自动校验）更新状态。
- 修复“总是差几个文件、反复掉到 1672/1677”根因（`frontend/app/resource-pack/resourcePackFiles.ts`）：
  - 从资源包清单中排除 Next 构建易变运行时文件（如 `webpack-*.js`、`_buildManifest.js`、`_ssgManifest.js` 及若干 manifest）。
  - 避免每次前端重新构建后，旧包被新 hash 文件拉低完整度而反复缺失。

**Lesson**:
- 资源包清单必须避免把部署期易变的前端运行时文件作为硬性资源，否则会在每次发布后造成“用户包看似又缺几个”的体验。


## 16. 加载离线包移到主页 + 导入完成自动校验 (2026-05-31)

**Implemented / checked**:
- 将 `加载离线包` 从资源包面板中移出，新增到主页操作行（`frontend/app/page.tsx`）作为独立按钮。
- 主页新增离线包导入实现：选择 `.tgz/.tar.gz` 后直接写入 `CacheStorage`，不再要求用户进入资源包面板执行导入。
- 离线包导入完成后自动调用主页 gate 校验（`checkResourcePackGate.current()`），无需用户再手点一次 `校验`。
- 资源包面板（`frontend/app/resource-pack/page.tsx`）移除 `导入离线包` 按钮与对应导入逻辑，仅保留下载离线包/下载资源包/校验/清除。

**Lesson**:
- 当用户流程要求“主页一步完成导入并可加入”，应把离线包入口前移到首页并把校验串到导入成功回调里，避免跨面板二次操作。


## 17. 资源包自动补齐（免点击）+ 去除缓存完整度条 (2026-05-31)

**Implemented / checked**:
- 首页 `frontend/app/page.tsx` 增加资源包自动补齐：
  - gate 检测到未满 100% 时，后台自动下载缺失文件到 CacheStorage（并发 4），无需用户手动点 `继续下载/校验`。
  - 补齐完成后自动复检 gate，房间自动解锁。
  - 增加提示文案：`资源包自动补齐中…完成后将自动解锁房间`。
- 资源包页 `frontend/app/resource-pack/page.tsx` 去除“缓存完整度”进度条显示（主视图 + 弹窗中的缓存完整度条），避免用户被条形图误导。
- 资源包页首次进入自动触发缺失文件下载（若未满），不要求用户手动点击下载按钮。

**Lesson**:
- 对外发给用户的资源包流程应以“自动收敛到可加入”优先，减少手动操作入口和状态分叉。


## 18. 资源包策略回调：取消隐式补齐，仅保留显式下载到100% (2026-05-31)

**Implemented / checked**:
- 按最新需求回调方案：不再在首页后台自动补齐缺失资源，避免出现“未操作也在偷偷下载 extras”的行为。
- 移除 `frontend/app/page.tsx` 中自动补齐逻辑与对应提示文案，恢复为显式校验/下载驱动的 gate。
- 移除 `frontend/app/resource-pack/page.tsx` 的页面加载后自动触发下载，恢复为用户显式点击下载。
- 保留“去掉缓存完整度条”改动，避免误读百分比条。

**Lesson**:
- 资源包策略需要严格区分“显式下载包内容”和“隐式后台补齐”；当用户要求只信任下载包本身时，应避免任何后台兜底下载。


## 19. 资源包“显示100%但大厅仍锁”定位与修复 (2026-05-31)

**Implemented / checked**:
- 定位到资源包页缓存完整度百分比使用 `Math.round`，在 `1674/1677` 这类接近值时会显示 `100%`，但实际上并未全量缓存。
- 大厅 gate 用的是严格判定（必须 `readyCount === assets.length`），因此会继续锁房，形成“资源页看起来100%但不能加入”的表象冲突。
- 在 `frontend/app/resource-pack/page.tsx` 增加 `toPercent()`：仅当 `value >= total` 才显示 `100`，否则使用向下保留 1 位小数，避免误报 100%。
- Live Playwright 复核：不完整缓存显示 `99.8% (1674/1677)` 且大厅保持锁定；补齐到 `1677/1677` 后主页状态切换为 `资源包校验：100%（可加入房间 / 可自动加入）`，房间状态变为 `🟢 等待加入`。

**Lesson**:
- gate 与展示口径必须一致；任何会把“未完成”四舍五入成“100%”的 UI 都会制造假通过反馈。


## 20. 资源包按钮行为更新：先校验再继续下载 + 下载中仅主按钮切换 (2026-05-31)

**Implemented / checked**:
- 在 `frontend/app/resource-pack/page.tsx` 调整首按钮文案逻辑：
  - 部分缓存（`cachedCount > 0 && < assets.length`）显示 `继续下载`。
  - 下载进行中显示 `暂停下载`，再次点击会暂停当前下载。
  - 全量完成后显示 `重新下载资源包`。
- 修复“进入页面后再次全量重下”问题：移除下载前强制 `caches.delete(CACHE_NAME)`，改为先扫描缓存，仅下载缺失文件（missing-only resume）。
- 校验/下载的 cache 命中统一为双路径匹配（绝对 URL + 相对 URL），减少误判导致的重复下载。
- 下载中的顶部栏不再整体灰掉：`busy` 仅包含 `checking/importing`，下载时其它按钮保持可用；主绿色按钮独立切换为 `暂停下载`。

**Live check (Playwright, production URL)**:
- 在嵌入资源包窗口看到部分缓存状态时，主按钮显示 `继续下载`。
- 点击后主按钮切换为 `暂停下载`，其余按钮（下载离线包/导入离线包/校验/清除）保持可点击（未 disabled）。

**Lesson**:
- 对大资源包流程应优先做“增量恢复下载”，并把“暂停/继续”集中在主按钮，避免把辅助操作一并禁用造成交互阻塞。


## 21. Live Playwright验收：资源包100%后首页解锁/自动加入 (2026-05-31)

**Implemented / checked**:
- 按项目要求在 `https://zhenchuan.renstoolbox.com/` 做了真实 Playwright 流程验证（非 localhost）。
- 复现起始状态：主页提示 `资源包校验未达100%，房间已锁定。请先完成“校验”。`，房间为灰锁状态。
- 在主页嵌入的资源包窗口执行 `下载资源包`，进度从 `0/1677` 到 `1677/1677`，状态 `已完成`，完整度 `100%`。
- 关闭资源包窗口后，首页出现短暂 `资源包校验中…`，随后自动触发加入房间并跳转到 `/game/room?...`（说明 gate 已通过，auto-join 生效）。
- 再次回到首页后，仍会在校验完成后自动进入房间，行为与“通过后可加入”预期一致。

**Lesson**:
- 线上验证应以“是否能从锁定态切换到可加入态（或自动加入）”为判定标准，而不只看资源包页单点 100% 文案。


## 22. Homepage 校验假阴性（资源页100%但大厅仍锁）修复 (2026-05-31)

**Implemented / checked**:
- 复盘首页 gate 与资源包页校验结果不一致：资源包页已显示 100%，首页仍长期灰房锁定。
- 在 `frontend/app/page.tsx` 中对 gate 逻辑做对齐修复：
  - 优先读取资源包页写入的本地通过标记 `zhenchuan.resourcePack.ready.v1`（同源同键），避免 UI 结果分叉。
  - 严格校验时对 CacheStorage 查询改为“双路径匹配”：先绝对 URL，再原始相对 URL，降低键形态差异导致的误判。
  - 严格校验完成后同步回写/清理同一 ready 键，确保两页状态收敛。

**Lesson**:
- 前端多入口 gate 场景必须共享同一通过信号并保持回写一致；仅做各自独立重算很容易出现“一个页面通过、另一个页面不通过”的假阴性体验。


## 23. Homepage auto-join toggle + 100% 校验 join gate (2026-05-31)

**Implemented / checked**:
- In `frontend/app/page.tsx`, replaced implicit auto-join behavior with a user-facing toggle button (`自动加入：开启/关闭`) and persisted it to localStorage.
- Added a frontend resource-pack gate check on homepage:
  - Fetches `/resource-pack/manifest`.
  - Verifies every manifest asset exists in Cache Storage under the pack cache name.
  - Only when cached coverage is 100% is room joining enabled and auto-join allowed.
- Added UI lock behavior for unverified users:
  - Waiting rooms become gray and non-clickable.
  - Status text shows `需先完成校验（100%）`.
  - Auto-join is blocked while gate is not ready.
- Added focus/overlay-close re-check so users who finish 校验 in the resource-pack iframe get gate status refreshed on homepage.

**Lesson**:
- Auto-join should be opt-in and should share the same eligibility gate as manual join. Otherwise users can bypass client readiness constraints through background polling side effects.


## 24. Resource pack freshness + coverage expansion (2026-05-31)

**Implemented / checked**:
- Audited the resource-pack pipeline (`/resource-pack/manifest`, `/resource-pack/package`, downloader/importer, service worker path filter).
- Fixed freshness bug in `frontend/app/resource-pack/page.tsx`: `下载资源包` no longer skips already-cached files. It now recreates cache content and re-fetches all manifest assets with `cache: "reload"`, so clicking download gets the newest version.
- Expanded collector coverage in `frontend/app/resource-pack/resourcePackFiles.ts`:
  - Added extensions: `.wem`, `.js`, `.html`, `.txt`.
  - Added tool/static paths: `/js/**`, `/lib/**`, and root files `export-reader.html`, `full-validator.html`, `mesh-inspector.html`, `resource-pack-sw.js`.
  - Added MIME mappings for the new file types.
- Updated `frontend/public/resource-pack-sw.js` to serve cached `/js/**` and `/lib/**` requests.
- Live verification against running app manifest (`http://127.0.0.1:3000/resource-pack/manifest`) confirmed inclusion of previously missing assets:
  - `hasWem: true`
  - `hasJsTool: true`
  - `hasLibTool: true`
  - `hasExportReader/full-validator/mesh-inspector: true`

**Lesson**:
- Offline-pack freshness cannot rely on “if cached then skip” logic; when URLs stay stable, explicit re-fetch is required to avoid stale assets. Coverage should be driven by actual runtime tool/static paths, not only core game folders.


## 25. Homepage legacy dropdown admin-only + create label update (2026-05-31)

**Implemented / checked**:
- In `frontend/app/page.tsx`, restricted `legacy modes` dropdown visibility to admins only (`me?.isAdmin === true`).
- Added a non-admin safety fallback: if a legacy mode was previously saved in localStorage, homepage auto-resets selection to default mode and closes legacy dropdown state.
- Updated the middle large start button text from `开始 XXX` to `创建 XXX` while keeping loading text unchanged (`创建中…`).

**Lesson**:
- Role-gating homepage controls should also sanitize persisted selections; hiding the UI alone is insufficient when prior localStorage state can still point to restricted options.


## 26. Yumenguan testing UI admin gating + add-skill default off (2026-05-31)

**Implemented / checked**:
- Wired authenticated `isAdmin` from server-side in-game pages into `InGameClient`, then into `BattleArena` as a prop.
- Added a Yumenguan gate in `BattleArena`: only admins can access test-only surfaces there (ESC `测试` tab, on-screen `控制面板`, and test-only `打开测试添加技能面板` toggle).
- Set `showCheatAbilityPanelEntry` default to off when entering Yumenguan mode, so `添加技能` does not appear by default even for admins.
- Added a defensive cleanup effect for non-admin Yumenguan sessions to auto-close/hide any testing panels that might remain from prior state.

**Lesson**:
- Mode-specific production-like UX should enforce role-based visibility at render time and also actively clean stale UI state; gating render alone is not enough when panels can persist across mode transitions.


## 27. 百足/五方行尽区域圈显示时长下调为0.5秒 (2026-05-30)

**Implemented / checked**:
- 将百足首次命中时的地面圈 marker 时长由 `1000ms` 下调为 `500ms`（`immediateEffects.ts` 中 `BAIZU_AOE`）。
- 将百足18秒结束二次爆炸时的地面圈 marker 时长由 `1000ms` 下调为 `500ms`（`GameLoop.ts` 中 `baizu_marker` 生成点）。
- 将五方行尽命中时区域 marker 时长由 `1000ms` 下调为 `500ms`（`immediateEffects.ts` 中 `WUFANG_XINGJIN_AOE`）。

**Lesson**:
- 这两类“紫色圈圈”属于 `groundZones` 可视标记，显示时长由 `expiresAt` 决定；若只改技能描述或 buff 时长不会影响该可视圈持续时间。


## 28. Camera ground-clamp sky-look split (2026-05-30)

**Implemented / checked**:
- Extended collision-test camera pitch to near straight-up and split ground-clamp handling by movement intent.
- Stationary upward dragging now keeps a safe boom distance and aims into the sky instead of collapsing the camera into the avatar.
- Forward walking keeps the staged old behavior: the camera can close in at the ground clamp first, then aim upward once close enough.
- Added live Playwright probe coverage for 10 stationary expected-behavior passes across house / 城墙 / mountain labels, plus forward-walking checks for all three categories.

**Lesson**:
- Camera tests must drag far enough to reach the actual pitch clamp; partial upward drags can produce misleading halfway samples. For live WebGL checks, use a camera-specific probe and poll for a fresh frame after synthetic input instead of relying on a single immediate read.


## 29. Camera smooth sky-look blend and W preserve (2026-05-30)

**Implemented / checked**:
- Replaced the fixed ground-clamp sky target with a pitch-derived look direction so dragging farther upward maps continuously to a higher viewing angle.
- Blended from the normal avatar look target into the pitch-derived sky target with a continuous look-up ratio, removing the mode-switch feel when entering or leaving sky view.
- Preserved the sky-facing pitch when pressing or releasing forward movement from sky view; forward movement changes camera position but does not force the angle back toward the avatar.
- Added probe fields and deterministic live Playwright sampling for smooth up/down transitions and W-preserve behavior across repeated house / 城墙 / mountain-labeled cases.

**Lesson**:
- Camera feel should avoid binary target swaps around collision clamps. Live WebGL proof is more reliable when synthetic mouse movement is backed by deterministic pitch stepping, explicit endpoint samples, and aggregate smoothness checks because headless rendering can drop individual frames.







## 30. Yumen auto-settle shared-state sync fix (2026-05-29)

**Implemented / checked**:
- Diagnosed intermittent "自动结算不生效" as client preference contention: each player had a local auto-settle preference that could keep forcing different values to the server.
- Removed per-client auto-settle localStorage preference/sync loop in BattleArena.
- Bound the 自动结算 checkbox directly to shared server state (`safeZone.autoSettle`), so all players now see the same checked status and a single authoritative value.

**Lesson**:
- Match-wide rule toggles must be represented as shared server state only. Per-client remembered preferences create hidden state fights and intermittent behavior.

**Implemented / checked**:
- Investigated repeated GCD bar flash/restart behavior after spectator cooldown changes.
- Switched frontend GCD fallback source from raw `me.globalGcdTicks` to runtime-decayed ticks via `getRuntimeCountdownTicks(...)` so stale server values do not keep re-triggering the bar.
- Added a one-tick guard to suppress micro-fallback blips (`<= 1` tick), which removes brief flash artifacts near countdown boundaries.

**Lesson**:
- Cooldown bar fallback should use time-decayed runtime values, not raw synced snapshots; snapshot jitter near zero creates visual flicker and fake re-triggers.

**Implemented / checked**:
- Investigated ghost-form reports where frontend showed ongoing GCD and blocked 轻功 casts even though backend spectator rules allow continuous mobility.
- In BattleArena frontend logic, bypassed cooldown/GCD gating for spectator 轻功 checks so local readiness matches backend validation.
- Hidden the player GCD visual bar while `观战中` is active to avoid misleading "still cooling down" UI.

**Lesson**:
- Spectator-mode exceptions must be mirrored in frontend readiness checks and visual cooldown widgets; backend-only fixes still feel broken when UI/state prediction disagrees.

**Implemented / checked**:
- Found server chat fallback for unattributed defeats (such as 狂沙) was hardcoded to `【游客】黯然离去。`.
- Updated system defeat broadcast fallback to use the actual defeated player display name when attacker attribution is missing.

**Lesson**:
- For kill/death announcements, fallback text must still resolve identity from the defeated user record; placeholder labels like "游客" create false attribution and confuse players.

**Implemented / checked**:
- Added spectator-mode cooldown bypass in ability validation so `观战中` players are not blocked by GCD or per-skill cooldown checks when casting movement skills.
- Added runtime cooldown normalization in `GameLoop` so while `观战中` is active, ability cooldown, GCD, and charge lock/regen are continuously forced to ready state.
- Kept existing spectator lock on non-轻功 abilities unchanged; this update only removes cooldown friction for allowed ghost-form mobility.

**Lesson**:
- For spectator/ghost traversal, cooldown-state consistency must be enforced both at validation time and tick-time state maintenance; patching only one path leaves intermittent lockouts.

**Implemented / checked**:
- Investigated reports of players spawning slightly inside mountain geometry and getting stuck due to low initial Z.
- Increased Yumen battle-start/random-spawn lift height from `+5` to `+10` units to create a clearer drop-in at match start.
- Hardened lifted spawn baseline Z to `max(spawn.z override, support-ground Z, top-down-hit Z)` so bad per-point Z data cannot place players below valid terrain support.

**Lesson**:
- Spawn-point Z should be treated as a hint, not authority, in complex 3D terrain. Using the maximum valid terrain-derived floor plus a short initial lift avoids embed-on-spawn while preserving the intended "drop-in" feel.

**Implemented / checked**:
- Investigated reports of broken poison-zone behavior in multi-player Yumen games and traced a plausible cause to duplicate start requests from multiple clients joining at different times.
- The frontend auto-full-shrink effect can run on each client with the preference enabled while the zone is still `idle`.
- Added backend guards to reject `start-shrink` and `start-full-shrink` when the safe zone is already in `waiting`, `countdown`, or `shrinking`.
- Suppressed the expected `alreadyStarted` conflict in the frontend auto-full-shrink path so late joiners do not produce false error toasts.

**Lesson**:
- Join-time client automation must be backed by idempotent server routes. A per-client preference is not a safe uniqueness guarantee for match-wide state transitions like poison-zone start.


## 31. Yumen settlement exit footer layout update (2026-05-29)

**Implemented / checked**:
- Moved the settlement auto-leave text and `离开战场` button from a right-aligned row into a centered vertical stack.
- Updated the countdown number in `将在 X 秒后离开战场` to display in yellow.

**Lesson**:
- For end-of-match dialogs, the primary exit countdown and action read more clearly when centered as a stacked call-to-action instead of competing with table content at the edge.


## 32. Consumable gray-out softening (2026-05-29)

**Implemented / checked**:
- Reduced the consumable bar gray-out severity for empty, unavailable, and depleted states by about 30%.
- Softened the mute effect by raising icon opacity and easing grayscale/saturation/brightness suppression instead of changing cooldown overlays.

**Lesson**:
- Inventory-state mute effects should communicate missing items without making the bar feel visually disabled; reducing desaturation and opacity together keeps the state readable but calmer.


## 33. Chat slash command handling (2026-05-29)

**Implemented / checked**:
- Updated the chat submit path so messages starting with `/` are treated as commands instead of being sent to chat.
- Added `/upz` as a command that triggers the same current-player Z rescue action as the control-panel button.
- Unknown slash commands are blocked from chat and reported as commands rather than normal messages.

**Lesson**:
- Slash-prefixed chat input should short-circuit before network send, so command-like text cannot leak into public chat.


## 34. React error-boundary startup crash fix (2026-05-29)

**Implemented / checked**:
- Investigated a startup crash reported as `ReferenceError: Cannot access 'vh' before initialization` on the in-game client.
- Root cause was a render-time TDZ dependency in the chat command callbacks: `runChatCommand` and `submitChatMessage` were defined before `runCheatAction`, so the component tried to read the later `const` during initial render.
- Moved the chat command callbacks below `runCheatAction` so all dependencies are initialized before they are referenced.

**Lesson**:
- In React components, a callback can still crash at render time if its dependency array reads a later `const`; moving the callback below the dependency or switching to a ref avoids TDZ failures.


## 35. Tab auto-target range/facing refinement (2026-05-29)

**Implemented / checked**:
- Updated `Tab/F1` auto-target selection to keep existing rules but additionally require targets to be within 60 units.
- Kept facing-direction filtering and current-target exclusion behavior unchanged.
- Removed the no-candidate warning output; when no target matches, selection now stays unchanged without showing an error message.

**Lesson**:
- Auto-target hotkeys should be deterministic and quiet: strict eligibility filters (facing + range) improve target quality, and no-match paths should fail silently to avoid UI noise.


## 36. 七星拱瑞 / 疾如风 / 魂压怒涛数值校准 (2026-05-30)

**Implemented / checked**:
- 将七星拱瑞（buffId 2600）持续时间从 15 秒下调至 10 秒，并同步技能描述文案。
- 将疾如风（buffId 1033）持续时间从 5 秒上调至 6 秒，并同步技能描述文案。
- 将魂压怒涛的击退判定半径从 10 尺下调至 6 尺：
  - 描述文案 `击退10尺内敌方目标10尺` -> `击退6尺内敌方目标10尺`
  - 运行时效果字段 `HUN_YA_NU_TAO.range` 从 `10` 改为 `6`

**Lesson**:
- 涉及技能范围/时长修改时，应同时改动描述和 effect 数值字段，避免前后端表现与说明不一致。


## 37. 七星拱瑞加速缩时修正 (2026-05-30)

**Implemented / checked**:
- 复盘确认七星拱瑞（buffId 2600）属于 `CHANNEL + periodic buff` 路径，`addBuff()` 会经过 `getHasteAdjustedBuffTiming()`，在 `hasteUnaffected=false` 时会按加速缩短持续时间。
- 在 `ability-property-overrides.json` 中将 `qixing_gongrui.properties.hasteUnaffected` 从 `false` 改为 `true`，使其持续时间固定按配置值执行。
- 保持技能定义中的七星拱瑞持续时间为 `durationMs: 10_000` 不变，修复后不再被加速缩到约 8 秒。

**Lesson**:
- 对带 periodic 的 CHANNEL 技能，如果设计要求“固定时长”，必须显式开启 `hasteUnaffected`，否则运行时会自动按加速缩时。


## 38. Yumen remaining-count label style tweak (2026-05-29)

**Implemented / checked**:
- Updated the right-side `剩余人数` label style to remove the white border/outline effect by clearing `-webkit-text-stroke` and removing the white glow shadow layer.
- Increased the `剩余人数` label font size by 20% (from height ratio `0.228` to `0.274`).
- Follow-up tweak: restored a very small white border (`-webkit-text-stroke: 0.08px rgba(255,255,255,0.52)`) per visual preference.
- Follow-up tweak: reduced the `剩余人数` number stroke from `0.6px` to `0.3px` (half strength).

**Lesson**:
- For large HUD typography, white stroke plus white glow can feel too harsh; a clean solid color with only subtle dark shadow gives better readability and less visual strain.


## 39. Yumen spawn-facing alignment legacy-mode compatibility (2026-05-29)

**Implemented / checked**:
- Updated frontend `isYumen1v1BasicMode()` detection to accept both `yumenguan-classic` and legacy `yumen-1v1-basic`.
- This restores Yumen-only startup camera alignment behavior for older live sessions that still carry the legacy mode code.

**Lesson**:
- After renaming mode codes, frontend mode predicates must keep legacy compatibility wherever mode-gated runtime behavior (like spawn camera alignment) is expected on already-running sessions.


## 40. Mode code rename: yumenguan-classic and test (2026-05-29)

**Implemented / checked**:
- Renamed canonical backend/frontend mode codes to `yumenguan-classic` and `test`.
- Updated frontend labels to `玉门关：经典` and `测试`.
- Updated mode selectors, diagnostics mode labels, room-size checks, in-game test-mode conditionals, and live test create payloads to the new codes.
- Kept legacy compatibility handling for `yumen-1v1-basic` and `collision-test` in mode normalization/predicates and labels so existing sessions still resolve correctly.

**Lesson**:
- Renaming gameplay mode ids should include a compatibility window for legacy persisted values, or older sessions/routes can silently fall into wrong mode branches.


## 41. Chat bracket color parity for class-highlighted names (2026-05-29)

**Implemented / checked**:
- Updated battle-chat name rendering so `[` and `]` brackets use the same class color as the player name.
- Applied the same rule to both actor and target bracketed names in battle narration lines.

**Lesson**:
- If player tags are visually bracketed, color semantics should apply to the whole token (`[name]`), not only the inner text, or class highlighting looks inconsistent.


## 42. Yumen minimap two-style ring rule (2026-05-29)

**Implemented / checked**:
- Simplified current safe-zone ring visuals to only two styles: blue or yellow dotted.
- In countdown/shrinking (non-waiting) phases, current ring now consistently renders as yellow dotted; no solid yellow fallback remains.

**Lesson**:
- When visual semantics are player-facing rules, remove fallback color variants that can reintroduce ambiguity across nearby phases.


## 43. Yumen minimap waiting-phase blue-circle correction (2026-05-29)

**Implemented / checked**:
- Updated minimap current-circle styling so `waiting` phase always renders blue only.
- Kept yellow dotted styling only for active `shrinking` current circles, preserving the phase visual contract.

**Lesson**:
- Safe-zone phase coloring should be explicit per phase (`waiting`, `countdown`, `shrinking`) rather than inferred from fallback current-circle styling.


## 44. Yumen minimap merged-ring blue-priority adjustment (2026-05-29)

**Implemented / checked**:
- Added overlap detection for current-zone and future-zone minimap circles.
- When yellow current ring and blue future ring are effectively merged, the yellow ring is suppressed so the minimap displays a clean blue circle.

**Lesson**:
- For layered circle overlays, merged-state rendering needs explicit priority rules, otherwise two valid styles combine into an unintended third color cue.


## 45. Yumen minimap future-zone visual regression fix (2026-05-29)

**Implemented / checked**:
- Restored minimap zone semantics so the future safe zone is rendered in blue during countdown/shrinking phases.
- Shrinking current zone now renders as a yellow dotted circle, while non-shrinking current zone keeps a softer yellow solid outline.
- Distance text now measures against the future (blue) target zone when that future circle is visible, matching minimap visual intent.

**Lesson**:
- For staged shrinking circles, minimap visual coding and distance-reference logic must use the same phase-aware target/current selection, or players see contradictory guidance.


## 46. Yumen auto-settle immediate trigger correction (2026-05-29)

**Implemented / checked**:
- Fixed `/cheat/yumen/auto-settle` so enabling the checkbox performs an immediate settle evaluation against current alive count.
- When `autoSettle` is enabled and alive count is already `<= 1`, the route now sets `gameOver`, writes `winnerUserId` + `yumenResults`, appends `YUMEN_GAME_END`, and broadcasts those patches in the same update.

**Lesson**:
- Toggle routes that enable automatic behavior should evaluate the terminal condition immediately, not only rely on a future loop tick or unrelated state nudge.


## 47. Battle-start consumable stock correction (2026-05-29)

**Implemented / checked**:
- Updated the authoritative backend starting consumable stock to: 绷带 12, 金疮药 2, 月影沙 1, 砂石伪装 4.
- Synced the frontend BattleArena fallback consumable list to the same counts so local HUD defaults match backend truth before live state arrives.
- Updated the HUD coverage test assertions for `STARTING_CONSUMABLE_COUNTS` so regression checks enforce the new values.

**Lesson**:
- Starting consumable counts are duplicated between backend runtime defaults, frontend fallback display config, and string-based HUD checks. Keep all three in sync in the same change to avoid UI/runtime drift.


## 48. Yumen prep restart and multiplayer follow-up (2026-05-29)

**Implemented / checked**:
- Fixed Yumen presence chat so initial WebSocket subscribe emits `【玩家】加入了战场。`, while `重新连接` only emits after a recorded disconnect; Yumen disconnect chat now ignores stale generic leave notices.
- Disabled the generic `/game/end` leave-notice and delayed no-winner game-over finalizer for Yumen, and guarded the frontend no-winner redirect in this mode.
- Made existing-loop `/battle/start`, next-battle start, and the new `重新开始游戏` route apply the same `准备时间` prep through `addBuff()`, while resetting the Yumen safe zone to idle so auto poison waits for prep exit.
- Fixed multiplayer damage floats to use target-user screen bounds instead of the primary opponent fallback, and made every enemy avatar use the red enemy palette.
- Matched cooldown numbers to the system-chat yellow and reduced cooldown number size/weight.
- Follow-up live verification caught auto-full-shrink racing before the prep buff reached the client; shrink-start routes now reject active `准备时间`, and the frontend only marks auto-start complete after a successful start.

**Lesson**:
- Suppressing a disconnect modal is not enough if the backend still creates `leaveNotice` and delayed no-winner game-over state; mode-specific lifecycle behavior must be disabled at the source.
- Runtime prep buffs should be applied in every battle-start path, including idempotent existing-loop paths, or live reload/second-client starts can skip the official status-bar buff channel.
- Multiplayer UI anchors must key by target id. Primary-opponent fallbacks are acceptable only as a last resort in 1v1 views.
- Client-side auto-start gates are not enough for prep timing, because persisted local preferences can race initial state hydration. Server shrink-start routes must reject active prep and let the client retry after prep ends.


## 49. Target mark SVG refinements (2026-05-28)

**Implemented / checked**:
- Refined the custom target-mark SVGs for `云`, `斧`, and `剑` under `frontend/public/icons/marks`.
- Changed `云` to strict black/white only, broadened `斧` into a clearer axe-head silhouette, and rebuilt `剑` as a more balanced centered sword.
- Corrected the follow-up pass by returning closer to the first version's silhouettes and making only small targeted changes.
- Added transparent SVG target marks for `钩子` and `红鼓` from the supplied references.

**Lessons**:
- Small target marks need strong silhouettes before surface detail; a weapon mark that reads as a throwable object at icon size should be simplified into the canonical weapon shape.
- When the user prefers an earlier art direction, preserve that base and make minimal shape/color edits instead of fully redrawing the asset.


## 50. 玉门关 KILL / 观战 death state (2026-05-28)

**Implemented / checked**:
- Replaced the Yumen-only `测试重置` death reset with a `观战中` spectator state: HP stays at 0, buffs/debuffs are cleared, ability hand is saved then emptied, owned zones/entities are removed, combat links/targets are cleared, and the spectator buff grants stealth, untargetable/invulnerable/damage immunity, +100% speed, and high multi-jump count.
- Added last-hit defeat attribution for Yumen using only the current damage event window. Player final hits broadcast `【被击败者】被【击败者】重伤，黯然离去。`; poison/no-player final hits broadcast `【被击败者】黯然离去。` and do not grant kill credit.
- Added `战意` as the Yumen kill reward: 30 seconds, refreshes on reapply, heals 16130 HP each second through the normal periodic-heal path, so heal reduction and 狂沙 healing penalty apply.
- Added `复活全部玩家` to the Yumen control panel and a Yumen-only backend route that restores full HP, removes `观战中`, and restores saved ability hands.
- Follow-up tightened the spectator state: death now clears consumable counts/cooldowns in the same broadcast as the emptied hand, `观战中` is registered as a debuff in preload so the official status bar shows it without normal cancel affordance, and runtime `战意` metadata is also preloaded so the buff appears on the official bar.
- Added a Yumen-only `自动满血` test toggle, default off. When off, fatal HP enters spectator death; when on, it restores HP through the old testing heal branch.
- Added Yumen spectator ability-bar locks in backend cheat/pickup mutation paths and frontend bar/preset mutation handlers, so a ghost cannot add, reorder, discard, or claim new skills.
- Added `YUMEN_DEFEAT` events for the frontend red-brush kill notice, plus draggable/resizeable kill-notice and alive-count HUD controls under ESC → 测试 → 击杀.
- Follow-up split Yumen ghost nameplate visibility from health-meter visibility, so ghosts can hide HP bars without hiding player names.
- Follow-up Yumen death cleanup now removes combat links for the defeated player and for opponents linked to that player, emits combat-exit events, and broadcasts the combat state patches so `战斗中` does not stick forever after death.
- Follow-up polished Yumen kill UI: softened and lowered the full-screen kill broadcast, removed the white backing, added custom placement plus width/height controls for the personal kill confirmation, redesigned `剩余人数`, and added a dark sandy screen veil for `狂沙`.
- Added a manual Yumen end-game route and result overlay. When alive count is at most one, the test control can store `yumenResults`, show rank/stat/reward rows, auto-leave countdown, and a `离开战场` action while skipping the old tournament-complete flow.
- Live-verification correction: the result overlay must sit above movable chat/map/HUD panels, or the ranking table can be covered at match end.
- Corrective pass: Yumen death chat is no longer rebroadcast from the generic post-cast defeat announcer. Live Playwright verified one real `观战中` death, then two follow-up casts kept the `重伤，黯然离去。` system-chat count at one.
- Corrective pass: ghost opponent names render gray, the 狂沙 veil is lighter and sand-colored, kill-broadcast/kill-confirm visuals were softened, and ESC test controls gained preview buttons plus a single true `剩余人数缩放` control.
- Corrective pass: Yumen settlement now uses rank-by-attendee scoring. In a two-player live verification, rank 1 scored 2 for 40 display stars and rank 2 scored 1 for 20 display stars.
- Added an `自动结算` test checkbox next to `结束战场`, default off, with live verification that enabling it at one alive player stores `yumenResults` and shows the result overlay.
- Corrective pass: `战意` now keeps its written 16130-per-tick heal as a raw flat number instead of passing through the normal flat-heal scale. It still cannot crit and still receives the 狂沙 heal penalty.
- Added a `测试缩短cd` Yumen control. Default off uses real cooldowns; when enabled, ability cooldowns and charge recovery are capped at 3 seconds for testing.
- Added the ability-editor `CD纠正` tab for entering cooldown seconds and marking each ability as 未修正 / 需要补充 / 已修正.
- Corrective pass: Yumen settlement header needs explicit CSS anchors for the small `队伍排名 x/x` label. Without `yumenResultTop` + `yumenResultTeamRank`, the label drifts from the modal's top-right.
- Corrective pass: Yumen auto-settle alive counting now also honors unresolved `YUMEN_DEFEAT` events (unless a later `YUMEN_REVIVE` exists), not only HP/flag snapshots.

**Lesson**:
- Death attribution for poison-zone modes must use the fatal tick's newest positive damage event, not historical damage fallback. Otherwise old player damage can incorrectly steal poison deaths and grant kill rewards.
- Clearing a player's hand inside the game loop needs an explicit full-hand broadcast patch; cooldown-only hand diffs do not tell the client that the whole bar was emptied.
- Runtime-only buffs must be registered in the preload `buffMap`; otherwise the official `StatusBar` silently drops them even though they exist on the player state.
- If a ghost/spectator state clears ability hands, it should also clear consumable runtime fields and explicitly broadcast those paths, or the client can keep stale item counts.
- Correction pass: the generic `checkGameOver()` testing reset can still fire immediately after ability damage, before the Yumen loop handles death. Tag battle states with their mode and skip that reset for Yumen, or `[测试重置]` can appear even when the Yumen death branch no longer heals.
- Correction pass: defeat attribution needs to accept `DAMAGE` events that carry actor/target but no numeric `value`; otherwise player kills become unattributed `大漠狂沙` deaths and `战意` is not granted.
- Correction pass: fresh lobby-created battle states need `playerNames` copied into runtime state so `YUMEN_DEFEAT` events can broadcast real names instead of undefined/fallback labels.
- Correction pass: Yumen alive-count and ghost visibility should also derive defeated users from `YUMEN_DEFEAT` events, because a client can receive the event before the corresponding spectator-buff patch is reflected in opponent state.
- Correction pass: no-attacker Yumen system chat still needs the defeated player's real battle name (`【玩家名】黯然离去。`), not a generic `游客` fallback. Prefer the game state's `playerNames` map over account/default names for battle-end chat.
- Correction pass: `战意` periodic heal should carry an explicit `noCrit` marker in the buff definition, and the periodic-heal runtime should honor that marker so future refactors cannot accidentally make it 会心 again.
- Correction pass: raw-value periodic heals must opt out of `FLAT_HEAL_SCALE`; otherwise a written value like 16130 can display as an 80万-scale heal after stat scaling.
- Correction pass: 狂沙 screen color should be a darker orange sand wash with only smooth radial color layers. Do not use repeating gradients or line textures for that overlay.
- Correction pass: Yumen result rank totals should come from actual attendee rows, not a hardcoded lobby capacity such as 20.
- Correction pass: test-only cooldown shortening should be an explicit match toggle, because always capping cooldowns hides real cooldown data while tuning CD values.
- Correction pass: event-derived ghost state needs a matching `YUMEN_REVIVE` event, not an HP-patch heuristic. Otherwise alive count can be instant after death but stale after revive, or revive can unlock backend buffs while the frontend still says `观战中`.
- Correction pass: mark Yumen deaths on the player state until revive. Relying only on an active spectator buff can let later casts rediscover the same 0-HP player and rebroadcast the same `重伤` chat.
- Correction pass: clearing consumables to `{}` also needs frontend handling; missing keys inside an explicit count object mean zero, not the item's starting count.
- Correction pass: `hideHpBar` was too broad for Yumen ghosts because it hid the whole billboard, including names. Use a separate `hideHealthMeter` flag when only HP/shield bars should disappear.
- Correction pass: manual Yumen game-over needs persistent `yumenResults` in state and timestamp normalization on the client; otherwise reconnects or server/client clock drift can break the result countdown.
- Correction pass: after adding Yumen HUD/runtime fields, keep the narrow `BattleArena` prop and helper union types in sync. Next production builds skip type validation in this repo, so use editor diagnostics or a focused type check on touched files to catch these issues.
- Correction pass: mode-specific ghost deaths must bypass generic defeat-announcement fallback after every cast. The Yumen loop already has a one-time `yumenDefeated` guard, but `/play` can still inspect historical fatal events unless explicitly skipped for Yumen.
- Correction pass: Yumen score/reward display is rank and attendee-count based, not damage/kills based. Keep this formula in a shared helper so manual settlement and auto-settlement cannot drift.
- Correction pass: auto-settle is a test preference, not the default match rule. Store it on `safeZone`, preserve it through safe-zone resets, and only finish the match automatically when the flag is true and alive count reaches at most one.
- Correction pass: keep the big center rank banner (`第x名`) and the small corner team rank (`队伍排名 x/x`) as separate layout rules so visual tweaks only affect the intended text.
- Correction pass: for auto-settle and manual-end guards, rely on the same defeat/revive event truth as the UI when state snapshots can lag one tick behind event emission.


## 51. 临时飞爪 crash, minimap target zone, and diagnostics pressure (2026-05-28)

**Implemented / checked**:
- Fixed a `ReferenceError: Cannot access 's' before initialization` crash triggered after 临时飞爪 battle events. The root cause was battle chat rendering computing target color from `battleTargetName` before `battleTargetName` was initialized.
- Removed the in-game crash diagnostics panel/download/upload controls. Fatal crash diagnostics now log a structured report object to the browser console and still upload automatically to backend logs.
- Changed the yumen minimap distance text to measure against the blue target zone during countdown/shrinking phases, while non-shrink phases still use the current safe zone.
- Flipped the yumen minimap player marker by 180 degrees so its baseline facing matches the game while preserving left/right turn direction.
- Latest latency aggregation showed movement route backend processing remained low (usually 0-3ms, max under 30ms in the newest two-account run), but PM2 backend logs still had event-loop callback gaps and GC pressure. The likely self-inflicted source was diagnostics: each latency batch scheduled a full latency-log prune, while hidden-tab main-thread stalls uploaded repeatedly. Latency-log pruning is now debounced to at most one delayed prune window, and hidden-tab stall logging/upload is rate-limited.
- Follow-up live logs showed debounced latency-log pruning was still too heavy for active gameplay: each delayed prune could take about 1.1-1.4s and align exactly with backend event-loop/game-loop callback gaps. Normal latency uploads no longer schedule pruning; pruning should stay out of the gameplay request path.
- Follow-up minimap correction inverted the displayed Y axis for marker and safe-zone circles. The facing triangle already used the inverted screen-space basis, but the marker position did not, making the avatar walk backward or sideways relative to its facing.

**Lesson**:
- A minified TDZ error after an ability cast can be caused by secondary UI event rendering, not the ability execution path. Map the chunk offset before chasing the gameplay code.
- Manual diagnostic collection UI should not appear in gameplay. Prefer F12 console output plus existing server-side logs unless the user explicitly asks for export controls.
- Diagnostic tooling can become the lag source. Avoid running whole-log prune/parse work for every uploaded sample batch, and treat hidden-tab browser timer throttling as low-value noise.
- Debouncing an expensive diagnostic prune only reduces frequency; it does not make it safe for active battles if the prune still runs on the Node event loop. Keep whole-log pruning manual/admin-side or otherwise outside active gameplay.
- For SVG minimaps, remember screen Y increases downward. If the world/map convention is north-up, convert display Y with `mapHeight - worldY`; facing rotation must use the same inverted screen-space basis.


## 52. 玉门关 battle-log, arena line, ESC, and lag probes (2026-05-28)

**Implemented / checked**:
- Reverted the local-viewer 狂沙 self-log exception and filtered battle narration by self/same-side actors so the player only receives opponent-related battle messages.
- Restored the 3D arena current safe-zone white line independently of minimap phase semantics; minimap code was not part of this correction.
- Changed ESC handling so channel/target selection state no longer intercepts the key before the ESC panel can open.
- Added thresholded `[LAG-PROBE]` timestamps for backend event-loop delay, game-loop callback gaps, slow ticks, DB saves, structuredClone cost, WebSocket broadcast cost, diagnostics batch writes, and frontend main-thread stalls.

**Lesson**:
- Minimap safe-zone semantics and 3D arena line visibility are separate surfaces. A minimap-only instruction should not gate or hide arena overlays.
- Self-authored or same-side combat narration can create both privacy/noise bugs and target-color bugs; battle logs should be filtered from the viewer perspective before formatting.
- Random lag diagnosis needs fresh correlated timestamps from both producer and consumer paths. Old PM2 logs or older latency-page samples should not be used as evidence for a new stall report.


## 53. 玉门关 safe-zone speed, PM2 cleanup, and movement lag correlation (2026-05-28)

**Implemented / checked**:
- Changed the final yumen full-poison shrink from 25 to 0 to complete in 1 second in the fast/test timeline, and kept the legacy generic phase table's final 25-to-0 collapse at 1 second.
- Deleted the old `frontend`, `backend`, `rencipe-frontend`, and `rencipe-backend` PM2 apps, then re-added only this project's `frontend` and `backend` apps from `ecosystem.config.js`.
- Found the ESC panel root cause: state toggled, but the panel render was still gated to `collision-test`; the panel now mounts in yumen and was verified by both the bottom-right button and Escape key.
- Correlated two-window Playwright movement runs with fresh PM2 `[LAG-PROBE]` logs. The observed hard snap happened when frontend main-thread stalls (~700-800ms) overlapped backend game-loop callback gaps (~200-260ms); the tick body itself was usually only 1-5ms.
- Removed the movement route's per-request `GameLoop.getState()` clone by adding a direct `setPlayerInputForUser()` path that returns a tiny movement ack, and added thresholded movement-route and backend GC probes.
- Disproved a backend loop resync policy: skipping catch-up after large scheduler gaps avoided burst simulation but worsened movement ack latency in live two-window verification, so the policy was backed out.
- Aligned frontend local-physics catch-up with the backend 6-tick cap and added stall-aware soft XY reconciliation. Final live verification still saw browser stalls under local two-window stress, but post-stall corrections became soft (`~1.9-2.4u`) instead of the previous `5-6u` hard snap.

**Lesson**:
- Backend lag and frontend prediction must be correlated by timestamp before choosing a fix. In this case movement/collision work was not slow; the visible failure was a frontend stall plus backend scheduler gap causing a hard reconciliation snap.
- Do not call `GameLoop.getState()` from high-frequency movement POSTs just to find a player and return an ack. Full-state structured clones in the movement path add allocation pressure and latency; use a loop method that works on the authoritative state and returns only the required fields.
- A delayed game loop catch-up is not automatically wrong, but client prediction must tolerate delayed server positions. After local main-thread stalls, normal movement should soften large reconciliation deltas unless a server-owned movement source like dash, knockback, pull, or airborne correction requires authority.
- Validate loop scheduling policy changes with real movement metrics. A plausible resync/pause strategy can make authoritative input feel worse if it turns every server scheduler gap into gameplay time loss.


## 54. 玉门关 safe-zone corrective pass 3 (2026-05-28)

**Implemented / checked**:
- Corrected yumen minimap circle semantics: wait/no target shows a single blue current circle; countdown/shrink shows current as yellow dotted and future target as blue on top, so overlap reads as blue.
- Flipped the minimap player marker left/right rotation and kept full-poison red styling only on the range/status row, not `已刷圈/总圈数`.
- Changed `追命` to 30 seconds and stopped removing it when leaving 狂沙, while avoiding outside-zone time counting toward the next stack tick on re-entry.
- Renamed yumen poison damage events to `狂沙`, allowed their self-hit battle log line, and added `暂停 / 继续 / 重置` controls with a resume endpoint that preserves paused shrink progress.
- Added the buff timer-visibility editor tab and preload/status-bar support for hiding only an individual buff's timer text.
- Mechanically reset 167 ability description `已修正` statuses back to `未修正`.

**Lesson**:
- Yumen minimap current/future layers must be phase-aware: current-only means blue, while current-plus-target means yellow dotted current under a blue future target.
- Pause/resume of a shrink phase must preserve both remaining time and elapsed progress; otherwise the loop can resume from a later visual progress point.
- Per-buff status display preferences belong in the shared buff override/preload path so editor choices and runtime status rendering cannot drift.


## 55. In-game chat window/account layout polish (2026-05-25)

**Implemented / checked**:
- Added the `battle` chat channel/window path and render battle messages from server `DAMAGE` combat events on the client, keeping battle text white while coloring actor/target names by stored player school.
- Wired battle-chat generation from both WebSocket event payloads and the successful `/play` HTTP patch response, and allowed `DAMAGE` events with entity targets as well as player targets.
- Moved the chat scrollbar into the real left control rail and removed the right-side fake scrollbar; search opens/closes as a dropdown inside the message column without shifting the rail.
- Follow-up: search/log now sit inside a dedicated message column so opening search reduces the log viewport instead of overlaying the first visible message or changing the left rail geometry; the rail track was simplified to a single thumb layer and edge-disabled buttons were dimmed.
- Follow-up: battle chat now emits separate `PLAY_ABILITY` hit logs and `DAMAGE` logs in MMO-style wording, with self-perspective `你/你的` text and `[未知目标]` for stealthed actors or targets observed by other clients.
- Follow-up: chat history refresh now merges server chat with local battle messages instead of replacing the entire chat list, closing search clears the query so stale filters do not hide new battle lines, battle event seeding now runs after game-id reset while new `state.events` changes are consumed as a fallback to `/play` responses, and duplicate near-simultaneous `PLAY_ABILITY` events for one cast collapse to one hit line.
- Follow-up: battle chat now behaves as an enemy-action report: local self-authored events are hidden for the local viewer, stealthed enemy actors are skipped entirely, `DAMAGE`/`HEAL` events feed action-style hit lines instead of amount math, consumable use responses are read for battle events, 金疮药/绷带 emit action events even when no HP is restored, detached chat panels auto-scroll when already at bottom, and the disabled left-scroll thumb is fully hidden.
- Follow-up: detached battle-log auto-scroll needed layout-timed bottom following; a separate metrics refresh could mark the detached log as no longer at bottom before the sticky-scroll effect ran. Chat window settings now treat “关闭窗口” as a hidden-window flag that preserves detached group membership and position, and the chat panel waits for account layout loading before painting to avoid the default-position snap.
- Follow-up: local battle logs are now the only chat messages capped client-side, limited to 200 entries; map/system chat history remains session-scoped. Battle-log generation also filters by the enemy actor's distance to the local player, while normal chat delivery and history are unaffected.
- Follow-up: combat-log visibility range was raised to 200 units. A live system snapshot during reported lag showed MongoDB idle with a tiny local DB and no lock queue; the notable CPU sample was the backend Node process, so lag checks should look at active GameLoop/backend work before blaming local Mongo reads.
- Follow-up: two-account live profiling with authenticated API/WebSocket clients showed the heaviest server-side phase was combined movement+ability traffic: backend Node used about 18% of one core, while `mongod` stayed under 1% and disk read/write bytes stayed at 0. Backend active time was dominated by app/framework serialization plus repeated `GameLoop.getState()` structured clones from movement/snapshot/ability paths; direct movement/collision, ability logic, and WebSocket send time were small in the profile.
- Follow-up: a two-account state-diff audit showed normal movement diffs are small position patches, but ability/test-helper traffic still sends excess full arrays: generic `diffState()` replaces the whole `players` array on ability state changes, and reset-cooldowns replaces each whole `hand` array when only cooldown/charge fields changed.
- Made detached chat groups account-backed through `battleArenaUiLayout.chat.detachedWindows`, `detachedPanelSizes`, and normal detached position keys, while excluding the transient clear dialog position from account layout writes.

**Lesson**:
- Chat UI persistence needs to store both structure and geometry. Detached tab groups are not recoverable from positions alone; save group/window membership, group size, and group position together.
- Combat-system chat can be derived from authoritative event payloads instead of a separate chat write path when the messages are local combat narration. Use the existing event metadata and player-name/school maps so battle messages stay synchronized with live combat state.
- The local caster may receive combat events through the `/play` response before or instead of a WebSocket event payload, so battle chat must read successful action patches too.
- Battle chat should seed/remember combat event ids from the loaded game state before appending live event logs; `/play` responses can include historical `state.events`, so unseeded generation can replay old combat lines after reload. Keep the game-id reset before the seed effect, or the reset can wipe the dedupe seed on mount.
- Server chat history only contains persisted chat, while battle narration is currently client-local; refreshing/searching chat must merge rather than replace or it can erase fresh combat logs.
- Some ability execution paths emit more than one `PLAY_ABILITY` event around the same cast; client battle narration should dedupe near-simultaneous hit lines by actor/target/ability while leaving separate `DAMAGE` events untouched.
- Stealth-sensitive combat logs are best personalized at the client display layer using the pre-diff local state: the hidden player still sees `你`, while observers see `[未知目标]` for stealthed actors or targets in hit and damage lines.
- Enemy-action battle feeds should skip local self-authored entries for the local viewer, skip stealthed enemy actors entirely, and consume `HEAL`/`DAMAGE` as action events when the UI should report activity rather than numeric calculations. Consumable `/use` responses need the same battle-event consumption as `/play` responses, and consumables that should be reportable must emit events even when the applied heal is zero.
- Detached chat panels need their own at-bottom refs and display-length bookkeeping; the main chat `chatAtBottomRef` does not tell detached windows whether they should follow new messages.
- Do not update detached chat at-bottom refs in a generic metrics effect before the auto-scroll decision has run. New content increases `scrollHeight` first, so measuring too early flips “was at bottom” to false and prevents the intended scroll-to-bottom.
- Keep chat history caps channel-specific. If only combat logs need pruning or proximity filtering, apply that in the local battle-message generation path rather than in shared chat append/history merge code, or normal map/system messages will be lost or hidden incorrectly.
- Local MongoDB being on-box does not automatically mean DB read pressure. Check `mongod` CPU, lock queue, connection count, and DB size first; if `mongod` is idle but backend Node is hot, investigate active game loops, event volume, or render/network paths instead of switching databases prematurely.
- For CPU profiling, do not load the full 3D scene when isolating backend cost: headless Chromium software WebGL can consume a core by itself. Use lightweight authenticated HTTP/WebSocket clients, then compare process CPU with Node inspector samples, Mongo serverStatus counters, socket frame counts, and request latency.
- Current Zhenchuan backend hotspots under two-player casting are mostly state snapshot/cloning/serialization paths, especially `GameLoop.getState()`, plus some Mongoose/BSON work from snapshot/cheat/chat saves. Movement collision and ability execution were not the primary CPU consumers in the measured run.
- State-diff trimming and `getState()` clone reduction are related but separate. Trimming `STATE_DIFF` reduces network/JSON stringify/parse and frontend patch work; optimizing `getState()` reduces backend structuredClone CPU even for routes that return HTTP snapshots or validate input without broadcasting.
- State-diff array granularity must preserve identity/order safety. Patch `players` and unchanged-slot `hand` arrays by index, but fall back to whole-array replacement when player/card/entity identities change so removed fields and reorders do not leave stale client state.
- Cooldown, GCD, and activeDash countdowns should be sparse server sync fields plus local client countdowns. Sending only start/reset/end boundaries removes 30Hz countdown payloads while preserving responsive hotbar grayout and dash prediction.
- For reset-cooldowns, treat undefined cooldown-like fields and zero as the same ready state. Otherwise a reset route can avoid whole `hand` arrays but still flood clients with semantic no-op zero patches.
- Sparse activeDash sync must not let local countdown ticks become sample identities. Only new server positions or a new dash sync should re-anchor dash prediction; otherwise the render bridge can reset against stale positions and create directional dash lag or short duplicate dash starts.
- Local cooldown countdowns should animate on `requestAnimationFrame` while any timer is active, then fall back to an idle check interval. A fixed 250ms React clock preserves correctness but makes cooldown arcs visibly step.
- Resource-pack service workers should not intercept app document navigations such as `/game/in-game`; only cache asset requests. Intercepting navigations can surface `FetchEvent ... network error response` noise during reloads or route changes.
- For this MMO-style chat panel, the visible scrollbar belongs in the left rail control area. A separate right overlay reads as the wrong control even if it tracks the same scroll position.


## 56. Alpha passed / beta stage start (2026-05-24)

**Milestone**:
- The project officially passed alpha stage on 2026-05-23 and is now moving into beta-stage feature work.
- Beta work begins with the official `P` 武学界面 / 绝境武学 ability panel, replacing the ad hoc 添加技能 flow with a player-facing panel that stays synced with the six-slot 技能栏.

**Implemented**:
- Added the official 武学界面 with 江湖/绝境 tabs, default 绝境 open state, search, 门派/稀有度 custom filters, 8-column ability grid, rarity icon borders, active six-slot strip, right-click add/remove, drag-to-slot, drag-swap, and local preset save/load controls.
- Reused the same draft ability state and reorder/discard routes as 技能栏; extended add-ability with an optional target `slotIndex` so list-to-slot dragging can place a new ability directly into a chosen active slot.
- Added 武学界面 to custom UI positioning and an ESC 测试 slider for temporary panel size tuning.
- Refined the beta 武学界面 to match the reference layout more closely: separate ESC width/height controls, left-aligned tabs/filters, 8x3 instant row-wheel list scrolling with a custom scrollbar, same-style active slots, account-backed six-slot preset plans, save/rename modals, attached preset side panel, and temporary title-bar dragging.
- Hardened the beta 武学界面 slot semantics: active slots and preset plans now reject duplicate ability ids, dragging a checked library ability moves its existing slot, checked abilities show a green check badge, right-clicking a checked library tile removes the learned ability, and preset slots swap existing entries instead of repeating them.
- Split 江湖 into a display-only page with 防身武艺、基础招式、江湖轻功、奇穴 rows; moved all 武学界面 size controls into a dedicated ESC 测试 tab; added a modal-size setting; and polished the panel defaults, active strip, preset side panel, custom scrollbar visibility, filter controls, and input isolation.
- Completed a fourth beta polish pass: no-slot add-ability now appends to the next open learned slot instead of slot 1, checked library tiles keep only the top-right badge, filter/search/scrollbar/preset spacing was tuned, the last martial tab is remembered, 江湖奇穴 sits shorter at the bottom, active/preset slot sizes were aligned, the 绝境 bottom strip now has 已学习招式 and 已激活增益 sections, learned abilities can be dragged back to the library to unlearn, ESC closes the martial panel first, bottom-right ESC/C/P icon toggles were added, and the legacy 添加技能 test picker is hidden behind an ESC 测试 switch by default.
- Completed the next beta 武学界面 refinement pass: split 门派/稀有度 filter widths, reduced the main/preset panel gap to 2px, moved the ESC quick button to the rightmost gear icon and changed the stats quick icon to a person icon, rebased the preset modal to a smaller 0.5-1.0 scale with responsive internals, made preset plans scroll four-at-a-time by one plan per wheel step, removed discard/delete success toasts, turned 已激活增益 back into a placeholder area, moved 已学习招式 to the right side, and decoupled learned slots from temporary special hotbars/hover state.
- Completed a follow-up beta 武学界面 refinement pass: neutralized selected filter button border/arrow color while keeping option colors, aligned filter row heights, kept bottom-right quick buttons visually neutral when open, restored preset modal horizontal layout with separate ESC width/height controls, added preset-plan 置顶, added placeholder hover on 已激活增益, preserved learned-slot display through temporary special hotbars, added 收藏技能 ordering mode, and improved panel/grid responsiveness on smaller PC viewports.
- Completed another 武学界面 refinement pass: selected dropdown text keeps its rarity/school color while borders/arrows stay neutral, 收藏模式 uses lighter grayscale and hides learned check badges, 收藏模式 helper text is yellow with clarified copy, the preset modal's old 0.6 size became the new 1.0 with responsive internals, ability hover hints close when P closes, the P/preset panels now render from viewport proportions plus scale settings, preset drag-hover boxes were removed, plan/learned/placeholder slots share the same hover glow, and the checked badge border was reduced.
- Completed a focused 收藏/预设 polish pass: 收藏模式 hover and active visuals are now distinct (no more hover-looking active confusion), favorited skills show a red top-right minus badge for direct un-favorite, favorite ordering storage is now account-scoped with legacy migration to the logged-in user key, and 保存预设 modal now keeps prompt text and target buttons on separate rows.
- Completed a micro-visual follow-up: reduced the 收藏红色减号 badge footprint by 20% and tightened 预设页 six-slot gap spacing by 30% for a denser card layout.
- Completed a follow-up correction: 收藏红色减号 now renders only while 收藏模式 is active, and the badge was reduced again to a much smaller footprint for a clearly visible difference from the previous pass.
- Completed another visual correction: increased 收藏红色减号 from ultra-small to a clearer medium-small size, and strengthened 收藏模式非收藏项 gray-out (higher grayscale, lower saturation/opacity) to make favorites stand out more.
- Completed a responsive 武学界面 correction: missing size settings now fall back to intended defaults instead of the 0.1 minimum, and ability columns/visible rows, icon sizes, gaps, footer height, bottom learned/buff slots, and preset card density derive from the actual panel dimensions so lower-height PC windows do not crush the ability list into the bottom strip.
- Completed the ESC 快捷键设置 polish pass: shortcut actions now render one per row with two binding boxes, skill/common/item rows use generic slot labels, 骑乘 has no default T binding, right-click clearing runs through context-menu handling, hotkey edits are staged behind 确定/取消/应用, 恢复配置/清除 moved to the footer, 物品栏 settings moved under 游戏设置, and ESC 测试 martial size sliders now start from system defaults instead of per-browser saved values.
- Completed a follow-up hotkey readability pass: 技能栏 shortcut boxes now sit directly next to their row labels instead of stretching to the far right, row spacing/height was tightened, item-bar hotkey text is 30% larger in white, and wheel bindings now render as MU/MD on the in-game skill/item bars instead of raw WU/WD.
- Completed a follow-up alignment correction: hotkey rows now use a fixed label column plus an explicit label-to-box gap so longer labels no longer push binding boxes sideways, and each shortcut binding box was widened by about 30% for a more even desktop layout.
- Completed a final hotkey color adjustment: the displayed shortcut text inside ESC shortcut binding boxes now renders in white instead of yellow for better consistency with the rest of the settings panel.

**Lesson**:
- Large new UI features should first trace the full existing gameplay, slot, route, and custom UI systems before implementation so the official surface shares live state instead of duplicating it.
- When two UI surfaces represent the same combat slots, render both from the same slot array and route all changes through the same live-state endpoints; otherwise hotbar/panel drift is almost guaranteed.
- Preset-like combat UI should save complete slot arrays, including empty slots, so applying a plan is deterministic instead of compacting abilities into earlier slots.
- Scrollable combat panels should avoid browser-native scrollbars; custom row paging gives better speed control and a more consistent in-game look.
- Duplicate prevention for combat slot UIs must live in backend routes as well as frontend affordances. UI checks make the interaction feel right, but route-level de-duping keeps account presets, live hand state, and pickup/draft edge cases from drifting back into invalid repeated slots.
- Optional slot parameters need explicit null handling. Passing no slot must not flow through numeric normalization as `0`, or append-style UI actions can silently become front-insert/swap actions.
- Keep permanent learned-slot state separate from temporary special ability bars. Short-lived replacement hotbars should not change preset saves, learned-slot rendering, or hover feedback in the 武学界面.
- 收藏/置顶 style ordering should be a display-order layer over the canonical ability list. Keep the user's favorite order separate from school/rarity/search filters so favorites stay easy to find without mutating ability definitions or live draft slots.
- For desktop-only game panels, prefer viewport-ratio defaults multiplied by user scale settings over fixed pixel defaults; this keeps the same screen footprint across different PC resolutions while still preserving custom sizing.
- When a toggle has both hover and active states, keep them visually distinct; sharing the same color creates false-state confusion when the pointer is still over the control.
- For 武学界面-style panels, derive not only outer size but also visible row count, grid columns, slots, card count, and toolbar widths from the rendered dimensions; a fixed 8x3 grid plus fixed bottom strip will overlap as soon as viewport height drops.
- LocalStorage numeric settings need explicit null/empty handling before `Number(value)`. `Number(null)` becomes `0`, which silently clamps absent martial size settings to the minimum instead of the default.
- Shortcut settings should stage edits separately from the saved binding profile when the UI exposes 确定/取消/应用. Immediate localStorage writes make a disabled/enabled Apply button and cancel behavior impossible to reason about.
- For compact in-game panels, clipping overflowing labels is preferable to adding ellipsis; the dots consume scarce horizontal space without making the control clearer.
- For hotkey-setting rows, avoid flexible full-width binding columns when the intended layout is label-plus-inputs. A max-content row track plus fixed-width binding cells keeps the two shortcut boxes visually attached to the label instead of drifting to the right edge.
- When labels and inputs must align in a settings grid, keep the label column fixed to the longest expected label width. Using content-sized label tracks makes every row start at a different X position as soon as one label is longer than the rest.
- For dense ESC settings panels, keep the editable shortcut text color consistent with other neutral UI labels unless a specific warning or capture state needs a highlight color.


## 57. China VM deployment planning (2026-05-23)

**Planning / finding**:
- Current production shape is two PM2 Node processes: Next frontend on `3000` and compiled Express/WebSocket backend on `5000`, with MongoDB via `MONGO_URI` and `/ws` proxied to the backend.
- A first mainland China deployment should start around `4 vCPU / 8 GB RAM / 80 GB SSD / 10-20 Mbps`; use `16 GB` if MongoDB is local, multiple 5-player rooms are expected, or build/install work must happen on the VM under pressure.
- Five-player gameplay is not just infrastructure: `startGame` allows up to 5, but `joinGame` still caps rooms at 2 and backend loop/channel logic still has some 2-player assumptions.
- Mainland VMs generally support SSH and VS Code Remote SSH, but ICP/domain rules, provider security groups, China-side npm/GitHub speed, and same-region MongoDB matter for a smooth launch.

**Follow-up correction**:
- For a tighter budget, `2 vCPU / 16 GB RAM` is a more realistic floor than insisting on `4 vCPU`. The backend is a single Node process, so extra cores are mainly headroom for frontend/nginx/Mongo contention rather than an absolute requirement for one active room.
- `80 GB` disk is comfort, not a hard floor. Shipping built artifacts from the dev machine can fit into `40-60 GB` if MongoDB is external and logs are managed.
- If the app VM is in mainland China but MongoDB Atlas stays in the US, cross-border DB latency and route instability are likely a bigger operational risk than raw VM size. For this scale, a local MongoDB on the VM is acceptable if it binds to localhost, has backups, and the VM keeps enough RAM headroom.
- Oracle's public OCI pricing pages state pricing is globally consistent across locations, and Oracle lists Japan as a country with two cloud regions. Using the higher public hourly rate for budgeting, an x86 E4 VM at `1 OCPU / 16 GB` (`2 vCPU / 16 GB`) is about `$36/month` before storage, `2 OCPU / 16 GB` (`4 vCPU / 16 GB`) is about `$54/month`, and `40-60 GB` block storage adds only about `$1.02-$1.53/month`.
- Oracle's Ampere A1 free tier is unusually attractive for low-budget deployment: up to `3,000 OCPU hours`, `18,000 GB hours`, and `200 GB` block storage monthly. In practice that can cover one `4-core / 24 GB` Arm VM if the chosen signup region has capacity, but it should be treated as best-effort capacity rather than a guaranteed production baseline.

**Lesson**:
- For this app, a China deployment runbook must cover nginx WebSocket proxying, same-region MongoDB, PM2 process scoping, fresh VM env files, and asset/build shipping. A copied `.next` directory alone is not enough because the frontend is not using Next standalone output.
- Oracle is a strong cost candidate when the goal is low monthly spend, but the real comparison is not only VM list price: x86 gives the least deployment friction, while Arm/free-tier value is better only if region capacity and package compatibility cooperate.


## 58. Shortcut locked role actions and backend storage audit (2026-05-23)

**Implemented / checked**:
- Added locked, gray ESC 快捷键 rows for 角色动作 and made the exact W/S/A/D, arrow, Space, and T bindings unavailable to editable shortcut tabs.
- Added 界面开关 shortcut rows for 人物属性 (`C`) and 技能界面 (`P`), with 技能界面 toggling the existing 添加技能 panel.
- Replaced per-row 清除 buttons with right-click behavior: right-click while editing cancels capture; right-click while not editing clears the binding.
- Confirmed live MongoDB connection uses database `baizhan_V2`; current backend code writes account/profile data to `users` and game sessions to `gamesessions`, while editor override JSON and diagnostics JSONL logs live under `/home/ubuntu/zhenchuan`.

**Lesson**:
- Role/movement keys need a reserved binding layer before user-editable shortcuts are normalized or captured. Otherwise old browser-local shortcut saves can silently steal movement keys even after the UI displays them as locked.


## 59. Common qinggong stale displacement grayout (2026-05-22)

**Finding / fix**:
- Common directional qinggong applies a short Dash Runtime buff with `DISPLACEMENT`; if the frontend state still contains that buff after its `expiresAt`, BattleArena's grayout predicates treated it as active and could lock most/all abilities with qinggong/displacement warnings.
- Added a shared active-buff filter for BattleArena client predicates so expired player buffs are ignored locally even before the next `/players/*/buffs` patch removes them from React state.

**Lesson**:
- Frontend gameplay gates must not treat a buff array entry as active solely because it is still present in client state. Always apply the `expiresAt` guard locally for lock, control, targeting, range, and visibility predicates; compact state diffs can arrive after wall-clock expiry.


## 60. Resource pack predownload and cache service (2026-05-22)

**Implemented**:
- Added a standalone `/resource-pack` page reachable from the lobby so players can warm local browser cache before entering a game.
- Added `/resource-pack/manifest` outside `/api` because this project's Next `/api/*` paths are proxied to the backend before frontend route handlers.
- Added a Cache Storage + service worker resource pack for normal game URLs: icons, fonts, game audio/assets, exported map files, and Next static chunks.
- Moved lobby actions to `开始` → `下载资源包` → `校验`, with query actions that open the resource-pack flow directly.
- Changed the lobby `下载资源包` / `校验` actions to open an embedded same-origin modal instead of navigating away from the lobby; the resource-pack route uses its own page chrome and hides the global top bar.
- Added a download/check modal with file progress, cache completeness, live download speed, estimated remaining time, and last verification timestamp.
- Added exported-map asset discovery so GLBs, textures, terrain textures, heightmaps, and collision sidecars are included without manual upload.
- Made service-worker registration best-effort with a timeout and populated the manifest list before registration, preventing the page from staying at `0 / 0` if a browser's service-worker registration stalls.
- Switched the resource-pack manifest to include the real `/full-exports/...` game URLs with file sizes instead of adding zero-sized map URLs client-side.

**Lesson**:
- A zip file alone cannot make existing `<img>`, audio, GLB loaders, and `fetch()` calls read local resources. Browser predownload should use Cache Storage and a service worker so the original URLs resolve from local cache during play.
- Do not block the resource-pack UI on service-worker readiness; load and show the manifest first, then report cache-service availability separately.
- `校验` should be an actual Cache Storage scan against the current manifest. If every URL is present, set a completion/verification marker and show `已完成`; otherwise clear the ready marker so stale or partial packs are not trusted.
- Zip delivery can reduce request count and compress large JSON, but it is not directly usable by the game. A zip option must download once, stream-unzip client-side, and write each original URL into Cache Storage; otherwise normal icon/audio/GLB/map fetches cannot read it.
- Live cold-vs-pack test showed the pack works at the transport layer: cold game load fetched about 101 MB of icon/map/GLB resources from network with map asset responseEnd around 5s; after resource-pack download, game load used Cache Storage for icons/map/GLBs with about 37 KB transfer and map asset responseEnd around 1s. If `场景加载中` remains afterward, investigate map parse/render readiness separately from resource download.


## 61. Network diagnostics flight recorder for China-to-US testing (2026-05-22)

**Implemented**:
- Added authenticated latency diagnostics endpoints that write sanitized JSONL batches/reports under `/home/ubuntu/zhenchuan/logs/latency/`.
- Added a client latency recorder that auto-starts during in-game sessions and batches samples while the tester plays.
- Added `/network-diagnostics` as the standalone 网络诊断 page with recent/starred game selection, player tabs, metric cards, slow-transfer rows, and readable timelines.
- Added a compact 快速诊断 panel that uses the best/catcake player as the baseline, compares latency/state/movement/HTTP/transfer symptoms, and suggests whether to fix player network path, WebSocket/diff payload, `/movement`, nginx, or backend processing first.
- Tightened 快速诊断 reliability: one-way up/down estimates from client/server timestamps are treated as clock-derived estimates, not decisive slow-transfer evidence; RTT needs sustained average/latest evidence or corroborating state/movement problems before blaming a player connection.
- Display detailed outliers as 异常样本 rate instead of a raw scary slow-count, so rare tail spikes do not contradict a healthy quick diagnosis.
- Measured existing latency reports and found the real gameplay transport waste was not the report reader: movement input was POSTed every 33ms even when unchanged, BattleArena also ran a duplicate HTTP ping loop despite WebSocket RTT pings, and server WebSocket broadcasts included many unchanged state patches.
- Reduced real gameplay traffic without hiding diagnostics: full latency sample rows are kept, movement POSTs now send on input/facing change, jump, or a safety heartbeat, the duplicate HTTP ping loop was removed, WebSocket RTT feeds the HUD, and unchanged server state patches are filtered before broadcast.
- Fixed diagnostics sanitizers to preserve boolean values; stringifying `true`/`false` made later analysis of idle movement, jumps, accepted flags, and failures unreliable.
- Removed the in-game latency upload/download controls; gameplay UI should only record silently, not host the report reader.
- Captured WebSocket PING/PONG RTT, server receive/send timestamps, state-diff cadence/payload sizes, snapshot/action HTTP timings, and movement POST timings with backend receive/respond timestamps.
- Retains the latest 5 unstarred recorded games plus any starred games, and ignores generated `logs/latency/*.jsonl` / starred-store files alongside the existing diagnostics logs.

**Lesson**:
- For remote latency tests, record both client-observed timings and server timestamps, then read them from a separate diagnostics surface. RTT alone cannot distinguish China-to-US network delay, server processing time, state-diff jitter, HTTP input ACK delay, or reconnect gaps.
- Long telemetry lists are hard to act on; always put a baseline-based summary and fix suggestion above raw timelines so a quick scan says whether the likely problem is player route, transmission direction, WebSocket state sync, movement HTTP, or backend processing.
- Do not diagnose a nearby/same-network device as bad from P95-only or one-way timestamp estimates. Prefer reliable client-observed intervals/durations, server processing time, and multi-signal corroboration; show low-confidence observations separately.
- Do not solve gameplay latency investigations by hiding diagnostic samples. First inspect the actual transport path: in this app, player movement upload is `/api/game/movement` HTTP, WebSocket client upload is mostly PING, and server WebSocket download can waste bandwidth by resending unchanged patches.


## 62. Generated crash/frontend logs should stay untracked (2026-05-22)

**Finding**:
- GitHub rejected a push because `logs/client-crashes/2026-05-22.jsonl` had grown to 121 MB and the repo was already tracking generated diagnostics JSONL files under `logs/client-crashes/` and `logs/frontend/`.

**Fix / lesson**:
- Added git ignore rules for generated diagnostics JSONL logs and removed the tracked log files from the Git index without deleting the local copies.
- Crash/frontend recorder outputs are runtime evidence, not source artifacts; they should stay local or be archived outside Git.


## 63. Refresh movement sequence reset (2026-05-22)

**Finding**:
- Real post-refresh logs showed W key events, direction payloads, and successful `/api/game/movement` HTTP responses, but the authoritative position and velocity stayed unchanged before snapping the locally predicted player back.
- The frontend movement sequence starts at `1` after page refresh, while the live backend `GameLoop` kept the old high `playerInputSeq` for that player. `setPlayerInput` silently ignored every lower post-refresh seq, and the route still returned `success: true`, making the ACK misleading.

**Fix / lesson**:
- Movement POSTs now include a per-page movement client session id and start timestamp. `GameLoop` tracks that session per player, resets the sequence guard when a newer page session appears, and rejects older page sessions/stale seqs with `accepted: false`.
- The movement route returns `accepted` so diagnostics can distinguish transport success from authoritative input acceptance.
- The refresh regression test now primes a high backend movement seq before reload, then verifies the refreshed page's low seq movement changes the backend position. Refresh reconnect tests must reproduce sequence history, not just reload a fresh low-seq page.


## 64. Crash recorder normal-end cleanup and refresh checklist (2026-05-22)

**Finding**:
- Treating `InGameClient` unmount as a clean exit is wrong because refresh, route replacement during a broken reconnect, and tab destruction all unmount the component without proving the game ended normally.
- The refresh/reconnect bug needs an initial-start checklist and an after-refresh checklist that includes snapshot, WebSocket open/close, PONG, state diff progress, and backend movement acknowledgement; visual local walking alone does not prove the backend accepted movement.
- Live refresh testing with `catcake` showed snapshot, WebSocket, PONG, state diffs, and movement requests were alive after reload, but W movement rehydrated through the wrong facing/yaw convention. `me.facing` was converted with `atan2(f.x, f.y)` while movement/camera code uses `atan2(f.x, -f.y)`, so post-refresh W could point into collision and appear like backend movement was not reconnecting.

**Fix / lesson**:
- Normal diagnostic cleanup is now limited to explicit leave and true game-over paths. Refresh/unmount keeps crash evidence and records a warning breadcrumb instead of marking a clean exit.
- Added a session-scoped cleanup endpoint that removes only matching JSONL entries for the authenticated user/game/session after a normal ending, preserving abnormal sessions.
- Added compact connection-checklist breadcrumbs and a live two-player Playwright regression test that verifies backend position changes before and after refreshing the in-game page.
- Rehydrate BattleArena yaw through the shared `facingToYaw` helper; duplicating coordinate conversions is exactly how refresh-only movement drift appears.


## 65. PC hard-disconnect finding after state-diff sampling (2026-05-21)

**Finding**:
- The follow-up crash for PC user `catcake` in game `6a0f8d643edda46d6c578aba` still did not emit a browser fatal error, unhandled rejection, WebGL context loss, pagehide, beforeunload, or frontend/backend PM2 process crash.
- The state-diff sampling fix worked: frontend batches were small, had no dropped entries, and showed `skippedSinceLastLog` summaries instead of tick-rate persistent writes.
- PC Chrome's last uploaded heartbeat/logs were normal (`visible`, online, one canvas, stable scene counts, roughly 100 MB heap). The last PC frontend entry was a sampled `STATE_DIFF` at `2026-05-21T23:04:25.964Z`; the survivor saw `PLAYER_DISCONNECTED` for `catcake` at `2026-05-21T23:04:29.610Z`.
- Server logs only said the PC WebSocket unsubscribed, so the next missing evidence is the WebSocket close code/reason and whether the server heartbeat terminated a dead socket.

**Action / lesson**:
- Added backend WebSocket close-code logging and heartbeat-termination logging so the next hard disappearance distinguishes browser abnormal close, network drop, and server heartbeat cleanup.
- When no client fatal/page lifecycle event is captured and the socket simply disappears, treat it as a renderer/browser/network-level loss until close-code evidence says otherwise.


## 66. PC crash diagnostics overhead finding (2026-05-21)

**Finding**:
- The Safari guest `GAME_OVER` / root-route clean exit was expected behavior and was not the PC crash. The useful survivor-side clue was `PLAYER_DISCONNECTED` for PC user `catcake` at `2026-05-21T19:18:55.854Z`.
- PC Chrome remained visible/online with normal heap, DOM, canvas, and scene metrics in the last heartbeat/log batches. There was no captured uncaught fatal error, WebGL context loss, or PM2 backend/frontend process crash.
- The frontend recorder was persisting every 30 Hz `STATE_DIFF` message as a breadcrumb. Each breadcrumb appended to the durable frontend log queue with synchronous localStorage parse/stringify, creating avoidable main-thread work and causing uploaded batches to lag behind real time.

**Fix / lesson**:
- Coalesce high-frequency `STATE_DIFF` diagnostics: keep the latest state version current, persist a sampled breadcrumb every few seconds, and include a skipped-count summary instead of writing every tick.
- Diagnostics for renderer crashes must never add per-frame or per-tick synchronous storage work; keep persistent logs focused on fatal/error/lifecycle events plus sampled health breadcrumbs.


## 67. Random white-screen crash recorder implementation (2026-05-21)

**Follow-up correction**:
- ESC diagnostics are only useful while the UI is still alive. Added an automatic frontend log stream at `/api/diagnostics/client-frontend-log` that writes sanitized JSONL batches under `/home/ubuntu/zhenchuan/logs/frontend/` during play.
- The recorder now keeps a bounded frontend-log queue across refresh, uploads it every few seconds, and forces keepalive/beacon uploads on page hide, unload, disconnect-style major events, WebGL loss, and fatal errors.

**Lesson**:
- For a true white-screen or renderer crash, the primary evidence must already be in backend frontend logs before the crash; localStorage recovery and ESC copy/upload are fallback/convenience paths, not the main path.

**Implemented**:
- Added a frontend crash recorder with durable localStorage session/breadcrumb buffers, global error/unhandled-rejection hooks, console warn/error capture, page lifecycle capture, heartbeat uploads, previous unclean-session upload, and redaction for token/cookie/password-like fields.
- Added a React crash boundary around the in-game battle view so render/runtime errors upload a report and show a solid fallback instead of a plain white screen.
- Added an authenticated backend endpoint at `/api/diagnostics/client-crash-report` that writes sanitized JSONL entries under `/home/ubuntu/zhenchuan/logs/client-crashes/`.
- Wired WebSocket connect/error/close/reconnect messages and player disconnect/reconnect messages into the recorder, including last disconnect time and crash/event-to-disconnect relation.
- Wired BattleArena behavior breadcrumbs: movement samples, jump attempts, ability casts, ground casts, keyboard inputs, mouse/touch camera actions, movement failures, scene metrics, WebGL context loss/restoration, and ESC -> 测试 -> 崩溃诊断 copy/download/upload controls.
- Removed token-bearing WebSocket debug output from browser console logs while preserving redacted connection context.

**Verification plan**:
- Build backend/frontend, restart only `frontend` and `backend`, then use the diagnostics panel or `window.__zhenchuanCrashRecorder` to upload a manual report and confirm JSONL output.

**Lesson**:
- Crash logging must explicitly record the timing relationship between behavior, heartbeat, WebSocket disconnect, reconnect, and fatal/error events; otherwise delayed white-screen failures are almost impossible to separate from network drops.


## 68. Random white-screen crash investigation plan (2026-05-21)

**Unresolved issue**:
- The live game can randomly collapse into a white screen after running for a while, and DevTools/F12 may not be usable afterward. This suggests console-only debugging is not enough and the failure may be renderer-process, WebGL/GPU, memory, or fatal runtime related.

**Plan recorded**:
- Added `CRASH_DIAGNOSTICS_PLAN.md` with a flight-recorder approach: durable frontend ring buffer, IndexedDB/localStorage fallback, backend JSONL crash-report endpoint, heartbeat snapshots, WebGL/context-loss metrics, an in-game diagnostics panel, and a live Playwright soak test plan.

**Lesson**:
- Random delayed white screens should be debugged with evidence captured before the crash, not by relying on post-crash DevTools access.


## 69. Qi-field ground placement and owner colors (2026-05-21)

**Problem set**:
1. 穹隆化生's generated 生太极 zone used the player's current Z at dash end, so ending in the air could place the field in the air instead of on the ground below.
2. That special 生太极 needed a much taller vertical reach than normal range-relative zones.
3. 碎星辰 and 破苍穹 were forced red in the frontend renderer, so the owner could see their own 气场 as enemy-colored.
4. Canonical 气场 `zoneHeight` values still said 10 even when the actual intended radius/height was 8 or 15.

**Fix / verification**:
- Snapped 穹隆化生's generated 生太极 zone Z to `getGroundHeightForMap` at dash end and set its height to 99 world units while keeping its radius 8.
- Removed the forced-red frontend override for 碎星辰/破苍穹 so normal owner-relative coloring applies: owner blue, enemy red.
- Updated canonical 气场 height data: 镇山河 8, and 冲阴阳、凌太虚、生太极、吞日月、碎星辰、破苍穹 15.
- Verified with TypeScript diagnostics, a canonical 气场 height audit script, and a static frontend color-branch check.

**Lessons**:
- Ground fields cast while airborne should store ground Z for placement, then use `height` for vertical reach; storing player-air Z changes both visuals and enter/exit checks.
- Avoid ability-specific color overrides for team-readable field visuals unless the owner/enemy relationship is still applied.


## 70. AoE vertical cylinder hit range (2026-05-21)

**Problem set**:
1. Several AoE target filters used horizontal-only range checks, so targets far above or below the caster/area could still be hit if their X/Y position was inside the radius.
2. Timed/channel AoEs used sphere-style distance in shared loop helpers, which did not match the requested cylinder rule of horizontal radius plus the same amount above/below.
3. Persistent ground zones had old independent height fallbacks such as 10 or 2, instead of deriving vertical half-height from each zone radius/range.
4. Mi Yun retargeting could choose candidates from a wider vertical space than the original AoE.

**Fix / verification**:
- Changed immediate AoE damage/buff helpers, loop timed/channel AoE helpers, Mi Yun area candidate/reroll helpers, and ground-zone creation/tick paths to use a cylinder: XY radius equals AoE range and vertical half-height equals the same range.
- Kept entity radius tolerance in both planar and vertical checks so summoned/entity targets still behave consistently at boundaries.
- Verified with backend checks for 魂压怒涛, 横扫六合, 大狮子吼, 五方行尽, shared Mi Yun/loop area selection, and persistent zone height/radius parity for 镇山河、极点迟御、振翅图南、天绝地灭、绿野蔓生、洗兵雨.

**Lessons**:
- AoE retarget pools must use the same 3D volume as the original effect, or confusion effects can create illegal hits.
- For gameplay AoEs, persistent zone `height` should be treated as vertical half-height and kept equal to `radius` unless an ability intentionally defines a different volume later.


## 71. Camera distance display remap and jump parity research (2026-05-21)

**Problem set**:
1. The camera view that visually matched the reference game was the real 20-unit camera distance, but the in-game reference labels that as 24.
2. The ESC camera setting needed to show and cap at `24.00` without changing the actual camera view angle/distance.
3. Repeated normal forward jumps felt slower than walking forward, even though normal walking speed itself is correct.

**Fix / finding**:
- Remapped camera setting display so `24.00` maps to the same real camera distance as the previous 20-unit view, leaving `CameraRig`'s real `CAM_DIST_BACK = 20` unchanged.
- Capped the camera setting at `24.00` and versioned the stored camera preference so the old 22/30 defaults migrate to the new reference scale.
- Researched jump math: normal directional jump was traveling a fixed 6 units over about 51 ticks, while walking for the same ticks travels about 8.5 units at 30Hz.

**Jump fix**:
- Keep walking speed, jump height, gravity, and airtime unchanged.
- For normal forward directional jumps only, replaced the fixed 6-unit horizontal budget with `jumpStartPlanarSpeed * estimatedAirborneTicks` on backend and mirrored it in frontend prediction.
- Verified the same formula at normal and double movement speed: 2x movement speed produces 2x jump-forward travel over the same airtime, matching 2x walking.
- Left special jump budgets (power jump, multi-jump, backpedal, Ling Ran special jump) separate unless they are intentionally recalibrated later.

**Lessons**:
- Camera setting labels can be remapped independently from physical camera distance when matching another game's UI scale.
- A fixed jump horizontal distance becomes slower than walking whenever airtime exceeds `distance / walkSpeed`; at 5 units/sec, 6 units only equals 36 ticks, not a full normal jump arc.
- Backend movement and BattleArena prediction must be changed together for jump horizontal parity, or the client will predict a different landing point from the server.


## 72. ESC camera settings for game matching (2026-05-21)

**Problem set**:
1. Camera tuning lived behind mouse-wheel zoom and a test-only overrange toggle, so there was no normal ESC game setting matching the reference camera panel.
2. The default camera distance was still based on the old `0.7` zoom multiplier, giving a much shorter starting camera than the requested 22-unit reference.
3. Follow-mode options are not implemented in the battle camera, but the UI needed to show the same three camera-type slots with only `从不追随` selectable.

**Fix**:
- Added ESC → 游戏设置 → 综合 → 镜头设置 with locked camera type options and a `镜头最大距离` range control.
- Persisted camera settings in localStorage with default distance `22.00`, max `30.00`, and live camera update when the slider changes.
- Removed the old test-only overrange camera toggle so max camera distance has one visible source of truth.
- Confirmed the deployed live chunk contains the new settings UI and values; full ESC visual verification needs an active authenticated battle canvas.

**Lessons**:
- Settings that tune live camera feel should update both the persistent preference and the ref read by the render loop immediately.
- If follow modes are not implemented, disabled placeholders are safer than exposing inactive choices.
- A deployed static chunk marker check can confirm live bundle rollout when a full authenticated match cannot be opened from the current browser session.


## 73. Horizontal-only exported map footprint scale (2026-05-21)

**Problem set**:
1. Building footprint measurements in collision-test mode were too small horizontally: examples were about 18.4 vs expected 20.9 and 22.8 vs expected 25.4.
2. Vertical height already matched, so increasing the uniform exported-map scale would have broken height calibration.
3. Frontend prediction, backend authoritative BVH collision, LOS, camera collision, map bounds, spawns, and fallback AABBs all depended on the old uniform scale.

**Fix**:
- Added a `1.125` horizontal footprint multiplier and split exported-map scale into X/Z and Y components.
- Kept Y/height conversion unchanged while scaling X/Z render transforms, group X/Z offsets, collision radius, LOS, camera conversion, frontend prediction, backend movement collision, map bounds, spawns, and fallback object footprints.
- Verified backend and frontend builds, restarted only PM2 `frontend` and `backend`, and confirmed the live in-game bundle contains the new horizontal scale marker. Full live battle canvas verification was blocked because the created room waited for a second player.

**Lessons**:
- When height is correct but footprint is short, split horizontal and vertical calibration instead of changing the global map scale.
- Scaling exported map X/Z from the same origin as map bounds keeps visual world coordinates, server collision, spawns, and ruler distances aligned.
- Every exported-map conversion must be mirrored across backend and frontend; updating only the visual mesh would make range tools look different from collision and prediction.


## 74. BattleArena camera centering at upward pitch (2026-05-21)

**Problem set**:
1. In collision-test mode, dragging the camera upward made the local character drift lower on screen.
2. The camera boom followed the avatar, but the render camera still looked at a forward/up offset target, so pitch changes changed the character's screen position.
3. After removing the old look-ahead offset, aiming at the upper pivot centered the HP/cap anchor but left the body reading slightly low/high depending on pitch.

**Fix**:
- Kept the existing camera collision boom pivot unchanged for wall, probe, and ground clamping.
- Changed the render `lookAt` target to a fixed avatar body-center height so the model itself remains centered as pitch changes.
- Updated the movement recenter visibility check to use the same visual-center target.

**Lessons**:
- Camera collision pivots and visual framing targets should be separate; collision can orbit around a stable upper pivot while `lookAt` frames the body center.
- Playwright canvas screenshots plus pixel checks are useful for confirming visual drift, while live React refs help prove pitch changed during the test.


## 75. Exported map cache and warmup optimization (2026-05-21)

**Problem set**:
1. The load panel showed very slow exported-map resources, including small PNG/JSON files taking many seconds.
2. `/full-exports/<package>/<file>` resolved packages by scanning export roots for every asset request, multiplying filesystem work across hundreds of map files.
3. Exported-map assets were served without long-lived immutable cache headers, so repeat loads could still revalidate or redownload stable package files.
4. The waiting room did not preload the in-game route or warm the browser cache for the official collision-test map before BattleArena mounted.
5. After the optimization, the load report was useful enough to keep, but the `I` hotkey exposed it too prominently for normal play.

**Fix**:
- Added a short-lived backend full-export index cache and startup warmup so package lookup is reused across asset requests.
- Added immutable cache headers and resource timing headers for exported-map package assets while keeping export list responses revalidatable.
- Added a frontend exported-map warmup helper that fetches manifests, GLBs, textures, terrain files, and collision sidecars with bounded concurrency into the browser HTTP cache.
- Started route prefetch and map warmup from the room page, and also triggers warmup from the in-game client once `collision-test` mode is known.
- User reported total scene load improved to about 9 seconds after cache/warmup changes.
- Removed the `I` hotkey toggle and moved the scene-load report behind ESC → 测试 → 开关 → 场景加载报告.

**Lessons**:
- Tiny map files taking many seconds can indicate server-side request overhead or queueing, not only bandwidth or asset size.
- Package-named exports are good candidates for immutable browser caching; list/discovery endpoints should stay revalidatable.
- Preloading should begin in the waiting room when possible, because warming the cache after the Three scene mounts competes with the real scene loader.
- Keep deep diagnostics inside the testing panel once the issue is understood; normal hotkeys should stay reserved for gameplay/debug flows players deliberately need.

**Future enhancement options, if load speed becomes a problem again**:
- Add a service worker or Cache Storage prewarmer for exported-map assets so room warmup can persist and report progress more explicitly.
- Generate an asset dependency manifest at export/build time so warmup does not need to derive GLB, texture, terrain, and sidecar URLs in the browser.
- Precompute a collision world-triangle cache for the exact exported map to skip JSON parse/triangle transform work while keeping gameplay geometry unchanged.
- Add nginx/CDN static serving for `/full-exports` with HTTP/2 or HTTP/3 tuning, Brotli for JSON, and OS file-cache warmup after deployment.
- Use route-level code splitting to keep non-battle editor/test code out of the first in-game JS path.
- If quality-preserving asset work is later allowed, test lossless PNG optimization before considering format changes.


## 76. Scene loading timeline report and loader parallelism (2026-05-21)

**Problem set**:
1. The `I` panel mixed scene loading with element counts, so it did not clearly show total scene load time or per-stage durations.
2. The first implementation showed page runtime as a loading duration, making old sessions look like very slow scene loads.
3. The exported map loader fetched unique GLBs, terrain heightmaps, and collision sidecars mostly in serial, which made scene loading vulnerable to long request chains.
4. Live Playwright report capture was blocked because the browser redirected to `/login` and `ZHENCHUAN_TEST_PASSWORD` was not set in the runtime environment.

**Fix**:
- Changed the `I` panel to focus on `场景加载`: total scene time, stage durations, browser resource timing groups, slowest resources, and a `复制报告` button.
- Added exported-map timing events for manifest, entity GLB/texture, terrain, collision sidecar, BVH, and total map stages.
- Exposed the full report on `window.__zhenchuanLoadReport` for Playwright retrieval after authentication.
- Parallelized GLB, terrain, and collision sidecar loading with bounded concurrency.

**Lessons**:
- Loading diagnostics should measure stage start/end times, not how long the page has been open.
- Browser `PerformanceResourceTiming` is useful for reportable scene-load evidence because it identifies slow resource groups without adding custom network instrumentation.
- Live Playwright checks that require authentication need runtime credentials or an already-authenticated shared browser page; do not route passwords through chat or logs.


## 77. Live ESC sound settings deployment verification (2026-05-21)

**Problem set**:
1. The local source enabled the ESC `声音设置` tile and moved ability sound controls into a dedicated page, but the live site still showed the tile disabled.
2. Localhost/browser checks were insufficient because the user was seeing the deployed `https://zhenchuan.renstoolbox.com` build.
3. The default terminal channel returned stale PM2-path text for unrelated commands, hiding whether builds and restarts actually ran.

**Fix**:
- Verified the authenticated live game with Playwright and confirmed the deployed `声音设置` button still had the `disabled` attribute.
- Updated project instructions so all Zhenchuan Playwright/browser verification defaults to the live site and the `catcake` account while keeping credentials runtime-only.
- Recovered command execution by starting a fresh async terminal and using that terminal ID for build/restart commands.

**Lessons**:
- For UI complaints seen on the production host, verify `https://zhenchuan.renstoolbox.com` first; a correct source tree does not prove PM2 is serving the newest build.
- Never write plaintext credentials into repo instructions or logs; use runtime input, local environment variables, or an already-authenticated browser session.
- If a persistent terminal returns stale output for every command, open a fresh async terminal and continue from the returned terminal ID.


## 78. PM2 restart scope for Zhenchuan checks (2026-05-20)

**Problem set**:
1. Running `pm2 restart all` during Zhenchuan verification also touched unrelated `rencipe-*` PM2 processes.
2. The unrelated `rencipe-frontend` process produced port `4000` noise/crash-loop signals, distracting from the actual Zhenchuan frontend/backend verification.

**Fix**:
- Updated project instructions so Zhenchuan checks restart only PM2 apps `frontend` and `backend`.
- Recorded that `rencipe-*` processes and ports should be left alone unless the user explicitly scopes the task to them.

**Lessons**:
- PM2 verification should be app-scoped in shared hosts; `pm2 restart all` can destabilize unrelated services and produce misleading startup errors.


## 79. Sound review simplified identity and count filters (2026-05-20)

**Problem set**:
1. The sound review board was visually noisy because each ability header showed type/target/rarity/school tags and a description snippet.
2. The per-ability sound count appeared as a separate `1 个` badge instead of being attached to the ability name.
3. Search was hidden inside collapsed filters, and there was no way to filter abilities by sound count, especially `0` sounds.

**Fix**:
- Simplified sound review ability headers to icon plus `技能名（音效数量）`, removing visible tags and descriptions.
- Moved the old separate count badge into the title, so entries render like `回风扫叶（1）`.
- Added a top-level skill-name search and a custom `音效数量` segmented filter for `全部 / 0 / 1 / >1`.
- Built sound groups from the full ability snapshot before merging manifest sounds, allowing the `0` filter to show abilities with no sound files.

**Lessons**:
- A `0` sound-count filter needs the complete ability catalog, not just the sound manifest, because absent manifest rows are the data being searched for.
- For review-board density, ability identity should stay compact while per-sound decisions carry the actionable controls.


## 80. Sound review live crash and Playwright guard (2026-05-20)

**Problem set**:
1. The deployed sound review tab on `https://zhenchuan.renstoolbox.com/ability-editor?tab=soundReview` was crashing instead of rendering the grouped review board.
2. Local source checks were not enough; the regression only became obvious when the deployed bundle was opened and exercised through login.
3. The repo needed a repeatable live Playwright workflow for protected sound review verification.

**Fix**:
- Reproduced the issue on the live site after login and traced it to `SoundReviewTab.tsx`, where `SectionHeader` referenced an undefined `active` variable.
- Removed that bad runtime reference and kept active button coloring inside `IconButton`, where the prop actually exists.
- Promoted `音效审核` to its own top-level ability editor tab, hid the large editor overview on this tab, and collapsed filters behind a summary so the three decision columns and actions appear in the first viewport.
- Added `frontend/tests/sound-review.live.spec.ts` and `frontend/tests/SOUND_REVIEW_LIVE_TESTING.md`, then linked that workflow from `.github/copilot-instructions.md`.

**Lessons**:
- A client-only runtime typo can survive type checks and still kill a deployed page, so protected editor flows need real browser coverage on the deployed host.
- For live auth verification, store the workflow in-repo but pass credentials through environment variables instead of baking passwords into files.


## 81. Sound browser grouped review UI (2026-05-20)

**Problem set**:
1. The sound browser listed individual sound files with filenames, making multi-sound abilities hard to review as one skill.
2. Review needed ability-editor-style filtering by rarity and class/school, plus ability icons.
3. Sound audition needed a simple way to mark each sound as good or not good.

**Fix**:
- Reworked `/sound-browser` into ability cards grouped by ability name, with each ability's sounds nested as playable rows.
- Enriched the page with the ability editor snapshot so sound groups can show ability icons, type/target tags, rarity, and school filters.
- Removed visible sound filenames and added local `localStorage` review state for pass/reject/clear controls per sound.

**Lessons**:
- Sound review UI should key visible organization by ability identity, while keeping manifest file keys only as hidden stable storage/playback identifiers.
- Reusing ability-editor tag metadata avoids drifting rarity/school labels between review tools.


## 82. In-game warning overlay and controls (2026-05-09)

**Problem set**:
1. Gameplay failure messages still depended on app-level toasts, which are detached from the actual combat HUD.
2. The new warning needed to be plain red text with a black outline, plus its own ESC-panel scale control and custom-UI drag anchor.

**Fix**:
- Added a BattleArena-owned in-game warning overlay with a short-lived red outlined text treatment, its own saved HUD position, and a preview anchor in custom-UI mode.
- Added an ESC panel slider for warning scale from `1.00` to `2.00`, persisted in local storage.
- Routed central gameplay error-code messages from `InGameClient.tsx` into the overlay and switched the local combat validation warnings in `BattleArena.tsx` off app toasts and onto the new HUD warning path.
- Reduced the baseline warning text size by 30%, so slider value `1.00` now starts from a smaller default footprint.
- Reduced the baseline warning text by another 30% and widened the slider range to `0.10` through `2.00`.

**Lessons**:
- If a warning is combat-local, keep both the renderer and the drag anchor in the combat HUD owner; only the text source needs to cross the client boundary.
- A combat-only widget still needs a preview in custom-UI mode, otherwise users cannot place it until the exact failure state happens live.
- When a HUD scale slider starts too large, lowering the base size is safer than widening the slider range downward; saved user scale values keep the same meaning.
- If the user still wants finer control after shrinking the base, widening the lower clamp is the direct fix; it should be done in both the slider min and the normalization helper so saved values and live drag stay consistent.


## 83. Charge stack box border removal (2026-05-09)

**Problem set**:
1. The charged-ability count box still showed a visible white border around its black background.
2. The requested visual was to keep the black background but remove that border entirely.

**Fix**:
- Changed `.chargeStackBox` in `BattleArena.module.css` from a white bordered box to `border: none`.

**Lessons**:
- Small overlay counters on already framed hotbar buttons do not need a second bright outline; it creates visual noise faster than it adds readability.
- If a variant class already has the right treatment (`.chargeStackBoxQueTaZhi`), align the base class to the same border policy instead of layering another special-case style.


## 84. Consumable count badge simplified (2026-05-09)

**Problem set**:
1. The consumable count badge looked like a full chip instead of just a small number in the corner.
2. The requested style was a plain bottom-right number with thinner text and no background panel.

**Fix**:
- Simplified `.consumableCount` in `BattleArena.module.css` to sit as plain text in the bottom-right corner.
- Reduced the weight to `600` and removed the pill-like background treatment so the count reads as a lightweight corner number.

**Lessons**:
- Small stock counters read better as unobtrusive corner text than as full badges when the slot already has strong icon framing.
- If a HUD marker should feel secondary, remove both the background block and the heavier font weight together; changing only one still leaves it visually noisy.


## 85. Consumable stock counts and control-panel refill (2026-05-09)

**Problem set**:
1. Consumables needed finite stock counts instead of infinite reuse.
2. New battles should start both players with `8` 金疮药, `12` 绷带, `4` 月影沙, and `4` 砂石伪装.
3. The HUD needed to show remaining consumable stock, and the control panel needed a button to refill it for testing.

**Fix**:
- Added `consumableCounts` to player runtime state and initialized new battle players with the requested starting stock.
- Updated `consumableService.ts` to sanitize counts, reject use with `ERR_CONSUMABLE_EMPTY`, and decrement stock on successful consumable use attempts.
- Added item-bar count badges plus depleted-slot disabling in `BattleArena.tsx`, and wired a new control-panel cheat action to `/api/game/cheat/refill-consumables` to reset both players' consumable stock.

**Lessons**:
- Finite consumable systems need both a backend source of truth and a visible HUD count; doing only one side makes the state either abusable or unreadable.
- Refill/test helpers belong with the existing cheat/control routes so the UI can reuse the same fetch-and-toast path instead of inventing another debug channel.


## 86. Consumable bar greys out unopened items (2026-05-09)

**Problem set**:
1. Only the first four consumables are implemented, but the item bar rendered the remaining consumables as if they were equally usable.
2. That made the HUD misleading and encouraged clicks into `ERR_CONSUMABLE_NOT_IMPLEMENTED` for items that are not open yet.

**Fix**:
- Added explicit `implemented` flags to the frontend consumable bar list in `BattleArena.tsx`.
- Greyed out unimplemented consumables with a dedicated unavailable style and updated their tooltip title to include `暂未开放`.
- Blocked local click handling for those unimplemented slots so the bar reflects the current live consumable set more honestly.

**Lessons**:
- If the backend has placeholder item ids that are intentionally not open yet, the HUD should surface that state directly instead of waiting for an error response.
- Static HUD catalog entries need explicit availability metadata when the live item roster is only partially implemented.


## 87. 浮光掠影 遁影 only protects movement (2026-05-09)

**Problem set**:
1. `浮光掠影` was still keeping stealth when the player used the 6 common movement abilities during the first 5 seconds of `遁影`.
2. The intended rule is narrower: `遁影` only allows ordinary movement without breaking stealth; using those common abilities should still break `浮光掠影` stealth.
3. `暗尘弥散` and other stealth buffs needed to keep their existing common-ability exceptions.

**Fix**:
- Removed the special first-5-seconds common-ability grace rule from `breakOnPlay.ts` for buff `1012` (`浮光掠影`).
- Kept the existing forward-channel exception for `浮光掠影`, so only the common-ability stealth retention changed.
- Left `暗尘弥散`, `天地无极`, `月影沙`, and the rest of the stealth-break rules untouched.

**Lessons**:
- If a stealth sub-buff like `遁影` is only meant to protect movement, encode that at the central stealth-break owner instead of folding common-ability exceptions into it.
- When multiple stealth buffs have similar exception logic, isolate the change to the exact buff id to avoid accidental rules drift across other stealth families.


## 88. 月影沙 blocked by 伪装 root state (2026-05-09)

**Problem set**:
1. `月影沙` was still castable while the player was under `伪装`, even though `伪装` applies a real `ROOT` effect and should count as control for consumable blocking.
2. The failure toast for blocked consumables still said `受控状态无法使用`, which did not match the requested rule wording.

**Fix**:
- Removed the `DEBUFF`-only filter from the consumable control gate in `consumableService.ts`, so any active buff carrying `ROOT`, `CONTROL`, `KNOCKED_BACK`, `PULLED`, `DISPLACEMENT`, `FEARED`, or `FREEZE` now blocks consumable use, including `伪装`.
- Updated the frontend error mapping for `ERR_CONSUMABLE_CONTROLLED` to show `无法在受控下施展`.

**Lessons**:
- Consumable control validation must key off control effects, not buff category, because runtime states like `伪装` can deliberately carry control on a `BUFF` entry.
- If the rule language is user-facing and specific, keep the toast text aligned with the gameplay rule instead of leaving a generic fallback message.


## 89. 伪装 facing preservation and GLB rotation sync (2026-05-09)

**Problem set**:
1. While `伪装`, the local player should still preserve their current facing direction instead of visually losing it.
2. Selecting yourself while disguised should still show the facing arc.
3. The disguise GLB needed to rotate from the live facing path, not just the initial render-time yaw.

**Fix**:
- Kept the facing arc visible for selected disguised characters in `Character.tsx`, which covers self-selection while disguised.
- Added a dedicated disguise model ref and updated its rotation inside the same per-frame facing block that already drives the normal character body.
- Passed that live ref into `DisguiseCartModel`, so both the fallback mesh and the loaded GLB stay aligned with current facing instead of freezing at the initial yaw.

**Lessons**:
- If a disguised mesh replaces the main body, it still needs to share the same live facing update path; a render-time prop alone is not enough for local continuously updated facing.
- Self-selection affordances like facing arcs should key off selection state, not whether the body is currently replaced by a disguise model.


## 90. 月影沙 grounded/control correction and disguise-stealth overlap correction (2026-05-09)

**Problem set**:
1. `月影沙` was still usable while `ROOT` was active because the consumable control gate did not treat root as blocking control.
2. `月影沙` was not manually cancelable from the status bar.
3. `月影沙` only needed to be blocked while airborne, but the first pass incorrectly blocked ground movement too.
4. The earlier disguise-versus-stealth mutual-exclusion rule was wrong. The actual rule is: if a player already has `伪装` and then gains stealth, keep the stealth, shorten `伪装` to a 1-second overlap, and do not let disguise visuals override enemy stealth visibility during that overlap.

**Fix**:
- Added `ROOT` to the consumable control-block list so `月影沙` respects the "all control except slow" rule even when the control source is `伪装`.
- Marked `月影沙(980002)` as runtime manual-cancelable and exposed that flag through preload metadata so the existing right-click cancel flow works without a new UI path.
- Relaxed the `月影沙` cast-position gate from standing to grounded-only, so moving on the ground is allowed while airborne use is still blocked.
- Replaced the bad mutual-exclusion rule with a shared overlap rule in `buffRuntime.ts`: incoming non-disguise stealth now shortens active `伪装` buffs to a 1-second overlap instead of deleting stealth.
- Updated natural disguise expiry in `GameLoop.ts` to clear enemy target selections, so delayed disguise expiry behaves like normal disguise removal.
- Updated enemy visibility helpers in `ArenaScene.tsx` and `BattleArena.tsx` so stealth hides disguised opponents too; enemies no longer keep seeing the `伪装` cart GLB while the player is actually stealthed.

**Lessons**:
- Manual cancel needs both backend permission and preload metadata. Updating only one side makes the buff either uncancelable or invisible to the UI affordance.
- For consumables with "not in air" requirements, use grounded validation only; reusing standing semantics will incorrectly block ordinary ground movement.
- When concealment states overlap, enemy visibility should follow the stronger hidden state. A disguise visual must not override an actual stealth hide.
- If a fix relies on natural buff expiry instead of explicit removal, audit the natural-expiry path for side effects like target-selection cleanup.


## 91. Disguise duration cap, status hover time formatting, and 月影沙 consumable (2026-05-09)

**Problem set**:
1. All `伪装` states needed a hard maximum duration of 4 minutes instead of relying on per-source durations.
2. The status-bar hover hint needed remaining time in `分 / 秒` instead of raw seconds.
3. `月影沙` needed to become a real consumable: 30s cooldown, usable in combat, blocked by hard control except slow, grants a 7s stealth/speed/no-jump buff, breaks on normal casts, and breaks instantly when hit.

**Fix**:
- Clamped disguise duration in the shared disguise definition and again in the centralized `addBuff()` runtime path so every disguise source obeys the same 4-minute ceiling.
- Replaced the status-bar hover raw-seconds text with a shared `分 / 秒` formatter so long buff durations stay readable.
- Implemented `月影沙` as a shared runtime buff definition with `STEALTH`, `SPEED_BOOST(30%)`, and `NO_JUMP`, wired the consumable to apply it via `addBuff()`, and exposed the buff through preload metadata.
- Added centralized cast-break handling in `breakOnPlay.ts` and centralized incoming-hit handling in `onDamageHooks.ts`; the hit path now treats shield-absorbed damage as a real hit so `月影沙` still breaks even when HP damage is 0.

**Lessons**:
- For a rule that applies to a whole buff family, clamp it centrally instead of trusting each source definition to stay aligned.
- `NO_JUMP` already exists end-to-end in this codebase, so jump suppression should reuse that effect rather than inventing another movement lock.
- If a stealth-like effect should break "on hit", wire the shared damage hook with both `hpDamage` and `shieldAbsorbed`; a post-HP-only hook will silently miss shield-only hits.
- When a stealth buff should survive positive channel flow, keep it out of the forward-channel completion strip list and only control the start-of-cast break behavior in `breakOnPlay.ts`.


## 92. iPad in-game load failure from missing ResizeObserver support (2026-05-09)

**Problem set**:
1. After the desktop RMB-drag fix, the game could still fail to load on iPad and collapse into a generic client-side application error before the in-game scene appeared.
2. The failure was device-specific, so desktop checks alone did not reveal the root cause.
3. BattleArena and `@react-three/fiber` both depend on `ResizeObserver` during scene boot, and older Safari/iPad builds may not provide it.

**Fix**:
- Confirmed the failure mode by forcing `window.ResizeObserver = undefined` in a live browser session; the page crashed with `This browser does not support ResizeObserver out of the box` from `react-use-measure`.
- Added a lightweight `ResizeObserver` fallback that reports initial element bounds and refreshes on `window`/`visualViewport` resize.
- Installed that fallback from `InGameClient` before `BattleArena` and the R3F canvas mount, so older iPad/Safari builds get a compatible observer before in-game rendering starts.

**Lessons**:
- If iPad shows a generic Next.js client error while loading the battle screen, verify browser API support before chasing gameplay/runtime logic.
- For client-only compatibility shims used by scene libraries, install the shim before the arena tree mounts; patching only inside a deeper child can be too late for library startup.


## 93. Combat icon darkening and right-drag camera smoothing (2026-05-09)

**Problem set**:
1. The icon-bar `战斗中` marker was visually too bright and needed a darker red.
2. PC right-click camera drag became visibly laggy after the recent camera anti-clip work.
3. Live in-game verification for this project needs to run against the HTTPS deployment, not localhost, so WebSocket/runtime behavior matches production.

**Fix**:
- Darkened the BattleArena combat marker from `#ff2424` to `#b11b1b` and updated the HUD source/browser style guards.
- Trimmed CameraRig collision sampling during active look input: keep the full wall/probe sample set when the camera is settled, but use a smaller support/probe subset for a short recent-look window so RMB drag does not spend as many BVH raycasts per frame.
- Stopped `ExportedMapScene` from raycasting the full exported GLB on mouse-drag pointer moves; hover hit-testing is unnecessary while the user is actively dragging the camera.
- Rate-limited the RMB visual facing sync in `BattleArena` to one `requestAnimationFrame` callback per frame instead of recomputing facing on every raw `mousemove`; the existing 30 Hz movement tick still keeps RMB camera-plus-facing behavior authoritative.
- Rebuilt backend/frontend, restarted PM2, and live-checked `https://zhenchuan.renstoolbox.com/` with the `catcake` account in Playwright; the in-battle HUD stayed at 60 FPS both idle and during scripted RMB drag.

**Lessons**:
- The recent camera anti-clip path is expensive because each frame can issue many BVH probe raycasts; when the symptom is RMB drag stutter, inspect CameraRig sampling before blaming generic React rerenders.
- In collision-test mode, exported-map canvas hover picking should not keep raycasting the full GLB while any mouse button is held for camera drag.
- If RMB mouse-look already has a lower-frequency authoritative movement/facing tick, avoid duplicating the same facing solve on every raw mouse event; cap visual sync to animation frames instead.
- For live gameplay verification in this repo, prefer the HTTPS deployment and the approved `catcake` test account so the browser test exercises the real WebSocket/runtime path.


## 94. Consumable bar settings, disguise texture, and root-facing fixes (2026-05-09)

**Problem set**:
1. Consumables needed a configurable saved shortcut bar with 12-16 total slots, no default 4/5/6 hotkeys, real icon paths, and drag reorder between consumable slots.
2. The 伪装 cart GLB rendered white because the standalone character loader did not apply the exported map `texture-map.json` PBR textures.
3. Enemy abilities with no damage or debuff still needed to enter `战斗中` when they affected another player.
4. Root should freeze facing direction on both backend movement and frontend prediction, and control-panel cooldown reset needed to include consumables.
5. 砂石伪装 channeling should allow movement input but break when the player moves, and the resulting 伪装 buff should be right-click cancelable.

**Fix**:
- Replaced the three fixed consumable buttons with the ordered twelve-item catalog, image icons resolved through `/icons/{name}.png`, saved slot count/order/enabled settings, and native drag/drop reorder across visible consumable slots.
- Kept ability drag hit testing blocked from consumable slots while allowing consumable-specific drop handling; removed rendered hotkey labels and 4/5/6 key bindings.
- Added the ESC `快捷键设置` page with a left `物品快捷栏` tab, `关闭` toggle, and `格子数量` range from 12 to 16.
- Removed the old always-rendered placeholder item-slot strip from the same HUD row so the default live bar shows exactly the twelve consumables and no extra boxes.
- Loaded the cart GLB with exported texture-map albedo/MRE/normal material assignment matching `ExportedMapScene`.
- Added normal `PLAY_ABILITY` events and combat-status handling for enemy ability contact, reset `consumableCooldowns` in the testing cooldown reset, and made root block client/server facing changes.
- Changed 砂石伪装 to `lockMovement: false` + `cancelOnMove: true`, and marked runtime 伪装 metadata/backend cancelability as manual-cancelable.

**Lessons**:
- If a standalone GLB is reused outside `ExportedMapScene`, it still needs the export package texture-map material pass; the raw GLB may not carry the visual textures.
- For rooted facing rules, patch both the outgoing input payload and local camera-look prediction, otherwise the server can be correct while the client appears to turn.
- A configurable shortcut bar should persist slot order separately from visible slot count so hiding or shrinking the bar does not erase the user's arrangement.
- Consumable drag/drop should treat the bar as fixed slots, not list insertion; dropping into an empty visible slot must move the item to that exact index and leave the source empty.
- If the consumable row is the user-facing item bar, do not leave a second placeholder slot strip rendered after it; default visual count should match the actual default consumable slot count.


## 95. 砂石伪装 consumable and disguise targeting (2026-05-09)

**Problem set**:
1. A new consumable needed a 2-second positive channel, a second combat check on completion, and a disguise state that self-roots without triggering control diminishing returns.
2. Disguised players needed to be visible as a normal exported-map object but not directly targetable or selectable, while still hittable by AOE.
3. Consumable slots needed to visually match ability-slot borders, and ability dragging needed to ignore consumable slots.

**Fix**:
- Added `砂石伪装` as `sha_shi_wei_zhuang`, a no-cooldown non-combat consumable with a locked 2-second forward channel; completion rechecks `inCombat` and recent enemy damage/debuff events before applying `伪装`.
- Implemented `伪装` as a self-applied BUFF with `STEALTH`, `ROOT`, and `DISGUISE`, using `STEALTH` for direct-target blocking instead of `UNTARGETABLE` so AOE enumeration can still hit the player.
- Combat-status entry now removes disguise immediately and clears enemy target selections aimed at the disguised player; backend target-selection also refuses stealth/disguise-blocked player targets.
- Frontend renders disguised players as the exported-map `wj_木车002_hd.glb`, keeps them visible through the stealth filter, hides their health/name billboard, and prevents click/tab selection.
- Consumable buttons now use ability-slot border styling and expose `data-consumable-slot` so ability drag hit testing explicitly ignores them.

**Lessons**:
- For “not selectable but still AOE-hittable,” prefer `STEALTH` plus UI/selection guards over `UNTARGETABLE`; `UNTARGETABLE` would block more enemy effect paths than intended.
- Self-root is safe for disguise immobilization because control diminishing returns only apply when `addBuff()` sees `sourceUserId !== targetUserId`.
- Reuse the exported map renderer's full-export path for disguise meshes instead of creating duplicate assets.


## 96. LayoutShell home background and F11 fullscreen correction (2026-05-08)

**Problem set**:
1. A game fullscreen fix put `background: #010409` on the shared `LayoutShell` `.container`, turning normal pages such as the home/game room page black behind their controls.
2. The in-game no-topbar shell still used an explicit `height: 100dvh`; browser fullscreen/F11 can make that dynamic viewport unit shorter than the visible viewport, exposing the white body at the bottom.
3. The focused Playwright suite only checked source strings for the fullscreen shell and did not verify normal-page background or bottom-pixel fullscreen coverage.

**Fix**:
- Removed the dark background from the shared `LayoutShell` container so normal pages inherit their white page background again.
- Kept the dark background only on the in-game fullscreen shell and changed it to fixed `inset: 0` with `height: auto`, so top/bottom constraints fill the viewport instead of trusting `100dvh`.
- Added Playwright coverage that renders a normal shell over a white body, then renders the in-game shell over a white body and verifies the bottom of the viewport is covered by the game shell/surface.

**Lessons**:
- Never put game-only dark surfaces on a shared app shell; scope them to the in-game route class.
- For browser fullscreen shells, fixed `inset: 0` with auto height is safer than explicit `100dvh` when the user's symptom is a bottom gap.
- A source guard is not enough for layout regressions; include a browser-computed viewport coverage check.


## 97. BattleArena 战斗中 status and fullscreen HUD fixes (2026-05-08)

**Problem set**:
1. The game needed a non-buff `战斗中` status that enters on player-vs-player damage or in-range debuff hits and exits in symmetric pairs after a 3-second check.
2. Out-of-range DOT damage should still show `进入战斗`, but should not refresh the stay-in-combat timer unless the linked players are within 60 units.
3. The HUD needed `进入战斗` / `离开战斗` toasts plus a crossed-swords red marker on self, target, and target-target icon bars without using the buff/status bar.
4. The ESC footer still had an obsolete disabled login action, target range text was slightly too large, and F11 fullscreen could reveal a white strip below the game.

**Fix**:
- Added backend `inCombat` and symmetric `combatLinks` state plus a `COMBAT_STATUS` event, initialized on new battles.
- Centralized combat entry/exit in `combatStatus.ts`: damage events enter immediately, debuff-hit events require 60-unit range, and stale/out-of-range/dead links expire together every 3 seconds.
- Fed the combat-status helper from both immediate ability casts and the realtime game loop so direct casts, loop damage, DOTs, and debuff events share the same rules.
- Added frontend type support, toast handling, and a red crossed-swords marker to the icon bars, while keeping `战斗中` out of buff lists.
- Removed the obsolete ESC login button, reduced target distance text by 10%, and made the fullscreen no-topbar shell fixed/inset so the game covers the entire F11 viewport.

**Lessons**:
- A pair status is easier to keep symmetric when stored as links on each player and reconciled from events, rather than trying to patch every damage call site manually.
- DOT damage and stay-in-combat refresh are different rules: out-of-range damage can notify entry without extending the 3-second in-range activity window.
- Fullscreen game shells should cover the viewport with fixed inset sizing; otherwise body/page background can show through during browser fullscreen size changes.


## 98. BattleArena ESC scaling, Catcake defaults, and WebGL recovery (2026-05-08)

**Problem set**:
1. The compact ESC shell needed to grow by 15% while keeping the existing page structure.
2. The game-settings `恢复默认` footer button felt out of place, but custom UI still needed a default-layout restore action.
3. The `体积碰撞开关` indirection hid the useful collision controls behind a second floating panel.
4. The top-left home button was too small for the current HUD scale.
5. 玉门关 could repeatedly hit WebGL context loss on iPad/other constrained devices, showing recovery text and sometimes disconnecting/crashing.
6. Catcake's saved custom UI layout needed to become the responsive default layout.

**Fix**:
- Increased the ESC shell to `688px` by `437px` and updated the responsive height cap.
- Removed the game-settings footer reset button, then added `恢复默认` to the custom-UI prompt where it applies Catcake's saved `1920 x 945` HUD positions through the existing viewport scaling helper.
- Removed the `showCollisionControlPanel` floating panel path and put direct `显示碰撞线` / `显示蓝图` checkboxes in the ESC `开关` test page.
- Increased the home button and icon from `34px`/`18px` to `51px`/`27px`.
- Changed WebGL recovery to wait for `webglcontextrestored` before remounting the canvas, capped mobile DPR, disabled mobile antialias, disabled mobile shadows by default, reduced exported-map shadow maps to `1024`, and made exported collision wireframes lazy so hidden debug geometry is not allocated during normal loading.

**Lessons**:
- WebGL context-loss recovery should reduce pressure and wait for restoration; immediately remounting the same heavy scene can create a visible recovery loop.
- Hidden collision debug lines still cost memory if their geometry is built up front. Keep the CPU collision data for gameplay, but allocate GPU wireframes only when a debug view is active.
- Responsive HUD defaults should store the authored viewport with the coordinates and scale at load/apply time rather than hardcoding screen-specific pixels.


## 99. BattleArena compact ESC test/settings rework (2026-05-08)

**Problem set**:
1. The ESC panel needed to be reduced to half its previous footprint.
2. The centered custom-UI confirmation panel needed to be draggable without becoming a green custom-UI guide.
3. ESC footer actions needed `返回角色` removed and `退出游戏` wired to the same leave-game flow as the top-left home button.
4. The `测试` tab needed left-list pages for `开关` and `灯光控制`, with renamed switches and direct `屏幕坐标` behavior.
5. Lighting controls needed to move inside the ESC test page instead of rendering a separate floating panel.
6. Normal ESC placeholders needed to read as disabled gray, and game settings placeholders needed to be removed.

**Fix**:
- Shrunk the ESC shell to `598px` by `380px` with matching compact header, tabs, tiles, footer buttons, sidebars, toggles, and ranges.
- Added a dedicated non-persistent drag handler for the center `自定义界面` prompt; it uses neutral panel styling and never receives the green edit-guide class.
- Passed `leaveGameAndReturnHome` from `InGameClient` into `BattleArena` as `onLeaveGame`, removed `返回角色`, and made `退出游戏` call that handler.
- Replaced the flat test grid with a left-list layout: `开关` contains renamed test switches and `灯光控制` contains the moved light toggles, brightness slider, color picker, and presets.
- Made `屏幕坐标` toggle the screen coordinate overlay directly and removed the old secondary screen-coordinate panel state.
- Removed game settings placeholder sidebar/action entries and strengthened disabled normal-tile gray styling.

**Lessons**:
- When a control panel is moved inside ESC, separate the panel's visibility from the underlying debug state so live scene props continue to work without rendering duplicate floating UI.
- Draggable utility prompts should use a local, non-persisted position rather than joining the saved HUD placement map unless the user explicitly wants that prompt saved as part of custom UI.


## 100. BattleArena ESC settings menu rework and top bar resize (2026-05-08)

**Problem set**:
1. The compact top metrics bar needed to grow by 30% along with its text.
2. The ESC panel needed a first-page system-settings layout similar to the provided screenshots.
3. Only `游戏设置` and `自定义界面` should be functional in the first-page placeholder grid.
4. `游戏设置` needed a second page with a back button and working `技能栏大小` / `显示GCD` controls.
5. The remaining debug/testing controls needed to move out of the normal settings view into a `测试` tab.

**Fix**:
- Increased the top metrics strip from `14.5px` to `18.85px`, with matching text and spacing growth.
- Replaced the old ESC control list with a large solid `系统设置` panel containing `常规` and `测试` tabs.
- Added placeholder setting tiles for the normal tab and wired `游戏设置` to a second page plus `自定义界面` to close ESC and enter custom UI mode.
- Moved `技能栏大小` and the full GCD visibility group into the `游戏设置` second page.
- Moved the remaining collision/debug controls into the `测试` tab with the same panel control styling.

**Lessons**:
- ESC overlays that block arena input should keep a single active shell and route pages with local state; this avoids duplicating settings persistence or keyboard handling.
- When moving live controls between panels, preserve the existing state keys and localStorage effects so the UI changes do not reset player preferences.


## 101. BattleArena compact top bar and custom UI guide visibility follow-up (2026-05-08)

**Problem set**:
1. The top metrics bar and its text needed to be reduced by 50%.
2. The `玉门关` mode badge should no longer display.
3. Combat stat control buttons were too high and needed to move into the bottom half of the screen.
4. The `目标技能栏` custom UI box could collapse to nearly no height when there was no live target ability content.
5. Custom UI green guides could be hidden behind the actual widget and were too tight around the UI.

**Fix**:
- Reduced the top metrics strip from `29px`/`22px` text to `14.5px`/`11px` text and halved its spacing/button chrome.
- Removed the in-scene mode badge render entirely.
- Moved `.critPresetBar` to `top: 56%` so stat controls sit in the lower half of the arena.
- Added target skill preview placeholders plus fixed `32px` target skill slots so the custom UI guide includes icon height and ability-name text.
- Raised shared custom UI green overlays above widgets and expanded them by `6px` without adding layout padding or moving saved positions.

**Lessons**:
- A non-layout pseudo-element can be visually larger than the widget and still preserve exact saved placement if the parent padding/border remain zero.
- Custom UI preview content should include realistic placeholder dimensions; otherwise edit guides for context-dependent HUD widgets collapse when the live target state is empty.


## 102. BattleArena top metrics bar and custom UI placement correction (2026-05-08)

**Problem set**:
1. The temporary `物品栏` needed to be reduced from sixteen slots to fourteen.
2. The self HP custom-UI guide showed an unnecessary `自身血条` label.
3. The C-key attribute panel was not included in custom UI positioning.
4. The top-right latency badge needed to become a full-width top metrics strip with `设置`, system time, render FPS, and network latency.
5. Floating custom-UI green edit boxes shifted after confirm because their editing border/padding changed the measured widget box.

**Fix**:
- Changed `ITEM_BAR_SLOT_COUNT` to `14` and re-centered the item-bar default fallback.
- Removed the self HP guide label in custom UI mode.
- Added a `heart-stats-bar` custom UI key and draggable placement wrapper for the C stats panel.
- Added a 29px full-width translucent gray top metrics bar with live system time, rAF-based render FPS, and the existing ping latency value, then removed the old RTT badge.
- Converted shared floating custom-UI edit chrome to an exact overlay pseudo-element so the green line displays the widget bounds without changing layout.

**Lessons**:
- Custom-UI edit chrome should use non-layout outline/overlay styling; any padding or border on the draggable element changes both saved geometry and the post-confirm visual position.
- HUD metrics that replace a corner badge should reuse existing measurement state when possible, then remove the old rendered surface entirely to avoid duplicate readouts.


## 103. BattleArena icon chrome, item slots, and reorder prediction follow-up (2026-05-08)

**Problem set**:
1. Icon-bar transparency was applied to text rows, so the name/range and resource number were dimmed along with the frame.
2. The item bar placeholder used a different slot size than the skill bar.
3. Optimistic skill reorders could flicker because derived ability state from the still-stale server hand briefly overwrote the prediction.
4. The temporary item bar needed to accept ability drags and swap with skill slots locally.

**Fix**:
- Removed text-row opacity from icon bars, reduced the name/range font size slightly, and moved 30% transparency to the surrounding chrome/background colors.
- Scaled item slots from the same `--ability-panel-scale` math as skill slots.
- Kept pending optimistic skill reorders applied until the authoritative slot index confirms the move, while still rolling back on request failure.
- Added local item-bar ability slots, draft-slot overrides, hotkey filtering, and pointer drop handling so abilities can temporarily move/swap between skill and item slots without staying castable from their old hotkey.

**Lessons**:
- When only HUD chrome should be translucent, use alpha colors on the frame/background instead of `opacity` on parent text rows.
- Optimistic UI that is derived from server state needs a pending overlay, not just a one-time state set, or normal state hydration can visibly snap it back.
- Temporary local inventory slots need explicit hidden-id and slot-override state in both render and hotkey paths so moving an ability out of the hotbar leaves a real empty slot instead of duplicating or preserving the old cast binding.


## 104. BattleArena item bar, tooltip alpha, and optimistic hotbar reorder (2026-05-08)

**Problem set**:
1. Tooltip alpha was interpreted as 30% visible instead of 30% transparent, so ability and buff hover panels were too transparent.
2. Draft slot switching only updated after the reorder endpoint returned, making the interaction feel slow.
3. The discard strip needed more height, a bluer accent, and no hover border/glow.
4. A future item bar placeholder needed ten empty boxes with the same edge hover effect as ability slots, while not accepting skill drops.

**Fix**:
- Changed ability and buff hover panels to `rgba(0, 0, 0, 0.7)` for 30% transparency.
- Added frontend optimistic slot reorder prediction with rollback if the backend reorder request fails.
- Increased discard-strip height by 50%, changed the accent from cyan to bluer light blue, and removed the active outer hover glow.
- Added a draggable custom-UI `item-bar` placement with ten inert item slots that share the ability-slot edge hover overlay and have no drop target attributes.

**Lessons**:
- For UI opacity language, confirm whether the user means visible alpha or transparency amount; `30% transparent` maps to alpha `0.7`.
- Reorder prediction should use the same slot-index swap helper as the final state update and keep a previous-state rollback for failed requests.
- Future HUD containers that should not accept ability drops should avoid draft/drop data attributes entirely, so pointer hit testing naturally ignores them.


## 105. BattleArena slot order, charge frame, and status blink follow-up (2026-05-08)

**Problem set**:
1. New non-common skills could land in the last visual slot because `slotIndex` fallback used full hand order after common abilities were appended.
2. Reorder behavior could feel like the wrong boxes were swapping when existing cards had duplicate or missing slot indexes.
3. Height and distance custom UI placements had unnecessary label text, tooltip panels were too opaque, and the discard strip still had a background tint.
4. Charge frames needed bottom-right path order, a smaller count badge, and explicit layering so shortcut text stays above the red frame while the count badge covers it.
5. Status bar icons blinked invisible below two seconds even though they should remain visible until the buff naturally expires.

**Fix**:
- Normalized draft slots separately from common abilities on frontend and backend, assigned new skills to the first available draft slot, kept common abilities after draft cards, and rejected the seventh skill with `只能拾取6个技能` for cheat add, draft selected slots, and pickup claims.
- Changed charge frame SVGs from `rect` to an explicit bottom-right-starting path, reduced charge badge width/font size, and added z-index ordering for badge/frame/shortcut text.
- Removed the height/distance custom UI label text, reduced ability and buff hint backgrounds to 30% black, removed discard background entirely, and switched its accent to light blue.
- Replaced full-slot cyan hover fill with edge-weighted gradients so the center stays transparent.
- Removed low-time opacity blinking from `StatusBar`; buffs now disappear only when their remaining time reaches zero.

**Lessons**:
- Draft slot fallback must be based on draft-card order only; using full hand order breaks as soon as common abilities are present.
- A compact array cannot be treated as visual slot truth after holes are allowed; normalize explicit slots, fill invalid/missing slots into first openings, then render from slot metadata.
- SVG stroke direction is safest when the path is written in the exact desired order instead of relying on browser `rect` path starts.


## 106. BattleArena tooltip, custom UI, and empty-slot hotbar round (2026-05-08)

**Problem set**:
1. Ability and buff hover boxes needed to revert to whole-box black half-transparent styling instead of gray panels or desc-only backgrounds.
2. The height counter and blue range/distance text were still fixed HUD elements and could not be positioned in custom UI mode.
3. Icon-bar chrome needed to be half-transparent without dimming the actual health/shield fills.
4. The target-owned ability strip still had visible gaps and rounded icons, while the ability hover overlay did not match the desired cyan filled hover state.
5. Hotbar charge frames were accidentally restyled away from red, charge count badges were too small, discard used a yellow background, and dropping a skill onto an empty slot did not persist.

**Fix**:
- Restyled ability and buff hint containers to `rgba(0, 0, 0, 0.5)` and removed the separate gray ability-desc background.
- Added `height-counter` and `distance-indicator` custom UI keys, default placements, edit labels, and drag height clamping based on the actual dragged element size.
- Reduced alpha on icon-bar chrome/title/resource rows while leaving health and shield track/fill rules untouched.
- Tightened target-owned ability gaps, removed target-owned icon radius, changed ability hover to a translucent cyan fill/glow, restored red charge ring strokes, enlarged charge stack badges to match shortcut text, and replaced the discard strip with a dark transparent base plus cyan bottom indentation.
- Added draft `slotIndex` support on frontend and backend reorder persistence so moving an ability to an empty hotbar slot survives the authoritative update instead of compacting back.
- Updated Playwright HUD coverage to assert source guards and browser-computed styles for the tooltip, hover, charge, discard, custom UI, icon-bar, target-owned ability, and slot-index behaviors.

**Lessons**:
- Empty hotbar slots require persisted slot metadata; reordering only a compact array cannot represent holes after the server broadcasts state.
- Hover effects on icon buttons should be validated through pseudo-element computed styles because visually thin border overlays can pass source checks while missing the intended filled state.
- For draggable HUD elements, clamp against the measured element width and height, not just the mouse point, or large labels can be dragged partially off-screen.


## 107. BattleArena HUD correction round and Playwright coverage (2026-05-08)

**Problem set**:
1. Several earlier HUD changes were incomplete because frontend-only values were changed while backend defaults or WebSocket payloads still used old values.
2. The skill bar visual changes needed computed-style verification: tray backgrounds, icon gaps, border colors, hover inner borders, shield visibility, and custom UI guide borders.
3. The repo had no Playwright setup, so UI regressions were only checked by build output.
4. Playwright creates result metadata after each run, which should not keep dirtying the working tree.

**Fix**:
- Removed the remaining add-skill panel header, aligned backend starting battle HP to `120万`, and changed WebSocket disconnect prompts to 5 seconds with a frontend clamp for stale 30-second payloads.
- Replaced the top-left text home button with a compact icon button and moved the mode badge so `玉门关` is not covered.
- Put status names directly on standard yellow with no dark stroke, restored ability custom-UI green borders, tightened owned ability gaps, reduced the target icon bar by 10%, and kept the shield white fill visible while removing only shield amount text.
- Removed red charge/LOS ability borders, removed gray hotbar/common-bar tray backgrounds, and restyled ability borders to dark gray-green with a white inner hover line.
- Added frontend Playwright config, a `test:e2e` script, and HUD regression tests that cover the source constants/rendered text plus browser-computed CSS for the visual rules.
- Added Playwright output directories to `.gitignore` and removed generated result metadata from the tracked diff.

**Lessons**:
- For timing or default-value changes, update every producer of the value, not only the component fallback that displays it.
- Visual HUD requests need browser-computed style tests when CSS transitions, module selectors, and stacked overrides can make source edits misleading.
- When adding tests to an existing app, include source guards for backend/frontend constants plus a small rendered CSS fixture for visual rules that do not require a full authenticated game session.
- Ignore Playwright output directories when introducing the runner, or the first successful test run will create unrelated result files.


## 108. BattleArena HUD sizing and target-of-target custom UI split (2026-05-08)

**Problem set**:
1. Player-only HUD requests needed careful scoping so self icon/status changes did not resize enemy, target, or target-of-target UI.
2. Target-of-target was nested inside the target icon bar, which meant custom UI mode could not position it independently.
3. The remaining ability-bar custom UI guide needed a different edit-box shape than generic HUD placements.

**Fix**:
- Reduced only the player icon bar width, added a player-only `StatusBar` scale variant, and kept target/enemy status bars on the default sizing path.
- Lightened status timer text by reducing its weight and removing timer-only black stroke/shadow while leaving names and stack badges unchanged.
- Rebalanced the bottom skill bar upward by about 10% after the earlier reduction.
- Added a dedicated `target-target-icon-bar` custom UI key, default placement, preview, and standalone renderer so target-of-target can be dragged separately from the target icon bar.
- Added a target ability-bar custom UI edit style that is half the status guide width and removes the guide border/radius.

**Lessons**:
- For shared components like `StatusBar`, add explicit variant props for player-only tuning instead of changing base CSS that target/enemy panels reuse.
- Nested HUD widgets that need independent placement should compute their live data outside the parent render branch and use their own persisted custom UI key.
- Generic custom UI edit chrome is useful, but each HUD family may still need a scoped override when the desired edit box differs from the common green guide.


## 109. BattleArena HUD save moved from localStorage to user profile (2026-05-08)

**Problem set**:
1. The BattleArena custom UI layout was only saved in browser `localStorage`, so the HUD arrangement was device-local and could disappear across browsers, devices, or cleared storage.
2. The user explicitly wanted this layout to behave like a real saved profile setting instead of a session-local browser cache.

**Fix**:
- Added `battleArenaUiLayout` to the backend `User` model so each account can persist HUD positions and the viewport they were authored against.
- Added authenticated gameplay endpoints at `/api/game/ui-layout` to load and save the sanitized HUD layout payload.
- Rewired `BattleArena.tsx` to hydrate draggable HUD positions from the server on load and persist changes back through the authenticated API while keeping the existing viewport-scaling logic.

**Lessons**:
- HUD personalization that the player expects to follow their account should live on the authenticated user profile, not in browser-only storage.
- When replacing a legacy localStorage save path, keep the payload shape compatible enough to reuse existing normalization and scaling code instead of branching persistence logic.


## 110. Fullscreen-safe BattleArena custom UI scaling (2026-05-08)

**Problem set**:
1. The BattleArena custom UI saved HUD placements as raw pixel coordinates with no viewport metadata.
2. Entering or leaving fullscreen changes the arena viewport size, so saved custom HUD layouts could drift or look wrong even though the player wanted the same relative arrangement.

**Fix**:
- Changed BattleArena UI-position persistence to store both the HUD positions and the arena viewport size that those positions were saved against.
- Added resize-time scaling so existing in-memory HUD placements rescale proportionally when the arena viewport changes, including fullscreen transitions.
- Also scale the custom-UI edit snapshot during viewport changes, so cancelling out of custom UI in fullscreen still restores the correct relative layout instead of old raw pixels.

**Lessons**:
- Any draggable HUD layout intended to survive fullscreen changes must either store normalized coordinates or carry the source viewport and rescale on resize.
- If custom UI has a cancel snapshot, resize logic must update that snapshot too or fullscreen entry will make cancel restore the wrong geometry.


## 111. In-game home button, timing-bar resize, and top-bar route gating (2026-05-08)

**Problem set**:
1. The self timing bars needed their sizes retuned again: the self channel bar should be longer than the GCD bar, and both should be about 20% larger.
2. After moving the global top bar out of the in-game view, the arena still needed its own top-left home button that uses the same `/api/game/end` leave flow before routing home.
3. The shared layout shell only treated `/game/in-game` as in-game, so the duplicate `/game/screens/in-game` route could still render the global top bar incorrectly.

**Fix**:
- Retuned the self timing bars by setting the HUD channel bar to `70%` / `264px` and the GCD bar to `60%` / `226px`, which swaps their relative lengths and makes both about 20% larger.
- Added a fixed top-left `首页` button in `InGameClient.tsx` and routed it through the same `/api/game/end` request before `router.replace('/')`; the disconnect prompt now reuses that same helper too.
- Updated `LayoutShell` to treat both `/game/in-game` and `/game/screens/in-game` as in-game routes, skip rendering the shared `TopBar` there, and give the game view a full `100dvh` content area when the top bar is hidden.

**Lessons**:
- For these HUD bars, percentage width plus a floating-width constant must be tuned together or the inline and custom-UI placements drift apart.
- When replacing a shared navigation control with an in-scene button, reuse the same leave endpoint so battle teardown behavior stays consistent.
- Route gating for layout chrome should match every mounted route alias, not just the canonical page path, or duplicate screen entry points will regress independently.


## 112. Self timing bars custom-UI anchors and icon-bar title trim (2026-05-08)

**Problem set**:
1. The self channel bar and self GCD bar were rendered inside the owned ability stack, so custom UI mode could only move them together with the hotbar instead of as independent HUD widgets.
2. When those bars are inactive, custom UI mode still needs visible previews and stable default anchor positions so the user can drag them before they appear in combat.
3. The icon-bar title above self/target bars needed to read about 10% smaller without retuning the rest of the bar.

**Fix**:
- Added dedicated `player-channel-bar` and `player-gcd-bar` UI position keys in `BattleArena.tsx`, seeded them when custom UI mode opens, and rendered the self timing bars as separate floating placements whenever the user is editing or has saved a custom position.
- Kept the old inline layout as the default path until a custom position exists, and used preview renderers plus hotbar-relative fallback placement so custom UI mode can drag both bars even when they are not currently active.
- Added CSS custom-property width overrides for the channel/GCD bar roots so the floating draggable boxes match the live bar widths, and reduced `.enemyName` font size from `16px` to `14.4px` for the requested 10% title trim.

**Lessons**:
- If a HUD widget should be draggable independently, it needs its own persisted anchor key even when it normally lives inside a larger shared stack.
- Preview renderers matter for combat-only HUD elements; otherwise the custom UI editor can store positions for panels the user cannot currently see.
- For percentage-width HUD bars reused in floating placements, a CSS variable width override is a low-risk way to preserve the inline layout while giving detached anchors a stable measured size.


## 113. Status countdown checkpoint blink and full-height edit overlay (2026-05-08)

**Problem set**:
1. The urgent status blink still did not follow the requested checkpoints; it needed to start below 2 seconds and reach exact fully hidden / fully visible points at 1.49, 0.99, 0.49, and 0.01 before disappearing at 0.00.
2. Screenshot review showed the custom-UI green guide still used a fixed height, so the timer text could fall below the box even after a previous height increase.
3. The live status icons, names, and timer text needed to be about 10% smaller while keeping the editor guide aligned to the actual content.

**Fix**:
- Changed `StatusBar/index.tsx` so urgent blinking starts only when `secsLeft < 2` and uses explicit piecewise opacity interpolation for the 1.99 → 1.49 → 0.99 → 0.49 → 0.01 checkpoints.
- Reduced shared StatusBar icon, timer, name, stack-badge, spacing, and compact-mode sizing by 10% in `StatusBar/styles.module.css`.
- Replaced the fixed-height `customUiStatusGuide` overlay in `BattleArena.module.css` with a full-height `top/right/bottom/left: 0` overlay so the green frame always covers the full live status content.
- Rebuilt frontend and backend after each numbered point, flushed PM2 logs before the final restart, and verified fresh frontend/backend PM2 tails without startup errors.

**Lessons**:
- When the user gives explicit blink checkpoints, encode the opacity curve directly instead of deriving it from the fractional part of the current second.
- In a HUD editor, overlay guides should stretch to the real content height rather than guessing a fixed pixel height, or timer text will drift outside the frame as component sizing changes.
- If a guide box must match a live shared component, shrink the shared component and stretch the guide to it rather than tuning both with separate hard-coded heights.


## 114. Custom UI status overlay restore and guide height retune (2026-05-08)

**Problem set**:
1. The user specifically meant the green custom-UI edit boxes in BattleArena, not the underlying StatusBar content size.
2. Replacing the real detached `StatusBar` with a guide-only placeholder in custom UI mode made it impossible to verify whether the live HUD was aligned correctly while dragging.
3. After restoring the live status UI, the green guide box still needed to be taller by 50%.
4. The edit labels for green draggable boxes needed to stay centered inside the guide box instead of above it.

**Fix**:
- Changed `renderStatusPlacement` in `BattleArena.tsx` so the live `StatusBar` keeps rendering during custom UI mode and the green drag guide is layered over it instead of replacing it.
- Kept `.customUiPlacementLabel` centered inside the green guide overlay so the edit-box name stays readable without hiding the drag frame.
- Initially increased the overlay guide height in `BattleArena.module.css` from `28px` to `42px`; later screenshot review showed that a fixed height was still insufficient, so the final solution became a full-height overlay tied to the live content.
- Rebuilt frontend and backend after each numbered point, flushed PM2 logs before the final restart, and verified fresh frontend/backend PM2 tails with no startup errors.

**Lessons**:
- In a HUD editor, the drag guide should be an overlay on the live component, not a replacement for it, or the user loses the ability to judge alignment.
- Keep drag-guide sizing in the overlay CSS so visual tuning does not accidentally change the real HUD content path.


## 115. Status-bar custom UI height correction after wrong-layer edit (2026-05-08)

**Problem set**:
1. The earlier custom-UI size change was applied in `BattleArena.module.css`, but the user still saw effectively no height change on the detached buff/debuff placement boxes.
2. The visible custom-UI status placement height was actually being held open by the shared `StatusBar` component, which always reserved two rows of height even when a filtered BUFF-only or DEBUFF-only bar rendered only one row.

**Fix**:
- Added a `singleRowStatusBar` path in the shared `StatusBar` styles and applied it automatically whenever `categoryFilter` reduces the bar to a single row.
- Left the widened custom-UI placement wrapper in place, so once the shared status-bar min-height was corrected, the green edit box became both shorter and wider as intended.
- Rebuilt frontend and backend and restarted PM2 on the newest successful build; fresh frontend/backend PM2 tails again showed no startup errors.

**Lessons**:
- When a visual wrapper change appears to do nothing, check whether the child component is enforcing a larger intrinsic size; fixing the wrong layer can be technically valid but visually irrelevant.
- Detached BUFF-only and DEBUFF-only status bars should not inherit the two-row min-height used by the combined status display.


## 116. Single HP-boundary divider, second-aligned blink, and borderless target-target icons (2026-05-08)

**Problem set**:
1. The BattleArena icon bars showed three fixed white divider ticks, but the requested visual was a single softer divider only at the live boundary between filled HP and missing HP.
2. Sub-3-second buff blinking was driven by a free-running CSS animation, so it did not blank once per actual displayed second and could appear to blink only twice before expiry.
3. The compact target-target status bar should keep its icons but remove the icon borders entirely.

**Fix**:
- Replaced the 25/50/75 tick rendering in `BattleArena.tsx` with a single divider tied to each bar's current HP percentage and retuned the divider in `BattleArena.module.css` to a 2px half-transparent white line.
- Replaced the free-running urgent CSS animation in `StatusBar` with a live time-sliced hide window based on remaining seconds, so the buff blanks once during each displayed second under 3 seconds and the final blank happens during `0.x` before removal.
- Added an opt-in `borderlessIcons` variant to `StatusBar` and applied it only to the target-target compact status row in `BattleArena.tsx`.
- Rebuilt frontend and backend after each numbered point and restarted PM2 on the newest successful build each time.

**Lessons**:
- Divider visuals in segmented bars need to follow the live fill boundary rather than using static percentage markers when the UI intent is “current HP vs missing HP.”
- Countdown blink behavior that must align with displayed seconds is more reliable when derived from live remaining time than from a free-running CSS animation loop.
- Shared HUD components are easier to tune safely when special cases such as borderless compact icons stay behind explicit opt-in props.


## 117. Status-bar timing spacing frame retune and enemy divider restore (2026-05-08)

**Problem set**:
1. Status-bar second timers rounded up, so `0.x` seconds showed `1″` and `1.x` seconds showed `2″`.
2. The gap between status names and icons was too large.
3. Status text still read weaker than the reference image; the main visual difference was stronger dark text outline/shadow separation rather than icon border alone.
4. Status icon borders needed a more neutral gray frame at about half the previous thickness.
5. The enemy icon bar should show lost health as a muted gray-red track rather than a pure neutral gray track.
6. The vertical HP divider lines were not visible because the CSS existed but the tick elements were not rendered into the bars.

**Fix**:
- Changed StatusBar sub-minute timer display to floor whole seconds, so live countdowns now show `0″`, `1″`, `2″`, etc. instead of rounding up.
- Split StatusBar internal spacing so the name-to-icon gap is about 70% smaller without collapsing the icon-to-timer spacing.
- Retuned the StatusBar icon frame to a thinner neutral gray border and matching thinner hover framing.
- Retuned the enemy icon-bar empty-health track in `BattleArena.module.css` to a desaturated gray-red tone.
- Rendered 25/50/75% tick elements into all BattleArena icon bars and changed the tick styling to visible white dividers above the fill.
- Rebuilt frontend and backend after each numbered point and restarted PM2 on the newest successful build each time.

**Lessons**:
- If the UI should display “time remaining as whole seconds left”, floor-based display is the correct rule; ceil-based display overstates near-expiry timers.
- In this HUD, readability differences between reference text and in-game text come mostly from text stroke/shadow strength and brightness separation, not just icon border color.
- Divider CSS alone is not enough for segmented HP bars; confirm the separator elements are actually rendered into each bar variant.


## 118. Icon-bar empty-health gray state and white-track inset fix (2026-05-07)

**Problem set**:
1. The red target icon bar kept showing a red empty-health area after damage instead of the neutral gray look already used by the white self bar.
2. On the white self icon bar, the HP fill sat flush against the track border, which made the lower edge read slightly outside the border.

**Fix**:
- Updated the shared `enemyHpTrack` background and inner highlight in `BattleArena.module.css` so the exposed empty-health area reads gray while preserving the red HP fill gradient.
- Added a white-bar-only `top: 1px; bottom: 1px;` inset for `.selfIconBar .enemyHpFill` and `.selfIconBar .enemyShieldFill` so the fill sits inside the track border.
- Rebuilt frontend and backend after each numbered point and restarted PM2 on the newest successful build each time.

**Lessons**:
- In this HUD, the color of lost health is controlled by the track background, not by the HP fill itself.
- Light icon-bar palettes reveal fill-to-border overlap much more than dark ones, so a small vertical inset is a safer fix than retuning the whole track height.


## 119. Self border darkening and target-target self relationship styling (2026-05-07)

**Problem set**:
1. The silver-white self border still read too light against the new self icon bar body.
2. The target-target bar was still visually treated as an enemy target even when it resolved to the local player, so its border and name remained red.

**Fix**:
- Darkened the self icon bar outer border and inner HP track border in `BattleArena.module.css`.
- Added `targetTargetIsSelf` detection in `BattleArena.tsx` and apply `selfIconBar` styling to the compact target-target bar when the resolved target-target player is the local player.
- Rebuilt backend and frontend, restarted PM2 on the newest build, and re-checked local frontend, backend preload, and deployed HTTPS health.

**Lessons**:
- The target-target bar does not infer relationship styling from the resolved actor by itself; it needs an explicit self-style class branch when the resolved player is the local user.
- Because `.selfIconBar` rules come later than `.targetTargetBossBar` rules in `BattleArena.module.css`, the self palette can override the compact target-target red styling without duplicating another CSS variant.


## 120. Shared icon-bar HP color retune (2026-05-07)

**Problem set**:
1. The new orange HP fill still leaned too orange and dark.
2. The lighter, slightly redder correction needed to apply not only to self, but also to the main target bar and target-target bar.

**Fix**:
- Retuned both `iconBarHpGradient` and `selfIconBarHpGradient` in `BattleArena.tsx` to the same lighter red-orange gradient: `#ff9a74 -> #ef5b39 -> #c92a1c`.
- Rebuilt backend and frontend, restarted PM2 on the newest build, and re-checked local frontend, backend preload, and deployed HTTPS health.

**Lessons**:
- All three icon-bar HP fills are controlled by the two gradient constants in `BattleArena.tsx`, so cross-bar color retunes can stay as a single-file change when the bar structure itself is already aligned.


## 121. Self icon bar conversion and silver-orange palette update (2026-05-07)

**Problem set**:
1. The always-visible self HUD was still using the older compact `playerPanel` instead of the newer icon-bar shape used by target bars.
2. The self bar needed the same icon-bar structure as the target bar, but with a silver-white body and orange HP fill matching the provided reference image.
3. The selected-self top bar and the lower self panel needed to share the same self-specific HP gradient instead of inheriting the enemy red fill.

**Fix**:
- Replaced the lower self panel markup in `BattleArena.tsx` with the same `enemyBossBar` / `iconBarBody` structure used by the target bar while keeping the existing self-select click behavior.
- Added a self-only HP gradient branch in `BattleArena.tsx` so self bars use an orange fill instead of the enemy red gradient.
- Updated `.selfIconBar` styling to a silver-white body, cooler empty HP track, brighter white shield fill, and yellow title/resource text, and sized the lower self bar to the same width as the main target bar.
- Rebuilt backend and frontend, restarted PM2 on the newest build, and re-checked local frontend, backend preload, and deployed HTTPS health.

**Lessons**:
- The cleanest way to keep self and target bars visually aligned is to reuse the same icon-bar markup and branch only the self-specific palette.
- VS Code chat storage did not expose the uploaded reference screenshot as a directly readable image file in this session, so exact pixel sampling was not possible through the available file/image tools; the applied silver-orange palette was matched from the visible reference instead.


## 122. Target-target title simplification and spacing retune (2026-05-07)

**Problem set**:
1. The target-target icon bar still displayed a range prefix when only the name should remain visible.
2. The target-target bar sat too low relative to the main target bar.
3. The horizontal gap between the main target bar and target-target bar needed another 50% increase.

**Fix**:
- Removed the target-target distance prefix and now render only the resolved target-target name in the compact icon bar title.
- Reduced the target-target bar top offset from `53px` to `26.5px`, effectively moving it up by 50%.
- Increased the main-target to target-target gap from `16px` to `24px`.
- Rebuilt backend and frontend, restarted PM2 on the newest build, and re-checked local frontend, backend preload, and deployed HTTPS health.

**Lessons**:
- The target-target title is controlled by a single local string in `BattleArena.tsx`, so removing distance text does not require touching the shared distance formatter used by the main target bar.
- For this HUD layout, a simple `margin-top` change on the compact secondary bar is enough to retune its vertical relationship to the main target without reopening the whole target stack structure.


## 123. Status bar scale trim and target-target icon bar spacing (2026-05-07)

**Problem set**:
1. Status text outlines needed to be about 30% thinner without changing the underlying timer behavior.
2. The whole status bar needed to read about 10% smaller overall, not just with smaller icons.
3. The target-target icon bar needed another 50% width reduction.
4. The target-target bar needed a larger separation from the main target bar and a lower vertical placement by roughly one bar height.

**Fix**:
- Reduced the buff-name, stack-count, and timer stroke/shadow outline thickness values by roughly 30%.
- Scaled the status bar down by about 10% across icon size, row/item gaps, reserved label/timer height, and related text sizes, including compact mode.
- Reduced the target-target boss stack and bar width from `220px` to `110px`.
- Doubled the main-target to target-target gap from `8px` to `16px` and lowered the target-target icon bar with a `53px` top offset to match its compact bar height.
- Rebuilt backend and frontend after each numbered point, restarted PM2 on the newest build, and re-checked local frontend, backend preload, and deployed HTTPS health.

**Lessons**:
- For this HUD, “overall size” changes need the reserved text block height and row gaps scaled with the icons; shrinking only the icons leaves the component visually too tall.
- The main target bar and target-target bar remain safest to tune with independent CSS width and offset rules.
- In this environment, chained build/restart/health commands can stop echoing after the frontend `Creating an optimized production build ...` line even when the follow-up explicit build succeeds, so final verification should use direct reruns of the frontend build and health probes when the combined output is inconclusive.


## 124. Enemy icon bar width reduction (2026-05-07)

**Problem set**:
1. The enemy icon bar remained too wide after the previous HUD rework and needed to be reduced by 30%.

**Fix**:
- Reduced the main enemy icon bar width and min-width from `360px` to `252px`, leaving the smaller target-target bar unchanged.

**Lessons**:
- The main target bar and target-target bar use separate width rules, so width corrections can stay narrowly scoped without disturbing the secondary target stack.


## 125. Target selection and split movable status bars (2026-05-07)

**Problem set**:
1. Target-of-target was inferred from active channels/fallbacks instead of the selected actor's real target.
2. Status bar borders, hover emphasis, urgent blinking, timer outlines, timer size, and second-mark spacing needed to better match the requested in-game visual style.
3. Player and target buff/debuff bars needed to be separate movable custom UI elements.
4. Dragging in 自定义界面 could still move the camera because global capture-phase mouse handlers saw the event before React handlers stopped it.

**Fix**:
- Added authoritative `targetSelection` to player state, a `/game/target/selection` route, frontend sync through `useGameState`, and target-of-target resolution from the selected actor's stored selection.
- Softened status icon borders to lightweight gray, made hover more obvious through icon framing, changed urgent flashing to a smooth 1-second opacity animation, enlarged centered timer text, thinned its black outline, and replaced spaced ASCII seconds marks with compact prime glyphs.
- Added `categoryFilter` to `StatusBar`, then split player and target status into independent `BUFF` and `DEBUFF` placement keys under the existing `zhenchuan-ui-positions` storage. Legacy player status placement seeds the new player buff bar so old layouts do not jump unexpectedly.
- Cleared camera drag state when entering custom UI or starting UI drag, marked draggable status placements with `data-ui-drag`, and blocked mouse/touch/wheel camera handlers while custom UI mode is active.

**Lessons**:
- Target-of-target must be shared authoritative state once the UI promises to show another actor's real target. Active channels are useful cast context, not selection state.
- Capture-phase window listeners can beat React `stopPropagation`; draggable HUD elements need both a data-attribute guard and explicit camera-state reset.
- Splitting a shared visual component is cleaner when the component gets a narrow category filter prop instead of duplicating buff rendering logic in the parent HUD.


## 126. Homepage start styling, status hover rules, and custom UI placement (2026-05-07)

**Problem set**:
1. The homepage primary start button looked like a plain black rectangle and needed stronger game styling.
2. The in-game mode badge had been offset to avoid a home panel that is no longer displayed.
3. Status text needed thin black outlining, yellow default buff/debuff names, black icon borders, smaller icon scale, flex-start rows, and full-item blinking below 3 seconds.
4. Hovered status icons needed to read differently from non-hovered icons without turning status text white.
5. The ESC panel needed a first custom UI mode that closes the panel, shows confirm/cancel controls, and lets the player move the status bar with saved placement.

**Fix**:
- Restyled the big homepage start button with a framed, highlighted game-button treatment while keeping the existing mode selector flow.
- Moved the mode badge back to the top-left now that the home panel no longer occupies that space.
- Updated StatusBar rows to flex-start layout, reduced default icon size by 30%, added thin black borders/outlines to icons, names, timers, and stack numbers, made names yellow by default, and made sub-3-second statuses blink as a complete item.
- Replaced the old hover whitening with a blue icon border/glow so hover matches the screenshot difference while preserving text colors.
- Added 自定义界面 in the ESC panel. It opens a centered confirm/cancel panel and a green placement frame for the player status bar; confirmed positions persist through the existing `zhenchuan-ui-positions` storage, and cancel restores the snapshot.

**Lessons**:
- StatusBar hover should use icon framing for affordance when text colors carry gameplay meaning; changing text to white fights readability and screenshots.
- UI customization should reuse the existing position persistence seam and add confirm/cancel snapshot behavior instead of writing a separate storage format.


## 127. Status layout, disconnect prompt, target-target HUD, and BVH audit (2026-05-07)

**Problem set**:
1. The status bar name/time/icon layout had drifted from the old name-above-icon presentation.
2. Status icons needed to be larger while keeping time below the icon and rows left-aligned.
3. Remaining players needed a modal choice when another player disconnects, with No/Yes and a 30-second countdown.
4. The target-target bar needed to be half-size, include compact buff/debuff icons, show percent-only health text, and still appear when self is selected.
5. The per-stat combat preset panel needed visible exact values, not hidden tooltip-only values.
6. The previous BVH helper restoration needed an audit to confirm it did not undo the intentional exported-map ground fallback cleanup.

**Fix**:
- Restored StatusBar names to the previous above-icon flow with category-colored text, set icons to 48px, moved timers below icons, and made rows consume full width so contents align left.
- Added `PLAYER_DISCONNECTED` / `PLAYER_RECONNECTED` WebSocket presence messages and a solid, non-blur disconnect modal that can dismiss or call `/game/end` and return home; the countdown auto-returns after 30 seconds.
- Added compact StatusBar options for icon-only rows, then used them under the half-width target-target boss health bar. Target-target HP now displays as a percentage, and self selection falls back to the primary opponent.
- Updated the expanded combat stat preset panel so every rarity button shows the exact stat value directly in the panel.
- Audited the BVH helper restore: the restored symbols are required by collision, vertical ground probing, and LOS, while collision-test unsupported support still returns `0` instead of falling back to legacy object heights.

**Lessons**:
- For a shared component like StatusBar, add explicit props for compact/hidden-name/hidden-timer variants instead of restyling the default and breaking existing presentation.
- Opponent disconnect prompts need a server-side presence event; a client can only observe its own socket closing.
- Restoring a missing helper can be correct even if the helper includes legacy-mode utilities, as long as the active collision-test path keeps the intended guard against legacy fallback behavior.


## 128. Exported map BVH helper regression (2026-05-07)

**Problem set**:
1. The exported-map battle scene crashed at runtime with `ReferenceError: getBvhGroundProbeOriginY is not defined`.
2. The same broken helper seam also removed `EXPORT_CYL_RADIUS`, and the remaining collision / LOS code still referenced it during BattleArena startup.
3. Because the frontend production build skips type validation in this setup, those missing top-level symbols survived build time and only failed in the browser.

**Fix**:
- Restored the deleted shared BattleArena helper block: `getGroundHeightClient`, `_bvhCenter`, `_bvhVelocity`, `EXPORT_CYL_RADIUS`, `EXPORT_CYL_HALF_HEIGHT`, `BVH_STEP_UP_EXPORT`, and `getBvhGroundProbeOriginY`.
- Rebuilt backend and frontend, restarted PM2, and verified frontend `200` plus backend preload `200` after the fix.

**Lessons**:
- When a render or collision helper is shared across multiple runtime paths, partial cleanup can leave valid syntax but broken runtime globals. Re-check the whole helper seam, not only the first missing symbol in the browser console.
- In this repo, `next build` can still miss missing runtime identifiers when type validation is skipped, so PM2/browser failures need a direct audit of referenced top-level constants and helpers.


## 129. Control-only immunity, dummy stats, restart HP, and client diff load (2026-05-06)

**Problem set**:
1. 啸如虎 used `CONTROL_ONLY_IMMUNE`, but knockback and pull paths are type-3 controls implemented through forced-movement helpers, not only normal buff filtering.
2. Target dummies had 126万 HP but not the rest of the 紫色 test-preset stats.
3. A BATTLE snapshot could hydrate an unstarted or old-stat loop before `/battle/start`, causing the start route to return `battle_already_started` instead of restoring purple battle stats.
4. The frontend applied every 30Hz diff by `structuredClone`-ing the full game state, which recreated large unchanged arrays like `events` and made idle pages keep doing heavy work.

**Fix**:
- Treated `CONTROL_ONLY_IMMUNE` as knockback/pull immunity in forced-movement guards while keeping lockouts separate.
- Added purple combat stats to dummy spawn/restore: HP, AD, crit, defense, and 化劲. The 100-HP ally dummy keeps its HP override.
- Reinitialize unstarted old-stat loops in `/battle/start`, and start the next battle loop immediately after `/battle/complete` creates the fresh purple state.
- Replaced full-state frontend diff cloning with path-level immutable cloning so unchanged `events` and other heavy branches retain their references.

**Lessons**:
- Control immunity has to cover the actual runtime implementation path. Forced movement can bypass ordinary buff-effect filtering if the active dash is created before the status buff lands.
- Client-side diff application must preserve references for unchanged high-frequency branches; otherwise even capped event history still causes avoidable CPU and memory pressure.


## 130. Runtime reconnect, event history, 化劲, and HP percent gates (2026-05-06)

**Problem set**:
1. After page refresh or PM2/server restart, casting could still appear to work but movement failed because the realtime `GameLoop` only lived in memory.
2. Long battles could keep growing `state.events`, increasing DB payloads, WebSocket diff/index drift risk, and frontend render work.
3. New `化劲` stat needed to reduce final damage after the existing damage calculation.
4. `蛊虫献祭` needed a 35% max-HP cast gate instead of a flat 35 HP gate.

**Fix**:
- Added a shared `ensureBattleLoop()` runtime helper that hydrates a missing `GameLoop` from persisted `GameSession.state` when the tournament is in `BATTLE`, then used it from snapshot, movement, pickup, and cast/cancel paths.
- Bounded realtime event history in `GameLoop` by periodically replacing `/events` with a trimmed recent window, and changed BattleArena floating combat text to track processed event IDs instead of array length.
- Added `huajinPct` to player state, stat presets, C-panel display, and combat math. Scheduled damage now applies 化劲 at the final damage step after crit and existing reductions.
- Added `minSelfHpPercentExclusive` ability metadata and validation, exposed it through preload, and switched `蛊虫献祭` to require current HP greater than 35% max HP.

**Lessons**:
- Any route that requires an active realtime loop must either hydrate that loop from the saved battle state or fail after a process restart even though the DB snapshot still exists.
- Event consumers should identify events by stable IDs, not array length. Once the server trims or replaces history, length-based detection can miss new events written into reused indexes.
- Percentage HP gates need explicit metadata instead of overloading flat HP gates; otherwise large HP pools silently turn old flat thresholds into meaningless requirements.


## 131. Haste stat and timing acceleration (2026-05-06)

**Problem set**:
1. 新增展示属性 `加速率 23.54%`，但实际时间缩短量独立为 `16.2%`。
2. 加速需要影响正读条、逆读条、以及 DOT 的总时间和每跳间隔，且不能误改普通控制 / 普通增益时长。
3. 需要一个 Ability Editor 判定页，让部分技能可明确设置为不受加速。

**Fix**:
- 新增 `engine/utils/haste.ts`，集中保存展示值、实际时间缩短系数，以及读条 / 周期 Buff 的时间缩放 helper。
- 正读条和 active reverse channel 在 `playService.ts` 创建 `activeChannel` 时缩短 `durationMs`，并给连环弩这类 active reverse channel 传递加速后的 `tickIntervalMs`。
- DOT 与 buff-based reverse channel 在 `addBuff()` 统一入口缩短 `durationMs` 和 `periodicMs`，因此普通无周期控制 Buff 不会被加速误伤。
- BattleArena C 面板显示 `加速率 23.54%`，并让 active reverse channel bar 使用后端下发的加速后 tick interval。
- 新增 `hasteUnaffected` ability property、后端 `/ability-editor/haste-unaffected` 路由，以及前端 `不受加速` 三列判定页。该字段会进入 resolved ability，运行时加速 helper 会直接跳过它。

**Lessons**:
- 加速的显示数值和实际缩短系数必须分开建模；把 `23.54%` 直接拿去当时间缩短量会让平衡数值漂移。
- 对 DOT/逆读条这类周期效果，最稳的落点是创建时同时缩放总时长和 `periodicMs`，而不是在 GameLoop 每跳临时折算。
- 任何“该技能不吃某个全局机制”的需求，优先复用 Ability Editor 的 tri-state property override；这样详情页、批量页、preload 和运行时 resolved ability 会自然保持一致。

**Follow-up (later same day)**:
- `不受加速` 的批量页文案已改成更准确的 `读条不受加速影响`，因为当前规则真正影响的是正读条、逆读条和相关周期读条节奏，不是所有技能都需要做这个判定。
- 这个批量页真正需要收紧的是 `未决定` 列，而不是整份 snapshot。给共享 decider 组件增加“只在未决定列显示 `CHANNEL` 技能”的开关，能保留已有手动覆盖项，同时把待决策列表压回到真正有读条的技能。
- 直接用 resolved `ABILITIES` 做一次 runtime audit 最稳：本轮检查了全部 `29` 个 `CHANNEL` 技能，确认它们都带有 `FORWARD` 或 `REVERSE` 的 channel mode，没有漏标的读条技能。


## 132. Defense stat and combat display updates (2026-05-05)

**Problem set**:
1. 防御力 needed to reduce base damage before the existing crit and damage-reduction pipeline.
2. The crit preset buttons needed matching 防御力 presets.
3. 韦陀献杵 should modify 防御力 multiplicatively rather than acting as direct damage taken/DR.
4. Combat floats and the C-key stats panel needed clearer numeric display.

**Fix**:
- Players now carry `defensePct`, and combat math applies final 防御力 to base damage before existing target-side damage taken / DR modifiers and crit resolution.
- Added `DEFENSE_MULTIPLIER` Buff effects so 韦陀献杵易伤 uses `0.9x` defense and 韦陀献杵防御 uses `1.1x` defense.
- The four preset buttons now set crit/defense pairs of `0/0`, `20/12`, `30/16`, and `40/23`.
- Floating damage text uses two fixed decimals, and the C-key stats panel now shows 最大气血值, 防御力, 闪避, 移动速度, and DR in addition to crit stats.

**Lessons**:
- Base stats like 防御力 should be resolved before higher-level damage modifiers, while Buff changes to that stat should multiply the original stat instead of being treated as additive DR.


## 133. 渊落点修正 + 雾暗迷云混乱重定向 (2026-05-03)

**Problem set**:
1. `渊` 友方 dash 之前会直接落到目标身上，没有保持和 `龙牙` 一样的 `1尺` 停距。
2. 需要新增 `雾暗迷云`：站立运功 `1.5s` 后给目标 `【迷云】`，目标在 `迷云` 期间释放技能时会重新随机目标且不分敌我；`迷云` 消失后还要获得 `20s` 的 `【雾释】` 免疫。
3. 这次的“混乱”不能只修单体技能。用户明确要求多段/多目标 AOE 也要按“原本会命中的每一个敌方命中槽位，分别独立重掷一次合法目标”处理，例如 `风来吴山` 每一跳都应独立 `50/50`。
4. 旧代码的目标判定散在 `validateAction.ts`、`playService.ts`、`immediateEffects.ts`、`GameLoop.ts` 多个层面；如果在其中一层硬写特殊分支，很容易让单体、延时、channel tick、zone tick 表现不一致。

**Fix**:
- `渊` 的友方 dash 现在复用了和 `龙牙` 同样的停距计算：先算 `1尺` stop distance，再按缩短后的 travel distance 设置 dash 速度，因此落点稳定停在目标前 `1尺`，而不是重叠。
- 新增 `backend/game/engine/utils/miyun.ts` 作为共享混乱辅助层，集中放 `迷云/雾释` Buff 常量、混乱/免疫判定，以及“按原命中槽位数量重新随机候选目标”的 area reroll helper。
- `validateCastAbility(...)` 现在会在施法者带 `迷云` 时递归复用自己去枚举合法候选目标，再随机选出一个 resolved target 返回给 `playService.ts`。这样现有射程、最小距离、朝向、LOS、特殊技能约束都会自动复用，而不是重写第二套验证逻辑。
- `playService.ts -> applyEffects(...) -> applyAbilityBuffs(...)` 整条链路新增了 `ignoreTargetAllegiance / forceEnemyApplied` 上下文，所以“原本是敌方技能但被混乱改打到友方”或“原本是友方技能但被混乱改打到敌方”时，伤害/控制/增益仍保持原技能的敌我语义，而不是被目标阵营反向篡改。
- `immediateEffects.ts` 的显式玩家/实体目标 helper 已放宽到支持混乱后的 player/entity 目标；即时 AOE、扇形 AOE、多段即时伤害现在都会按“先算原本会打中的敌方槽位数，再对每个槽位独立 reroll 候选目标”处理。
- `GameLoop.ts` 中的 dash-end AOE、channel tick、periodic AOE、地面 zone 爆炸/持续伤害也切到了同一套 reroll 语义；其中 `CHANNEL_AOE_TICK` 额外保留了原本的 LOS 检查，只在 LOS 合法候选集内随机，避免把混乱目标选到被墙挡住的位置。
- `雾暗迷云` / `迷云` / `雾释` 已写入 `abilities.ts` 和 `cards.ts`。当前落地参数是：技能射程 `20`、冷却 `300 ticks`、`迷云 8s`、`雾释 20s`。这是因为用户只明确给了 channel 时长和 `雾释` 时长，其余数值本轮先按现有技能常用档位补齐。
- `buffRuntime.ts` 现在会阻止带 `雾释` 的目标再次吃到 `迷云`，并在 `迷云` 自然结束或被提前移除时统一补上 `雾释`。`GameLoop.ts` 也顺手补了 channel-complete buff 对 entity target 的支持，避免这类读条完成型 debuff 只对 player 生效。

**Lessons**:
- 对“混乱改目标”这类需求，最稳的 seam 不是某个具体技能 handler，而是验证层返回“resolved target”。先在验证层把合法候选集合算准，后面的施法/即时效果/读条完成逻辑只消费 resolved target，就不会在每个技能里散落重复判断。
- 多目标混乱不能直接把初始目标列表改成“全场所有单位”。正确语义是先保留原本会命中的敌方槽位数，再让每个槽位独立 reroll；否则像 `风来吴山` 这种多跳技能会连总命中次数都一起漂移。
- 这轮 PM2 重启后的 backend/frontend 都成功上线了最新 build，但日志里仍能看到旧的 `backend-error.log` `GameLoop not active` 噪音，以及 frontend 旧的 `.next/prerender-manifest.json` `ENOENT` 记录。它们不是这次改动引入的新启动失败，后续排查日志时要和本轮功能回归分开看。

**Follow-up fixes (later same day)**:
- 单体 `迷云` 重定向第一次上线后，递归候选枚举虽然已经用 `ignoreTargetAllegiance: true` 放宽了敌我限制，但外层最终 `validateCastAbility(...)` 仍按原始敌方规则再次校验，导致“随机到友方后又被 `ERR_TARGET_UNAVAILABLE` 否掉”。修复方式不是再跳过一整段验证，而是把 `miYunRetarget !== null` 也视作最终外层校验的 allegiance-bypass 条件，仅绕过敌我归属判定，继续保留射程/最小距离/LOS/朝向等其他规则。
- `迷云 -> 雾释` 没有生效的根因不是 `pushBuffExpired(...)` 内的加 Buff 逻辑，而是 `GameLoop.ts` 的主自然过期 sweep 只删除了过期 Buff，却没有为这些自然过期 Buff 调 `pushBuffExpired(...)`。现在 player/entity 两条自然过期路径都会统一发出 `BUFF_EXPIRED`，因此 `迷云` 自然结束或实体上的 `迷云` 自然结束时，都能走到同一条 `雾释` 补发逻辑。
- 这次还顺手把 `buffsChanged` 判定补成了“只要有自然过期就算变化”，避免“一个 Buff 自然结束、同时立刻补上另一个 Buff，导致总 Buff 数量刚好不变”时，状态变更没有被及时广播。

**Latest follow-up (same day)**:
- 用户随后明确要求 `雾释` 不是增益而是减益，因此已把 `雾释` 在 `abilities.ts` 和 `cards.ts` 中的 `category` 从 `BUFF` 改为 `DEBUFF`。它的免疫效果类型仍保持 `MIYUN_IMMUNE`，只改状态栏/展示侧的类别语义。
- 还对当前 preload Buff 表做了一次全量图标审计，按真实运行时 `buff.iconPath` 与 `frontend/public/icons` 比对后，发现仍缺 `32` 个 Buff 图标或图标映射：`散流霞隐藏`、`穹隆化生·转向`、`踏星行·转向`、`摩诃无量·眩晕`、`生太极·迟滞`、`被击不会解除五方锁足`、`沧月·击退`、`亢龙有悔·定身`、`龙啸九天·定身`、`龙啸九天·击退`、`韦陀献杵·易伤`、`韦陀献杵·防御`、`鹤归孤山·震慑`、`穿心弩·减疗`、`三才化生·前半保护`、`如意法·待发`、`龙战于野·被拉`、`守缺式·击退`、`无相诀·五十/六十/七十/八十/九十`、`破势`、`九转击退`、`被拉`、`锁足抗性`、`眩晕抗性`、`锁招抗性`、`定身抗性`。其中 `无相诀` 五档不是单纯缺文件，而是当前 preload override 仍指向不存在的 `/icons/无相.png`，而仓库里实际存在的是 `无相诀.png` 与各档 `无相诀·*.png`。


## 134. 凌然天风特殊跳跃实现 (2026-05-03)

**Problem set**:
1. 新轻功 `凌然天风` 需要可移动中/空中施放，施放时上跳 `9尺/1秒`，并附带 `7秒` 特殊跳跃 Buff。
2. Buff 期间要禁用普通跳跃，但保留地面正常移动；特殊跳跃次数是独立 `0/1` 资源，不受 `扶摇直上 / 梯云纵 / 鸟翔碧空` 这类跳跃强化影响。
3. 特殊跳跃本身需要两种形态：纯空格 `4尺` 竖直跳，`W/A/S/D + 空格` 则在 `1秒` 内走完整个 `4尺上升 + 8尺定向位移` 弧线。
4. Buff 本身只免疫普通控制，不免疫拉拽/击退；并且 Buff 期间任意成功施放招式都要把特殊跳跃次数回满到 `1`。
5. 这次是 movement 改动，BattleArena 不能继续本地预测成普通跳，否则客户端会在 Buff 期间错误地显示常规起跳。

**Fix**:
- 新增 `LING_RAN_TIAN_FENG_CAST` 与 `LING_RAN_TIAN_FENG_STATE` 两个 effect 类型；能力定义里用前者做施放上跳，用后者做 Buff 状态标记。
- `abilities.ts` 中新增 `ling_ran_tian_feng`：`300 ticks` CD、`qinggong: true`、`7s` Buff，Buff 效果为 `CONTROL_IMMUNE`、`RANGE_BOOST +5` 和 `LING_RAN_TIAN_FENG_STATE`。
- `applyImmediateEffects(...)` 在成功施放结算时统一处理特殊跳跃充能：如果施法者当前有 `凌然天风` Buff，或当前施放的就是 `凌然天风`，则把 `lingRanTianFengCharges` 设为 `1`。这样“施放任意招式回满一次跳跃”落在共享施法成功 seam，而不是散落到每个技能里。
- `凌然天风` 施放本体复用了现有 `activeDash` 竖直位移路径：不加共享 dash runtime buff，只创建 `1秒` 纯竖直 activeDash，因此控制免疫完全来自 `凌然天风` Buff 本身。
- `movement.ts` 在普通跳跃入口前先检查 `LING_RAN_TIAN_FENG_STATE`。Buff 期间：
  - 有充能时，空格改为启动一个 `1秒` 的弧线 activeDash（固定 `4尺` 峰值，定向时再带 `8尺` 水平位移），并消耗充能到 `0`。
  - 没充能时，空格直接失效，不会落回普通跳跃逻辑。
- 由于特殊跳跃走的是 activeDash，而不是原本 jump/air-nudge 分支，所以不会吃到 `JUMP_BOOST`、`TI_YUN_ZONG_JUMP`、`MULTI_JUMP`、`JUMP_NERF` 这些普通跳分支里的高度/距离改写。
- BattleArena 侧没有再去本地伪造第二套特殊跳轨迹，只做了必要的 prediction 对齐：Buff 生效时本地空格不再进入普通 jumpLocal 预测，而是只发送 jump 输入并等待服务端的 activeDash 状态接管，这样不会在 Buff 期间错误显示普通跳。

**Lessons**:
- 当一个“特殊跳”既要固定轨迹、又要允许中途施法、还要完全绕开普通跳跃增益时，直接复用 `activeDash` 比往普通 jump 分支里塞更多例外更稳。
- 对这类 Buff 驱动的独立位移资源，最稳的“回充”位置是共享施法成功 seam；如果把回充逻辑分别写进单个技能 handler，后续一定会漏掉自定义 effect 或空 effect 技能。
- 前端 prediction 不一定非要完整本地复刻轨迹。只要客户端别在 Buff 期间错误走进旧的普通跳预测，而服务端又能很快下发 `activeDash`，就已经比“错误预测成普通跳”更可靠。

**Follow-up retune (later same day)**:
- `凌然天风` 本体现在 `gcd: false`，不会再占用公共调息。
- 初始施放上跳进一步改成 `12尺/0.5秒`，并同步了能力说明与 cast handler 的默认值。
- 特殊跳再改为“`1秒` 到达 `4尺上升 + 8.7尺定向位移` 的终点后，再交回普通下落”。实现上仍然不让这段 activeDash 在持续时间内自己落回地面，而是让它在结束时正好到达 apex，然后由正常重力继续下落。

**Extra lesson from retune**:
- 如果设计要求的是“在指定位移时间点到达顶点，然后再自然下落”，dash 内的竖直速度不能按完整抛物线总时长去算；应当按“结束时速度归零、位置到顶点”来反推离散重力和初速度，否则会错误地在 dash 持续时间内把下落也一起算进去。

**Latest follow-up retune (same day)**:
- 初始施放上跳再次下调为 `9尺/0.5秒`。
- 特殊跳拆成了两条运行时分支：纯空格上跳现在是 `8尺/0.5秒`；带方向的特殊跳仍保持“`1秒` 到达 `4尺上升 + 8.7尺定向位移` 终点后再自然下落”。
- 如果玩家在 `凌然天风` 初始上跳过程中进入 `九霄风雷` 的初始 `3秒` 运功，竖直 activeDash 现在会被刻意维持到运功结束，再立刻结束这段上升，复现旧 bug 的趣味交互。最终实现没有继续依赖“原始 activeDash 一定还在”，而是在 `九霄风雷` 开始运功时把这段上升记录到 `PlayerState` 上；这样即使中途有别的路径清掉了 dash，`movement.ts` 也会在运功期间把竖直上升补回去。
- `凌然天风` Buff 期间新增“跳跃锁定免疫”：通用 channel jump suppression、`风来吴山` / `斩无常` 的旧硬锁、`九霄风雷` 的 `NO_JUMP`，以及 `channelLockMovement` 对 jump 脉冲的清零，都不会再拦住这次跳跃；BattleArena 的本地发包门槛也同步放开。
- 如果同时持有 `凌然天风` 与 `风来吴山 / 斩无常` Buff，使用一次 `凌然天风` 特殊跳后会立刻把特殊跳次数回满到 `1`。BattleArena 也同步改成在这两个 Buff 下不把本地特殊跳次数预扣到 `0`，避免客户端短时间误判“没次数”。

**Disproved approach from latest retune**:
- 先前直接把 `凌然天风` 特殊跳的共享常量整体改成 `8尺/0.5秒` 会连带把定向特殊跳也一起改快，和用户“只改 special upward jump”的要求不符。最终必须按“有无方向输入”拆成两套高度/时长参数。
- 单纯在 `movement.ts` 里冻结原始 `凌然天风` cast-lift dash 的 `ticksRemaining` 还不够稳，因为一旦别的控制路径提前清掉了那段 dash，`九霄风雷` 期间就会重新表现成“正常停止上升”。要复现这个旧 bug，必须把“当前正在延续的上升速度”单独记到玩家状态上，而不是只依赖原始 dash 对象仍然存在。


## 135. 御骑 mounted runtime (2026-05-03)

**Problem set**:
1. `御骑` 之前只是一个占位 common skill，没有真正的“上马 / 下马”运行时状态，也没有任何 mounted 限制。
2. 需求是双态技能：未上马时必须站立运功 `3s`，移动或跳跃会打断；已上马时再次施放应立刻下马，而不是再走一次读条。
3. 上马后要同时满足三条运行时规则：移动速度 `+100%`、只能施放带“可以马上施展”标记的招式、每次腾空最多只保留 `1` 次跳跃。
4. `御骑` 获得时要立刻移除 `弹跳(JUMP_BOOST)`；受到除 `ROOT/SLOW` 以外的控制时，要立即失去 `御骑`。
5. 这是 movement / cast-rule 变更，BattleArena 也必须同步 mounted 灰置与跳跃上限，否则前端会继续把非法招式点亮，或者本地多给一次跳跃。

**Fix**:
- 把 `yuqi` 从占位 instant skill 改成了真实 pure channel：未上马时 `requiresStanding + channelDurationMs: 3000 + channelCancelOnMove/jump`，运功完成后通过 `applyBuffsOnComplete` 获得长期 `【御骑】` Buff。
- `playService.ts` 为 `yuqi` 增加了 mounted toggle-off 分支：如果玩家当前已有 `御骑` Buff，再次施放不会重新开读条，而是直接移除 `御骑`（并为后续 linked buffs 预留统一清理路径）。
- 新增共享 mounted helper 后，`validateAction.ts` 会在服务端统一拦截“上马状态下但没有 `canCastWhileMounted` 标记”的招式；`yuqi` 自己则特判为 mounted 下仍可施放，并忽略 `requiresStanding` 这条进入态约束。
- `buffRuntime.ts` 把 mounted 相关副作用收口到了 Buff seam：`御骑` Buff 成功加上后会清掉所有 `JUMP_BOOST` Buff；如果之后吃到 `CONTROL / ATTACK_LOCK / KNOCKED_BACK / PULLED / SILENCE / DISARM / NON_QINGGONG_LOCK / FEARED` 这类实际生效的控制，则会立刻把 `御骑` 状态移除。
- `movement.ts` 与 `BattleArena.tsx` 都改成“若当前有 `御骑`，有效最大跳跃数恒为 `1`”；客户端 readiness 也新增了 mounted 灰置规则，只保留 `canCastWhileMounted` 招式亮起，并允许 `御骑` 自己在空中立即下马。

**Lessons**:
- 这种“进入态是读条、退出态是瞬发”的技能不要硬塞进单一 channel 行为里；让 channel 只负责进入态，再在 cast service 里为退出态做一个极小 special-case，整体比拧 channel pipeline 更稳。
- `御骑` 的限制不是单一 movement 规则，而是 cast validation、buff apply/remove、副作用清理、前端按钮灰置、跳跃上限的组合。只补其中一层，玩家立刻就会看到“按钮能点但服务器报错”或“本地还能二段跳”这类明显不同步。


## 136. 御骑高度 / 跳跃限制 follow-up (2026-05-03)

**Problem set**:
1. 新需求要求 `御骑` 进入时角色立刻抬高 `3尺`，因为没有马匹模型，视觉上就让角色悬空代替坐骑高度。
2. 如果只在上马瞬间做一次 `z += 3尺`，下一帧重力就会把角色重新拉回地面，看不到持续的“骑在马上”。
3. 上马时如果角色身上还有 `女娲补天`，需要立刻移除；`任驰骋` 则不应再允许在已上马状态下施放。
4. 骑乘期间要禁用原地跳和后跳，只保留前/左/右方向跳跃；这次也是 movement 变更，BattleArena 不能继续预测成普通原地跳。
5. `下马` 仍要允许在移动中或空中施放，不能被前端那层旧的 `requiresStanding` 提前挡掉。

**Fix**:
- `movement.ts` / `BattleArena.tsx` 都新增了“mounted ground height”概念：只要当前有 `御骑`，有效地面高度就等于真实地面 `+3尺`。这样角色会稳定站在悬空高度上，而不会被下一帧重力直接拉回去。
- `buffRuntime.ts` 在 `YUQI_BUFF_ID` 成功加上时会立刻把玩家高度再抬高一次，保证上马当帧就能看到抬升，而不是等下一个 movement tick 才浮起来。
- 同一个 `addBuff()` seam 里顺手移除了 `女娲补天`（buff `1019`），这样 `御骑` 无论来自原始 `御骑` 还是 `任驰骋`，都会统一清掉该状态。
- `任驰骋` 去掉了 `canCastWhileMounted`，因此它现在只能在未上马时读条进入，不能在已经 `御骑` 的状态下重放。
- 普通跳跃分支新增了 mounted jump gate：骑乘时必须存在方向输入，且方向不能是 rearward；BattleArena 本地发跳和本地 jump prediction 也同步改成拒绝 `空格原地跳` 与 `S` 系后跳。
- BattleArena 之前还有一层更早的客户端施法门槛，会在点按钮时直接按 `requiresStanding` 拦掉 `御骑`。这次给 mounted `yuqi` toggle-off 加了同样的例外，所以移动中/空中都能正常下马。

**Lessons**:
- “坐骑高度”这类长期悬空状态不能靠一次性位置抬升实现；真正稳定的做法是把它建模成一层持续存在的有效地面偏移。
- 如果某个技能已经在 `isAbilityReady(...)` 里有特判，不代表前端别的 cast wrapper 也同步了。同一个 `requiresStanding` 规则很可能在多个按钮入口重复实现，必须一起排查。

**Latest retune (same day)**:
- 用户随后又明确要求取消这层“骑在马上”的悬空视觉，所以之前那套 `mounted ground height + addBuff 立即抬升 + BattleArena 同步地面偏移` 已被整段移除；`御骑` 现在重新回到普通地面高度。
- `御骑` 的移动速度也从原先的 `+100%` 改成了 `SLOW 0.5`，最终速度等于普通角色按 `S` 后退步行的速度；前后端原有的 `1 + SPEED_BOOST - SLOW` 速度计算公式因此无需额外特判。

**Extra lesson from retune**:
- 一旦这种“手感型”需求被撤回，最好把整条实现链一次删干净，而不是只改掉其中一层。否则很容易留下 buff 抬高、服务端地面判定、客户端 prediction 三者里某一层的残余偏移。


## 137. 任驰骋 + 纵轻骑 mounted follow-up (2026-05-03)

**Problem set**:
1. 需要新增 `任驰骋`：`0.5s` 运功、可移动、跳跃会打断，完成后同时获得 `御骑`、`任驰骋` 和 `纵轻骑` 三个 Buff。
2. `任驰骋` Buff 要持续 `12s` 并给 `15%` 伤害提升；`纵轻骑` 要持续 `5s`，提供“控制免疫但仍会被拉”的 mounted 爆发窗口。
3. `纵轻骑` 的“仍会被拉”不能复用现有 `KNOCKBACK_IMMUNE`，因为那个效果会把 `击退` 和 `拉拽` 一起挡掉。
4. 用户还要求“离开御骑时一定移除 `纵轻骑`，但不能误删 `任驰骋`”。这意味着不能只在手动下马分支里清理一次。

**Fix**:
- 在 `abilities.ts` / `cards.ts` 中新增 `ren_chi_cheng`：`CHANNEL` 自身技能，`0.5s` 运功，`channelCancelOnMove: false`、`channelCancelOnJump: true`，结算后一次性应用 Buff `2741/2742/2743`。
- `任驰骋` Buff (`2742`) 使用 `DAMAGE_MULTIPLIER 1.15`，不是 `0.15`。这个引擎里乘区字段存的是最终倍率，不是增量。
- 为了实现“免击退但不免拉”，新增了狭义效果类型 `KNOCKED_BACK_IMMUNE`，并把纯击退路径（立即击退、慢速击退、连环弩近身击退等）切到新的 guard；拉拽/换位等仍继续只认完整的 `KNOCKBACK_IMMUNE`。
- `buffRuntime.ts` 也同步改成分别过滤 `KNOCKED_BACK` 和 `PULLED`，避免 `纵轻骑` 被当成完整免拉。
- `GameLoop.ts` 新增 mounted invariant：只要玩家当前已经没有 `御骑`，就会主动清掉残留的 `纵轻骑` 并发 `BUFF_EXPIRED`。这样无论是手动下马、吃控制掉马，还是其他路径让 `御骑` 消失，都不会留下悬空的 `纵轻骑`。

**Lessons**:
- 当设计写的是“免击退但仍会被拉”，不要在现有效果上硬加特判；加一个语义更窄的 immunity type，然后只替换真正的击退 call-site，成本更低，也不容易误伤拉拽逻辑。
- 对“依附于另一状态存在”的 Buff，最稳的做法不是只信任几个显式移除入口，而是在主循环里补一条廉价 invariant。这样后续出现新的移除路径时，子 Buff 也不会残留。

**Latest retune (same day)**:
- 后续实测发现 `channelDurationMs: 500` 本身不会让技能自动进入运功；当前引擎只有 `ability.type === "CHANNEL"` 才会在 `playService.ts` 里创建 `activeChannel`。因此 `任驰骋` 必须从 `SUPPORT` 改成真正的 `CHANNEL`，前端运功条才会出现，技能也才不会继续表现成瞬发。


## 138. 龙啸九天气场/机关摧毁 + 人剑合一气场联动 (2026-05-02)

**Problem set**:
1. `龙啸九天` needed a new effect on top of its current self-cleanse / self-buffs / AOE knockback package: destroy enemy `气场` and `机关` within `6尺`.
2. In the current zone model, the relevant `气场` are the ground zones from `生太极 / 吞日月 / 镇山河 / 破苍穹 / 碎星辰 / 凌太虚 / 冲阴阳`; the only current `机关` zone is `天绝地灭`.
3. Destroying a zone early must stop all future zone effects immediately, including `天绝地灭`'s explode-on-expire behavior, and must also clear any zone-granted runtime buff that would otherwise linger forever after the zone disappears.
4. A new ability `人剑合一` was requested: destroy `13尺`内气场; if any destroyed气场 belonged to the caster, then enemy players within `13尺` gain `【破势】5秒：定身`.

**Fix**:
- Added shared immediate-effect helpers in `immediateEffects.ts` to classify current `气场/机关` ground zones, destroy them by range/ownership, and clear the specific zone-tied runtime buffs that otherwise would not self-clean if the source zone vanished early.
- Extended `龙啸九天` so its existing `LONG_XIAO_JIU_TIAN_AOE` handler now destroys enemy-owned `气场` and `天绝地灭` within `6尺` before applying the old AOE damage + knockback. Tooltip text in `abilities.ts` was updated to match.
- Added new ability `人剑合一` in `abilities.ts` as a self-cast control skill with custom effect `REN_JIAN_HE_YI_AOE`, plus buff `2735` `【破势】`.
- Implemented `REN_JIAN_HE_YI_AOE` in `immediateEffects.ts` by destroying all nearby `气场`, counting whether any destroyed one was friendly, and only then applying `【破势】` to nearby enemy players. `人剑合一` was excluded from generic `applyAbilityBuffs(...)` so the debuff is only applied conditionally.
- Registered the new effect type in `state/types/effects.ts` and `effects/definitions/categories.ts`, and added a `纯阳 / 外功 / 卓越` editor tag entry in `ability-property-overrides.json`.

**Lessons**:
- Ground-zone destruction is not just `state.groundZones = filter(...)`. Several current zones grant persistent buffs in `GameLoop` that only clean up on leave/zone tick; if the zone is removed out-of-band, those buffs must be explicitly expired too.
- Reusing one destruction helper for both enemy-only (`龙啸九天`) and mixed-ownership (`人剑合一`) cases keeps ownership semantics local and avoids duplicating the qi-field list in multiple handlers.
- New abilities and buffs also need art plumbing. No icon assets currently exist for `人剑合一` or `破势` under `frontend/public/icons`, so the mechanic is live but the ability icon still needs art to avoid a missing-image button in the frontend.


## 139. A local hard-snap branch must update both localPositionRef and localRenderPosRef, or instant swaps still look like movement (2026-05-01)

**Problem**: 斗转星移 still looked like the local player sliding to the swapped position even after the cast-specific snap marker was fixed. The opponent already snapped, but the local player could still fall into the old 1500ms cosmetic dash easing.

**Fix**:
- In BattleArena reconciliation, the `dx * dx + dy * dy > 25` "hard-snap" branch was running before the 斗转 instant-swap branch, but it only updated `localPositionRef`.
- Updated that branch to also snap `localRenderPosRef`, clear `localDashAnimRef`, and reset local Z velocity so large authoritative corrections no longer visually animate.

**Lesson**: In this frontend, `localPositionRef` is only prediction state. If a branch is supposed to be a real visual snap, it must also update `localRenderPosRef`; otherwise the render loop can still animate stale-to-new movement even though the logic path says "hard-snap".


## 140. Instant backend swaps can still look like travel if opponent character rendering keeps an unconditional lerp (2026-05-01)

**Problem**: 斗转星移 was already an instant authoritative position swap on the backend and the local player had a snap window, but the swap could still look like a pull because enemy models in `Character.tsx` always lerped toward their new prop position.

**Fix**:
- Added a short instant-snap window for opponent `Character` instances and passed the existing 斗转 cast timestamp through `ArenaScene` so the swapped target model stops lerping during that window.

**Lesson**: For instant movement skills, do not only patch the local-player reconciler. Any separate opponent/observer render path with unconditional smoothing can reintroduce fake travel even when the authoritative state already snapped.


## 141. Repositioning from one distance band to the same distance band should use circle intersections, not perpendicular shortcuts (2026-05-01)

**Problem**: 云散's first side-step implementation worked when the caster needed to move outward to the 17-18尺 band, but it broke when already at that band because the perpendicular-offset math collapsed to zero movement and could select the current position.

**Fix**:
- Replaced the side-step branch with a circle-intersection solver: destination must be 17-18尺 from the target and 10-12尺 from the current caster position.
- Tried left/right intersections in priority order and then reused the existing collision, arena-bounds, and target-LOS validation on the resulting candidate.

**Lesson**: When movement has two simultaneous geometric constraints like "end on this ring" and "travel this far," solve the actual geometry. Ad hoc perpendicular offsets are brittle at the boundary cases and can easily degenerate to zero-distance moves.


## 142. Instant swaps and forced pulls should use different client/runtime signals even if they share pull-immunity checks (2026-05-01)

**Problem**: 龙战于野 and 斗转星移 both touch displacement rules, but they broke in opposite ways: 龙战于野 reused a declared debuff on a `SELF` ability and leaked that debuff onto the caster through generic buff application, while 斗转星移 already swapped positions instantly on the backend but still looked like a pull because the local player reconciler smoothed short teleports.

**Fix**:
- Excluded 龙战于野 from `applyAbilityBuffs` and moved its victim movement onto `applyDashRuntimeBuff()` so forced pull uses the standard displacement runtime state instead of a custom self-leaking debuff.
- Kept 斗转星移 as an instant authoritative position swap with the same `KNOCKBACK_IMMUNE` cast gate, but added a short local snap window in BattleArena so the caster does not cosmetically lerp through the swap.
- Added 守缺式 as a custom-effect charge ability because it needs one self-buff declared in `buffs[]` plus a separate manually-applied knockback buff that only exists on the empowered follow-up cast.

**Lesson**: In this repo, `KNOCKBACK_IMMUNE` is the shared cast gate for pull-like mechanics, but the movement presentation still needs to match the mechanic. Forced pulls should use Dash Runtime / displacement state; instant swaps should not, and the frontend must be told to snap instead of smoothing them.


## 143. In React render scope, do not derive from a state variable before that state is declared (2026-04-30)

**Problem**: BattleArena crashed on load with `ReferenceError: Cannot access '<minified name>' before initialization` immediately after the Hong Meng overlay changes.

**Root causes**:
- A derived constant for the overlay visibility was declared before the `blueprintMode` state that it referenced.
- `const` bindings in component render scope still obey temporal dead zone rules, so the entire render crashed before WebSocket or Three.js could stabilize.

**Fix**:
- Moved the derived `hongMengOverlayActive` flag below the `blueprintMode` state declaration.

**Key lesson**: In large React components, treat render-scope derived flags like ordinary `const` variables. If they read from a state variable or later `const`, they must be declared after that dependency or the runtime will hard-crash in production.


## 144. For blackout effects, keep the blackout and self-only layers mounted so activation does not flash or hide self (2026-04-30)

**Problem**: The initial solid-black plus self-only overlay still behaved poorly on activation: the blackout could appear before the self layer was ready, and the self-only layer could inherit local camera fade behavior.

**Root causes**:
- Conditionally mounting the blackout/self overlay layers on buff activation introduces timing artifacts because the blackout becomes visible before the second canvas has rendered the avatar.
- Reusing the local character renderer without disabling camera fade lets the self-only layer fade the avatar out, which defeats the point of keeping self visible above blackout.

**Fix**:
- Kept both Hong Meng overlay layers mounted at all times and toggled them with visibility/opacity instead of mounting them on demand.
- Forced the self-only overlay canvas to clear with alpha 0 and disabled camera-fade behavior for the self-only render path.

**Key lesson**: For "black screen but still see self," treat blackout and self-render as persistent layers. Do not mount them lazily at effect start, and do not let the self-only layer reuse fade rules meant for the normal camera-clipping case.


## 145. A blackout hole reads like a spotlight; if only self should remain, render self above a solid blackout instead (2026-04-30)

**Problem**: A tracked transparent hole around the player technically preserved self during 鸿蒙天禁, but visually it looked like a spotlight cutout in the middle of the screen, which was not the intended effect.

**Root causes**:
- A hole in the blackout exposes everything inside that region, including leftover ground color and surrounding scene context, so the effect reads as "looking through a tunnel" instead of "the screen is black except self."
- The requirement was not to reveal an area around the player; it was to keep only the player visible.

**Fix**:
- Removed the tracked hole from the blackout overlay.
- Kept the blackout fully opaque and added a separate transparent overlay canvas that renders only the local character above the blackout and below HUD/UI.

**Key lesson**: If the effect should keep only the avatar visible, do not punch a hole through the blackout. Use a solid blackout and re-render the avatar in a higher visual layer.


## 146. If off-map space is still visible, scene hiding is not enough; add a viewport blackout layer (2026-04-30)

**Problem**: Hiding terrain, GLBs, and other actors was not enough for 鸿蒙天禁 because the player could still see the yellow off-map background outside the exported map. The requirement was to cover the screen, not just remove world meshes.

**Root causes**:
- Scene-layer hiding only affects known world render layers; it does not cover empty or off-map canvas space.
- A plain fullscreen blackout would cover the local character too, which conflicts with the requirement to keep self and HUD visible.

**Fix**:
- Kept the scene-layer hiding for world content, but added a fullscreen blackout overlay above the canvas and below HUD/UI.
- Preserved self with a separately rendered self-only layer above the blackout rather than trying to reveal a window through the blackout.

**Key lesson**: When the requirement is "cover the screen except self and UI," scene hiding alone is insufficient. Cover the viewport explicitly, then solve self visibility in a separate higher layer.


## 147. If the player should still see self and HUD, blind the world at the scene layer instead of painting over the viewport (2026-04-30)

**Problem**: The fullscreen blackout solved "hide everything" too literally. The user only wanted terrain / house GLBs / other players-NPCs gone, while still seeing their own character and all UI.

**Root causes**:
- A viewport-wide black overlay has no notion of self-vs-world separation, so it inevitably hides the local character along with the terrain.
- In collision-test, the exported map renderer also owns pointer raycasts, so simply removing the whole map component would risk breaking ground targeting.

**Fix**:
- Removed the fullscreen blackout overlay from `BattleArena.tsx`.
- Added a local blind-world mode that blacks the canvas background, keeps self rendering, filters out other actors as before, and tells `ArenaScene` / `ExportedMapScene` / `Ground` to hide only world visuals while keeping pointer-hit surfaces active.

**Key lesson**: When an effect should hide the world but not the player avatar or HUD, solve it where the world layers are composed. A scene-layer visual gate is the right abstraction; a fullscreen overlay is too blunt.


## 148. A JSX overlay inside an event callback is dead code even if the file still compiles (2026-04-30)

**Problem**: The 鸿蒙天禁 blackout effect was authored, but the user still could not see any blackout at runtime.

**Root causes**:
- The blackout JSX block had accidentally been inserted inside the `onSelectTarget` callback body on `ArenaScene` instead of as part of the returned render tree.
- React happily compiled that as an unused expression statement inside a function body, so the build stayed green while the overlay never rendered.

**Fix**:
- Moved the blackout `<div>` out of the callback and into the actual `BattleArena` render tree as a sibling above the canvas wrapper.

**Key lesson**: When a visual effect "does nothing" despite clean builds, inspect the exact JSX location before debugging state. A rendered element inside an event handler body is just dead code unless it is returned or otherwise mounted into the tree.


## 149. When a status should blind the player, a canvas blackout layer is cheaper and safer than hiding every scene mesh (2026-04-30)

**Problem**: After hiding opponents/entities for 鸿蒙天禁, the user wanted to go further and prevent the affected player from seeing the ground, meshes, and other scene content as well. Doing that by individually hiding terrain, collision/debug meshes, effects, and world props would be broad and fragile.

**Root causes**:
- The 3D scene is composed from many different visual systems, so a per-mesh/per-feature hide pass would spread the rule across a large part of `ArenaScene` and related render helpers.
- The gameplay requirement was fundamentally perceptual (blind the player while keeping UI usable), which does not require the world simulation to disappear one object type at a time.

**Fix**:
- Added a full-screen black overlay in `BattleArena.tsx` above the 3D canvas and below the HUD/UI whenever the local player has 鸿蒙天禁.
- Kept the existing local world filtering in place as the gameplay layer, while the blackout overlay handles the visual "cannot see the scene" requirement in one place.

**Key lesson**: If the intended effect is "the player should see nothing but UI," prefer a render-layer blackout over selectively disabling every world mesh. It is smaller, easier to reason about, and less likely to miss one rendering path.


## 150. If a player should become unable to see others, filter their local scene inputs once at BattleArena entry (2026-04-30)

**Problem**: 鸿蒙天禁 already hid the affected target from everyone else, but the user also wanted the affected player to be unable to see anyone except self while the buff is active. In the same adjustment, 曙色 needed to be treated as a DEBUFF instead of a BUFF.

**Root causes**:
- The previous frontend logic only handled the "hide this target from enemies" direction. It did not have a symmetric rule for "when I have 鸿蒙天禁, remove everyone else from my own world view."
- `ArenaScene` already renders from the arrays it is handed, so the clean control point is the BattleArena list derivation layer, not the individual mesh components.
- 曙色's authored buff category and effect category both still said BUFF, so the runtime/state metadata did not match the updated gameplay request.

**Fix**:
- Added a local `selfHasHongMengTianJin` gate in `BattleArena.tsx` that feeds empty opponent/entity arrays to the scene and target-selection lists while the local player has 鸿蒙天禁.
- Reused that filtered entity list to clear stale selected entities when they disappear from the player's allowed view.
- Changed 曙色 to `category: "DEBUFF"` in the ability definition and aligned `HONG_MENG_TIAN_JIN_IMMUNE` to the DEBUFF effect category map.

**Key lesson**: If an effect changes what the affected player can see, do the filtering at the top of the local render/selection pipeline so one rule controls the scene, click targets, and stale-selection cleanup together.


## 151. Control-copy cleanse skills need a dedicated capture path, and BattleArena filter state can safely persist via localStorage (2026-04-30)

**Problem**: New skills like 游风飘踪 / 如意法 need to do more than generic `CLEANSE`: they must remove knockdown, know exactly which control kind was removed, and later re-apply that control through `addBuff()` so 递减 still works. 游风飘踪 also needed to become self-cast with optional target reflection instead of hard-requiring a target, and 如意法's visible next-attack marker still failed to fire on real attacks because its trigger loop was placed in the wrong GameLoop scope. Separately, the in-game ability cheat panel kept forgetting the user's rarity/school filters on every reload.

**Root causes**:
- `handleCleanse()` is intentionally simple. It removes normal CONTROL / ATTACK_LOCK (and optional ROOT/SLOW), but it does not preserve any metadata about what was removed, and it deliberately leaves 摩诃无量-style knockdown alone.
- Re-applying copied control by pushing raw runtime buff objects would bypass immunity checks, status-bar metadata, BUFF_APPLIED events, and 递减.
- For one-shot on-hit mechanics like 如意法, putting the trigger scan inside an unrelated stack-expire branch can make the buff appear in UI while never firing during normal outgoing attacks.
- The cheat-panel filters in `BattleArena.tsx` were plain `useState('all')` values with no persistence path, so reloads always reset them.

**Fix**:
- Added a dedicated `captureAndCleanseControls()` helper in `Cleanse.ts` that removes root / freeze / stun / knockdown / attack-lock style controls from self, classifies the removed control kind, and records duration metadata for later re-application.
- 游风飘踪 now casts as a self skill, always grants its 8-second anti-control buff, and only mirrors control when an explicit target exists. Its mirrored control now uses a fixed 5-second duration instead of the cleansed buff's remaining time.
- 如意法 now uses the same capture helper, stores the captured control package on a real runtime buff (`如意法·待发`), and consumes that buff from the authoritative GameLoop damage-event scan on the next eligible outgoing attack. The copied control is still applied through `addBuff()`, so DR/immunity/status-bar behavior stays correct.
- Cheat-panel rarity/school filters now load from and save to `localStorage` under `zhenchuan-cheat-filters`.

**Key lesson**: Any skill that "cleanses and then copies/echoes the removed control" should not be built on top of bare `handleCleanse()`. Treat it as a two-step system: capture authoritative control snapshots first, then re-apply via `addBuff()` later. For one-shot follow-up mechanics like 如意法, attach the trigger scan to the normal outgoing damage-event pass itself, not to a neighboring proc branch that only runs on a subset of hits. For BattleArena UI preferences, small floating-panel filters are fine to persist directly in localStorage when there is already a client-only state pattern nearby.


## 152. Full HP must never suppress HEAL events (system rule, 2026-05 session)
HEAL events drive the floating-text visuals. Even when the player is already at
max HP, the float should still show. Therefore: **always emit a HEAL event with
the intended heal amount** (e.g. the value defined on the effect / buff). Do
NOT gate on the actual hp delta (`applied > 0`). The actual hp clamping happens
inside `applyHealToTarget`; the event uses the *intended* value.
- Lifesteal entity path (`Damage.ts`): emits with `healAmt`.
- 徐如林·回复 expire (`GameLoop.ts`): emits with `healVal`.
- Apply this to any new heal source.


## 153. Test-only target dummies (cheat) belong in their own panel and reuse `TargetEntity` (2026-04-29)

**Problem**: Combat-helper cheat buttons (双方满血 etc.) lived inside the ability-picker cheat window, and there was no way to place arbitrary practice dummies for testing damage/CC/heal flows.

**Fix**:
- Split the existing cheat window: combat helpers + new dummy controls now live in a separate `控制面板` floating panel beside the ability list. The ability cheat window now only contains the ability picker.
- Reuse `TargetEntity` for ally / enemy dummies (`kind: "test_dummy_ally" | "test_dummy_enemy"`). Owner is the caller (ally) or the opponent / synthetic id (enemy), so existing friendly/enemy logic naturally applies.
- Click-to-place flow mirrors `pendingGroundCastAbilityId`: a `pendingDummySpawn` ref + ground hover preview + `onGroundPointerDown` posts to `/api/game/cheat/spawn-dummy`. No range limit since this is a debugging tool.
- Added `/cheat/restore-dummies` and `/cheat/clear-dummy-debuffs` endpoints. They iterate `state.entities` and only mutate entries whose `kind` is in the `DUMMY_KINDS` set.

**Key lesson**: When testing tools need to interact with combat systems, build them on the same primitives the real systems use (`TargetEntity` + `addBuff`) — that way controls, damage, healing, and HUDs all "just work" without parallel code paths.


## 154. DISPLACEMENT Bypass for 镇山河 (2026-05 session)

**Problem**: 镇山河 (`zhen_shan_he`) failed with `ERR_DISPLACEMENT` when cast while being pulled by 捉影式.

**Root cause**: 捉影式's channel completion triggers `TIMED_PULL_TARGET_TO_FRONT` in GameLoop.ts, which calls `applyDashRuntimeBuff` on the *target* with effects `[CONTROL_IMMUNE, KNOCKBACK_IMMUNE, DISPLACEMENT, DASH_TURN_LOCK]`. The `DISPLACEMENT` buff blocks all casting via `validateCastAbility` / `validatePlayAbility` with no bypass mechanism. 镇山河 already had `allowWhileKnockedBack` and `allowWhilePulled` flags, but those are checked *after* DISPLACEMENT.

**Fix**:
- Added `allowWhileDisplaced?: boolean` to `Ability` interface in `abilities.ts` type.
- Added `allowWhileDisplaced?: boolean` to `AbilityEffect` interface in `effects.ts`.
- Replaced the unconditional `throw new Error("ERR_DISPLACEMENT")` in both `validateCastAbility` and `validatePlayAbility` in `validateAction.ts` with a bypass check (same pattern as allowWhileKnockedBack/allowWhilePulled).
- Added `allowWhileDisplaced: true` to 镇山河 in `abilities.ts`.

**Key lesson**: The `DISPLACEMENT` check in `validateAction.ts` was hardcoded with no bypass — any future ability that should be castable during dashes/pulls needs `allowWhileDisplaced: true`.


## 155. 捉影式 Pull Distance Fix (2026-05 session)

**Problem**: 捉影式 had `range: 35` (cast range) but `value: 20` in `TIMED_PULL_TARGET_TO_FRONT`, meaning a target at 35u away would only be pulled 20u (reaching 15u from caster). Description said "最多20单位" which was inconsistent with the 35u cast range.

**Fix**: Changed `value: 20` → `value: 35` (pull travels full cast range). Updated description accordingly.


## 156. Icon Asset Reorganization

- **Flattening `public/game/icons` and `public/icons/class_icons` into `public/icons`**: Completed successfully. All 114 game icons preserved. Source paths updated from `/game/icons/` to `/icons/` across 8 files: `abilityPreload.ts`, `buffIcons.ts`, `editorShared.ts`, `Card/index.tsx`, `SelectedAbilities.tsx`, `DraftShop.tsx`, `BenchArea.tsx`, `BattleArena.tsx`. Do NOT touch `layout.tsx` or `TopBar/index.tsx` — they correctly use `/icons/app_icon*` already.
- **Pitfall**: When two identical img tags exist in the same file, multi-replace fails with "multiple matches". Use surrounding context lines (title attribute, class names) to uniquely identify each occurrence.
- **Order matters**: Do point 0 (clean legacy icons from `public/icons`) BEFORE moving `game/icons` into it, to avoid accidentally cleaning the real game icons.

---


## 157. Coordinate System

- World → Three.js transform: `threeX = worldX − worldHalf`, `threeZ = worldY − worldHalf`, `threeY = worldZ`.
- Collision-test map is **non-square (819 × 828 after 50% scale-up)**. Always use `width/2` for X offsets and `height/2` for Y/Z offsets. Reusing `width/2` for Z causes slope-support drift and airborne-state issues.

### 157.1 Scaling the exported 3D map (50% scale-up, 2026-04-12)
The map is a coupled system — all of these must stay in sync when scaling:
1. `MAP_SCALE` in both `exportedMapCollision.ts` (backend) and `ExportedMapScene.tsx` (frontend): the GLB group scale factor.
2. `GROUP_POS_X/Y/Z` in both files: scale linearly by the same factor as MAP_SCALE (they're in Three.js world units derived from the scale).
3. `EXPORTED_MAP_WIDTH/HEIGHT` (backend `exportedMap.ts`) and `COLLISION_TEST_MAP_WIDTH/HEIGHT` (frontend `collisionTestMap.ts`): the world boundary.
4. All entity AABBs in `exportedMap.ts` and `collisionTestMap.ts`: x, y, w, d, h all scale proportionally.
5. Spawn positions in `exportedMap.ts` → `EXPORTED_MAP_SPAWN_POSITIONS`: scale x, y by the same factor.
The BVH collision triangles in the GLBs do NOT change — only the coordinate mapping constants change.

---


## 158. CORS / Nginx

- Using an external URL in `BACKEND_URL` causes nginx 404 — always point to `http://localhost:5000` for server-side calls.
- WebSocket proxy requires `http/1.1 + Upgrade + Connection` headers, or the connection silently fails.
- Missing `Host` header in nginx proxy causes cookie routing failures.
- The public nginx route currently serves `/icons/*.png` with `Cache-Control: public, max-age=2592000, immutable`. If a desktop browser cached an earlier missing/bad icon response, it can keep showing broken icons while a phone with a fresh cache shows the new files. Fix by versioning generated icon URLs in the frontend helper so icon requests move to a fresh cache key.

---


## 159. Mongoose Mixed Fields

- Mongoose does not track nested property mutations on `Mixed` fields.  
  Solution: reassign the whole object using spread (`{ ...obj, prop: newVal }`) and call `markModified()` on both parent path and specific nested path before `save()`.

---


## 160. Collision System (collision-test mode)

- Player radius for collision-test: **0.384** (authoritative via `exportedMapCollision.ts` → `GameLoop.ts`).
- Ground support radius must be tight (≈ playerRadius + small epsilon); too large causes "floating on air" near edges.
- Side-collision Z gating must be consistent with ground-support epsilon, or players bounce/get rejected on rooftops.
- Critical broadphase rule: every spatial query must use the segment bounds (min/max of sx/sy/ex/ey), not legacy x/y/w/d, or you get invisible blockers / walk-through colliders.

### 160.1 玉门关 camera wall clamp + close-body hide (2026-04-15)
- **Problem**: The third-person camera always used its full offset, so backing into a wall let the view look over the wall while the local body stayed hidden behind it. Pitch was also clamped to non-negative values, so the view could not tilt upward from below the character.
- **Fix**:
  - Camera pitch in collision-test mode now allows negative values, and the look target rises as pitch goes upward so the view can tilt into the sky from below the avatar instead of only orbiting above.
  - The 玉门关 camera now raycasts against the exported BVH and clamps the camera to the first blocking surface behind the player, keeping the camera on the wall instead of beyond it.
  - The local avatar, HP bar, and facing arc now fade out and fully disappear once the camera is pushed to about one body-length from the character, producing the intended first-person feel near walls.
- **Files**: `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`, `frontend/app/game/screens/in-game/components/BattleArena/scene/CameraRig.tsx`, `frontend/app/game/screens/in-game/components/BattleArena/scene/Character.tsx`, `frontend/app/game/screens/in-game/components/BattleArena/scene/ArenaScene.tsx`, `frontend/app/game/screens/in-game/components/BattleArena/scene/MapCollisionSystem.ts`
- **Follow-up tuning**:
  - Upward look is now ground-aware: the camera lowers first, then clamps to the local support ground under the camera, and only overflow beyond that clamp turns into sky-looking angle. This prevents the camera from dropping below the walked surface.
  - Move commands now recenter only the camera's aim back to the avatar when the avatar has drifted out of frame. The camera body stays where it is, and this recenter is skipped when the avatar is already hidden only because the camera is too close.
  - Active manual camera intent now wins over move-command recentering. While left-drag or touch-look is still being held, movement input no longer forces the camera away from the user's deliberate sky-look.
  - Rooftop sky-look needed a separate clamp rule: the camera back-ray could hit the roof/floor surface itself before any real wall, which stopped the camera from ever reaching the grounded state that should transition into sky angle. The camera ray now skips downward floor-like hits and still respects real wall blockers.
  - House / wall transitions needed a wider camera body test than a single center ray. The camera now fires side and corner probe rays around the desired camera position and uses the tightest allowed distance, which keeps the whole camera frustum on the avatar side of the wall instead of letting one half peek outside roofs or wall edges.
  - When the wall clamp compresses the camera, the look target now blends back toward the avatar instead of staying far ahead. This makes the back-against-wall transition feel closer to a smooth close-up rather than a clipped outside-looking view.
  - Added an in-game camera debug window at 5% / 60% for 玉门关. It records wall clamp start/end, probe clamp start/end, ground clamp start/end, close-body mode, recenter events, and large snap jumps together with camera position and yaw/pitch so bad transitions can be copied straight out of the client.
  - House-entry snap logs showed the real cause: the camera target could change from full boom length to a very short blocked distance in one frame, while probe clamp and ground clamp were also toggling on neighboring frames. That produced visible in/out snapping even though the wall logic itself was technically correct.
  - Fix for that case: collision-driven camera position now blends quickly in and out instead of hard-copying the blocked target each frame, and probe / ground clamp state uses hysteresis so tiny one-frame changes do not repeatedly enter and leave clamp mode.
  - Follow-up log review showed a second issue after the first smoothing pass: even without a hard snap, the camera was still "breathing" far/close/far because the whole world position was being smoothed while the blocked direction kept changing. Smoothing the camera distance along the current blocked direction works better than smoothing the whole position.
  - Ground clamp also needs a roof filter while wall-blocked. If the support point under the camera is much higher than the player's current feet while the wall clamp is active, that support is usually an outside roof/top surface and should not lift the camera away from the avatar.
  - Thin roof ribs / trim pieces can still confuse probe clamp even when the center wall clamp is correct. A more stable camera rule is to ignore single outlier probe hits and only apply extra probe shortening when multiple probe rays agree on a shorter distance.
  - Wall transition feel is better when both compression and release are slowed down. Fast damping makes the camera look technically smooth but still feel like a snap; slower in/out rates feel more like a deliberate zoom.
  - Once the big snaps are gone, the remaining problem is usually probe chatter: very small probe shortenings start and end on adjacent frames and make the camera feel shaky even though nothing is visibly "jumping." Adding an enter/exit hold time for probe clamp and retaining the last reliable probe distance for a short time makes the view feel much calmer.
  - Close-body state also needs hysteresis. If the near-camera threshold is symmetric, the camera can hover around that boundary and repeatedly enter/leave the close-body state while sliding along a wall.
  - Bridge slats / fence-like gaps need wall-clamp persistence, not a blind global cooldown. The better rule is: zoom in immediately when blocked, but do not release the wall clamp until the path has been clear for a short grace period. That prevents bad in-out-in-out oscillation when the ray alternates between wooden slats and tiny gaps.
  - While wall-blocked, the retained wall distance should also grow much more slowly than it shrinks. Fast growth makes the camera breathe outward through tiny clear gaps; slow growth keeps the wall view stable until clearance is sustained.
  - Release hold alone is not enough for slatted bridges. Even while the wall clamp is still active, the allowed blocked distance can jump between "near slat" and "far slat" hits. A better rule is to require the farther wall distance to remain stable for a short hold time before letting the retained wall distance expand.
  - The same "ignore isolated thin hits" rule should be applied to the primary wall clamp, not only the probe clamp. If the main wall ray reacts to a single thin side stick while nearby support rays stay clear, treat that as an outlier and ignore it.
  - When the user asks for slower auto zoom, halve the damping speeds consistently across the collision zoom, retained wall distance, and retained probe distance. Slowing only one of those layers leaves the camera feeling inconsistent.
  - If thin side sticks still trigger the primary wall clamp after adding support rays, the main wall consensus is still too permissive. Requiring a broader agreement across support rays and a larger minimum shortening threshold helps reject narrow side-stick blockers that hit only part of the camera body.
  - Bridge-gap breathing can also persist if the blocked-distance expansion hold is too short. Expanding farther while still occluded should usually need a noticeably longer hold than the initial clamp-in.
  - When camera tuning stalls because the blocker is "somewhere between tiny and real", the debug log needs blocker-size metrics, not just camera position. Log the wall support hit count, hit mask, support span, raw distance range, retained distance, and pending expansion hold so the next tuning pass can use measured blocker coverage instead of guessing.
  - The new blocker metrics revealed a concrete issue: the original main wall-support footprint was only about 0.48 × 0.32, so a narrow stick could still hit every support ray and look like a full wall. When the log shows full support coverage over a tiny footprint, the next step is to enlarge the wall-support footprint and sample corners so the camera test better matches a real camera body.
  - If widening the wall-support footprint still shows masks like `C,R,U,D,UR,DR` with no left-side hits, the remaining bug is blocker shape, not blocker size. Treat one-sided support clusters as edge occluders for the probe clamp, not as a full wall that should collapse the main boom distance.
  - Even after wall and probe retention are stable, the final camera-distance smoother can still feel bad if it is allowed to reverse direction instantly. A short reversal cooldown at the smoothing layer works better than more ray tuning: hold outward release briefly after a compression, and if a release just started, soften the immediate re-compression instead of snapping back at full speed.
  - Camera testing UI must be explicitly gated. Leaving mirror/log tooling always active in collision-test means camera events keep appending React state even when the panel is hidden, which adds avoidable long-session UI churn. The camera event panel should be off by default and only collect events when its ESC toggle is enabled.
  - Whole camera-upgrade path: fix look space first (negative pitch + ground-aware sky-look), then occlusion correctness (BVH wall clamp + probe clamp + close-body hide), then transition feel (distance smoothing, hysteresis, release holds, reversal cooldown), then instrumentation (camera event panel + blocker metrics), then blocker classification (size coverage first, shape coverage second). That order made later tuning measurable instead of guesswork.

### 160.2 Long-session React churn during collision-test (2026-04-16)
- **Symptoms**: After long testing sessions, the client became laggy and could surface `Maximum update depth exceeded` from the live battle client.
- **Root causes**:
  - Camera event testing had been wired as always-on React state updates in `BattleArena.tsx`, even when the debug panel was not being used.
  - Battle completion in `InGameClient.tsx` had no one-shot guard, so the `gameOver` effect could schedule repeated refetch-driven updates for the same finished battle.
  - `useGameState.ts` was also updating RTT state on every diff packet, which is unnecessary churn because heartbeat `PONG` already provides RTT.
- **Fixes**:
  - Add an explicit ESC toggle for camera event testing and keep it off by default; only pass `onCameraDebugEvent` when enabled.
  - Default `显示距离地面距离` to off in the ESC panel.
  - Guard battle completion with a one-shot ref keyed by battle number + winner, and clear that guard only when the battle state changes.
  - Update RTT state from heartbeat `PONG` only, not from every state-diff packet.
- **Files**: `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`, `frontend/app/game/screens/in-game/InGameClient.tsx`, `frontend/app/game/screens/in-game/hooks/useGameState.ts`

---


## 161. LOS / Vision Checks

### 161.1 Small terrain-level objects falsely blocking LOS (FIXED)
- **Bug**: `isLOSBlocked` and `isLOSBlockedClient` checked ALL AABB objects, including tiny ground-level props in the exported map (e.g., h=2.84, h=2.96, h=3.04, h=3.72, h=3.82, h=4.62, h=5.76). The map floor is 3D terrain, so these objects represent ground bumps that players can stand on, not walls.
- **Symptom**: In collision-test mode, targeting abilities showed "视线被建筑遮挡" even when the path was open. Channel spells cancelled immediately on slightly uneven ground.
- **Also found**: `validateAction.ts` was hardcoded to `worldMap.objects` for LOS regardless of game mode — this is now fixed to use the correct map via `options.mapObjects`.
- **Fix**: 
  - Added `minBlockH` parameter to `isLOSBlocked` (backend) and `isLOSBlockedClient` (frontend). Objects with h < 5.5 game units are now ignored as LOS blockers.
  - Added `casterZ` / `targetZ` parameters: if both players' feet are at or above the object's top, the object doesn't block (handles elevated terrain).
  - In collision-test mode, `minLOSBlockH = 5.5` is passed at all call sites.

---


## 162. Build / Deployment

- Build order: backend first (`npm run build`), then frontend (`npm run build`), then `pm2 restart all`.
- If a port is stuck: `lsof -ti:PORT | xargs kill -9`, then `pm2 restart all`.
- Never edit `.ts` files and expect changes to appear without rebuilding — ts-node compiles only at startup.

### 162.1 Atlas connectivity failure is separate from gameplay/unit edits (2026-04-14)
- **Diagnosis**: The MongoDB failure seen after the collision-test unit migration was not caused by changes to `backend/db.ts`, `backend/app.ts`, or `backend/index.ts` — those files were not modified.
- **Verified facts**:
  - The backend still loads the same `mongodb+srv://...@cluster0.sedw7v9.mongodb.net/...` URI from `.env`.
  - SRV lookup for `_mongodb._tcp.cluster0.sedw7v9.mongodb.net` resolves correctly to the three Atlas shard hosts.
  - Direct TCP connection attempts from this VM to all three shard hosts on port `27017` return `ECONNREFUSED`.
  - An isolated `mongoose.connect()` probe reproduces the same `MongooseServerSelectionError` without involving gameplay code.
- **Practical takeaway**: If Atlas access breaks immediately after gameplay edits, do not assume the gameplay code caused it. First verify SRV resolution and raw socket reachability from the VM. In this case the failure is at Atlas/network access level from public IP `147.224.13.78`, not in the movement or unit-conversion code path.

### 162.2 PM2 frontend restart can fail with stale port ownership (2026-04-14)
- **Symptom**: After restoring apps from `ecosystem.config.js`, PM2 showed the frontend in `errored` state with `EADDRINUSE: address already in use :::3000`.
- **Fix**: Follow the repo deployment rule literally: `lsof -ti:3000 | xargs -r kill -9`, then `pm2 restart frontend`.
- **Takeaway**: When PM2 state is rebuilt or a stale daemon is replaced, do not assume the old process released port `3000` cleanly. Verify with `pm2 logs frontend` and clear the port before retrying the restart.

### 162.3 PM2/frontend can flap when a separate `next dev` owns port 3000 (2026-04-19)
- **Symptom**: PM2 frontend repeatedly moved between `online` and `errored`, while port checks intermittently returned `HTTP 200`. Logs showed alternating `EADDRINUSE :3000` and `Could not find a production build in the '.next' directory`.
- **Root cause**: A separate terminal had `next dev` running and reclaiming port `3000`, while PM2 frontend expected production startup. This created misleading mixed-state signals between `pm2 status`, `curl`, and logs.
- **Fix**: Identify listener ownership (`ss -ltnp '( sport = :3000 )'`), kill the non-PM2 process, rebuild frontend (`npm run build`) to ensure `.next/BUILD_ID` exists, then restart PM2 frontend.
- **Takeaway**: For frontend startup issues, always verify all three together: PM2 process state, actual port owner (`ss`/`lsof`), and production artifact presence (`frontend/.next/BUILD_ID`).

### 162.4 Collision-test movement regression check after canonical-unit migration (2026-04-14)
- **Flat sandbox backend verification** (`unitScale = 1`, no terrain/walls):
  - Directional jump lands at ~`5.882u` (expected discrete-tick result for the 6-unit budget).
  - Upward jump drift lands at exactly `2.0u` and does not rotate facing.
  - Directional dashes hit authored distances exactly: `蹑云逐月 20`, `迎风回浪 10`, `凌霄揽胜 7`, `瑶台枕鹤 7`, `后撤 2.7`, `疾 37`, `踏星行 62.5`.
  - `扶摇直上` and combined `扶摇 + 鸟翔碧空` still produce the expected tall-jump behavior (measured discrete peaks ~`12.56u` and ~`23.55u`).
- **Collision-test map spot-check** (real exported map + BVH):
  - `蹑云逐月` still travels ~`20u` from the tested spawn.
  - `疾` measured slightly short on the real map at the chosen spawn because environment/collision constrains the path; the flat sandbox confirms the authored distance conversion itself is correct.
- **Takeaway**: After a unit-system migration, verify movement twice: once in a flat sandbox to confirm pure authored values, and once on the real collision-test map to catch environment interactions.

### 162.5 Atlas connect failure root cause: local nftables blocked outbound MongoDB port (2026-04-14)
- **Disproved first**: The failure was not caused by gameplay/unit edits, not by a stale SRV record, and not by a bad Mongo URI. `backend/.env` still pointed at `cluster0.sedw7v9.mongodb.net`, and public DNS resolvers returned the same Atlas SRV/A records as the VM.
- **Manual proof**:
  - Direct Mongo driver heartbeats failed with `ECONNREFUSED` to all three Atlas shard IPs: `89.192.9.170`, `89.192.9.179`, `89.192.9.173`.
  - `openssl s_client` to shard port `27017` also failed before the fix, which ruled out a Mongoose-only issue.
  - The VM's active nftables ruleset had `tcp dport { 6379, 11211, 27017 } reject` in the `OUTPUT` chain.
- **Actual fix**:
  - Remove `27017` from the live nftables `OUTPUT` reject rule.
  - Persist the same change in `/etc/nftables.conf`, then reload nftables.
  - After that, all three Atlas shard TLS handshakes succeeded and a direct MongoDB `ping` returned `{ ok: 1 }`.
- **Takeaway**: If Atlas suddenly fails with `ECONNREFUSED` from a whitelisted VM, inspect the VM's own outbound firewall before blaming Atlas IP access. In this case the VM itself was rejecting MongoDB egress on port `27017`.

### 162.6 Post-dash jumps must not inherit dash-speed carry (2026-04-14)
- **Symptom**: After a qinggong dash ended in air, the next forward jump could arm an oversized horizontal travel budget because jump scaling still saw the dash's planar speed snapshot.
- **Root cause**: `movement.ts` kept writing `airborneSpeedCarry` from `activeDash`, and airborne dash completion did not clear it. The next jump then took the max of base move speed and the stale dash carry.
- **Fix**: Completed dashes now clear `airborneSpeedCarry`, and active dash ticks no longer refresh that carry. Follow-up jumps after dash completion now use restored movement speed again.
- **Frontend parity**: `BattleArena.tsx` had the same stale carry pattern. Local prediction no longer seeds `airborneSpeedCarry` from `activeDash`, and dash end always clears it.
- **Verification**: Backend simulation confirmed that a follow-up forward jump after airborne `蹑云逐月` or `疾` now re-arms the normal `6u` directional jump budget instead of a dash-scaled value.

### 162.7 Prediction drift root cause: frontend duplicates backend movement state machine (2026-04-14)
- **Current reality**: Almost all real prediction lives inside `frontend/.../BattleArena.tsx`, where jump, dash, grounded checks, BVH collision, LOS checks, range checks, and movement reconciliation are all manually mirrored from backend logic.
- **Why drift keeps happening**: Backend movement changes are not flowing through a shared simulation core. Small state-machine changes like dash carry, jump budgeting, step-up rules, or support handling can be fixed server-side and still remain stale in the frontend mirror.
- **Durable plan**:
  1. Extract a shared pure movement/prediction core that both backend and frontend import.
  2. Keep transport, reconciliation, and rendering in `BattleArena.tsx`, but move jump/dash/grounded state transitions out of it.
  3. Add a tick-by-tick parity harness for representative cases: grounded run, directional jump, double jump, dash end into jump, wall hit, and roof walk-off.
  4. Until the shared core exists, treat "backend movement change" and "frontend prediction check" as one task. This rule was added to `.github/copilot-instructions.md`.

### 162.8 Collision-test player collision body reduced to 1.5h / 0.32r (2026-04-14)
- **Change**: Collision-test player radius was reduced from `0.64` to `0.32`, and the exported BVH cylinder height was reduced from `2.0` to `1.5` units (`half-height 0.75`).
- **Files**: Backend collision constants and movement cylinder sizing were updated, plus frontend local prediction, collision debug shell, and rendered character body sizing.
- **Sweep result**: After the change, no stray source-side `0.64`, old `2.0` player-height comments, or raw runtime `2.2` fallbacks remained in the gameplay code path. Remaining `2.2` references are intentional named legacy conversion constants for non-collision-test modes or raw exported asset remapping.

### 162.9 Collision-test player body width retuned to 1.5h / 0.384r (2026-04-14)
- **Change**: After the first reduction to `0.32` radius, the body felt too thin. Final tuning is `0.384` radius (20% wider) while keeping height at `1.5`.
- **Sync requirement**: Backend exported collision radius, frontend local prediction radius, debug collision shell, and rendered character width must all change together or wall/edge behavior and visuals drift apart again.

### 162.10 House-wall and roof-edge behavior in collision-test (2026-04-14)
- **Vertical wall while jumping**: The authoritative BVH horizontal pass blocks XY immediately but does not cancel upward motion. A backend probe against `entity_13` showed `x` freezing on the first tick while `z` kept rising each tick, which means house walls behave like slide/block surfaces, not jump-cancel surfaces.
- **Roof support rule**: Standing support comes from `getSupportGroundY(center)` under the cylinder center. There is no footprint-percentage check such as "50% of the body must still be over the roof." If the center still has support, the player stays supported; once support under the center falls away, the player starts falling.
- **Observed walk-off behavior**: On walkable roof `entity_0`, the player stayed grounded while the support under the center still tracked the roof surface. Once the center moved far enough that support dropped faster than the grounded snap could follow, `vz` became negative and the fall started.
- **Ceiling / roof-hit fix**: The BVH vertical pass now also probes the nearest ceiling above the player and clamps the 1.5-unit collision body under it. Upward momentum is killed immediately on contact and `vz` flips negative so both upward and directional jumps start falling right after the head hits the roof.
- **Important support fix**: Ground support for movement now probes from just above the feet instead of from above the whole body. Without this, nearby low roofs could be misread as "ground" and cause bad snap behavior.
- **Verified feel case**: A backend probe at a real low-ceiling point with only about `0.09` units of headroom above the 1.5-unit body stopped the jump on tick 2 and started the fall immediately after contact.
- **Remaining limitation**: Ceiling detection is still center-line based, like the current roof-support rule. It solves direct roof hits above the player, but it is not yet a full body-footprint ceiling solver for edge-only head contacts.

---


## 163. Mobile Controls

### 163.1 Virtual joystick for touch devices
- **Implementation**: `VirtualJoystick.tsx` — analog circular joystick using `React.TouchEvent`, tracks single touch ID, fires `onDirectionChange` (WASD booleans for keysRef) and `onAnalogMove` (dx/dy for smooth server-side movement).
- **Mobile detection**: `navigator.maxTouchPoints > 0 && !window.matchMedia('(pointer: fine)').matches` — detects phones/iPads without a fine pointer (mouse). Auto-switches `controlMode` to 'joystick' on first load if mobile is detected.
- **Jump button**: Integrated as a separate touch circle next to the joystick.
- **Analog movement**: `joystickDirRef.current` stores the latest normalized (dx, dy). In `sendMovement`, joystick mode now sends `{dx, dy, jump}` directly when the joystick is active (same as traditional mode's precise direction vector). The backend `MovementInput` interface already supports optional `dx/dy` overrides.
- **Files**: `VirtualJoystick.tsx` (rewritten), `BattleArena.tsx`

### 163.2 Touch camera rotation (iPad/iPhone)
- **Implementation**: A `useEffect` in `BattleArena.tsx` adds `touchstart/touchmove/touchend` on `window`, matching the touch to a finger that started inside `wrapRef` (the 3D canvas div). Swipe rotates camera + player facing (same as PC right-click drag).
- **Critical**: Joystick's `onTouchStart` uses `e.preventDefault()` so it captures its own touches before the canvas-level listener sees them.
- **Lesson**: Touch listeners for camera must be `passive: true` on `window`, but this means we can't call `preventDefault` to block scroll. Use `touch-action: none` on the `.container` CSS class and `document.body.style.overflow = 'hidden'` in a `useEffect` to prevent page scroll.
- **Joystick position**: Expressed as `left: '70%', bottom: '60%', transform: 'translate(-50%, 50%)'` — must use CSS % strings, not pixel integers, for proper screen-relative placement.
- **Files**: `BattleArena.tsx`, `BattleArena.module.css`

---


## 164. Frontend Client-Side BVH LOS

### 164.1 Real-time ability LOS indicator without server round-trip
- **Problem**: In collision-test mode, AABB `isLOSBlockedClient` was disabled (mode guard `!== 'collision-test'`), so abilities targeting an opponent behind a wall showed no indicator until server rejection.
- **Solution**: Added `MapCollisionSystem.checkLOS(from, to, radius)` using the same BVH raycast as the existing `shellBVH`. Added `clientCheckLOS()` helper in `BattleArena.tsx` that converts game coordinates to BVH space using the same formula as the backend (`ExportedMapCollisionSystem.checkLOS`).
- **Coordinate transform**: `x = (px - halfW - GROUP_POS_X) / RENDER_SF`, `y = (pz + 1.5 - GROUP_POS_Y) / RENDER_SF`, `z = (halfH - py - GROUP_POS_Z) / RENDER_SF`.
- **LOS eye height**: `1.5` game units added to Z (height) so the ray shoots from chest-level, not floor-level.
- **Result**: Abilities now gray out with red glow border in real time when target is behind a BVH wall. Blueprint mode shows a green/red line to the target.
- **Files**: `MapCollisionSystem.ts`, `BattleArena.tsx`, `ArenaScene.tsx`

### 164.2 Legacy "ghost" AABB entities blocking LOS (the root breakthrough)
- **Root cause was NOT a ground/terrain problem**: The original complaint "opponent near a house blocks vision" was caused by the old AABB entity bounding boxes (e.g., `entity_73`, `entity_74`). These AABBs are massively over-approximate — they cover entire courtyard areas including places the player stands. When targeting from "inside" one AABB, the AABB check always failed.
- **Disproved approach**: Spent time trying `minBlockH` filters and eye-height filters on the AABB path — partial fix but still wrong for large AABBs.
- **Actual fix**: Switch LOS entirely to BVH raycast in collision-test mode, both client and backend. The BVH uses actual triangle geometry (exported from the 3D map via Three.js BVH), so it is always accurate. AABB checks are now only used as fallback for non-collision-test modes.
- **Key insight**: The frontend blueprint wireframe mode (cyan collision mesh) and the BVH raycast use identical geometry → if the line in blueprint mode passes through open space, the ability should be castable.
- **Files**: `exportedMapCollision.ts` (backend), `MapCollisionSystem.ts` (frontend)

---


## 165. Debug/Display Cleanup

### 165.1 AABB "Part Boxes" button replaced with BVH mesh
- The "Part Boxes" orange AABB debug display was inaccurate (over-approximate boxes). Replaced with the actual BVH shell mesh (`showCollisionShells`). The "Shell+Probe" and "Part Boxes" buttons were merged into a single "碰撞体" button that toggles the BVH wireframe.
- **Key insight**: Never use AABB for visual collision debugging in collision-test mode — the real collision uses BVH, so the debug display should too.
- **Files**: `BattleArena.tsx`, `ArenaScene.tsx`, `ExportedMapScene.tsx`

### 165.2 `instanceId` undefined crash in commonUpdated map
- **Bug**: In the `commonUpdated` `.map()` block, the return object referenced `instanceId` which is a `const` declared inside the sibling `draftUpdated` block — not in scope.
- **Fix**: Common abilities use `ability.id` as their stable ID (they have no per-instance ID).
- **Lesson**: Code copying between the draft and common ability map blocks must be careful about scope. Always check what `const` variables are actually declared in the current block.

### 165.3 `allowOverrangeCameraZoom` runtime crash from helper-scope leak (2026-04-19)
- **Bug**: `MeasureLine3D` (a top-level helper component) accidentally used `allowOverrangeCameraZoom` in its `useEffect` dependency array. That state only exists inside `BattleArena`, so the browser threw `ReferenceError: allowOverrangeCameraZoom is not defined` at runtime.
- **Fix**: Restore `MeasureLine3D` cleanup effect dependency to `[]`, and bind the wheel-listener effect inside `BattleArena` to `[allowOverrangeCameraZoom]`, which is the correct scope for zoom-cap toggling.
- **Lesson**: When moving hook dependencies, verify lexical scope. A dependency that compiles can still crash in production bundles if it references state from a different component scope.

### 165.4 `Cannot access 'nx' before initialization` from misplaced hook dependency (2026-04-19)
- **Bug**: During the above dependency move, `[allowOverrangeCameraZoom]` was briefly attached to an earlier body-scroll lock effect that runs before the `useState` declaration of `allowOverrangeCameraZoom` inside `BattleArena`.
- **Symptom**: Production bundle crashed with `ReferenceError: Cannot access 'nx' before initialization` (`nx` was the minified symbol for `allowOverrangeCameraZoom`).
- **Fix**: Put the body-scroll effect back to `[]` and keep `[allowOverrangeCameraZoom]` only on the wheel-listener effect that actually reads it.
- **Lesson**: In React function components, dependency arrays are evaluated immediately in declaration order. Referencing a later `const`/`useState` value in an earlier hook can trigger runtime TDZ even if TypeScript build passes.

### 165.5 `PCFSoftShadowMap` deprecation warning cleanup (2026-04-19)
- **Symptom**: Browser console showed `THREE.WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead.` during in-game rendering.
- **Root causes**:
  - Collision-test renderer setup explicitly set `gl.shadowMap.type = THREE.PCFSoftShadowMap`.
  - R3F `Canvas` shadow prop used boolean mode, which mapped to deprecated soft mode in current runtime.
  - Export reader initialization also set `renderer.shadowMap.type = THREE.PCFSoftShadowMap`.
- **Fix**:
  - Switched renderer shadow type to `THREE.PCFShadowMap` in `ArenaScene.tsx` and `public/js/export-reader.js`.
  - Changed `Canvas` shadows config to explicit `'percentage'` mode instead of boolean so it no longer chooses soft by default.
- **Lesson**: When Three.js deprecates a shadow mode, update both explicit renderer constants and any framework-level defaults (`Canvas` shadow props), otherwise warnings can persist from implicit settings.

### 165.6 Export-reader sunlight is not static (collision-test lighting)
- **Root cause**: The export-reader `DirectionalLight` is not just a fixed light with `intensity=3`, color, and shadow settings. Every frame it re-centers the sun around the camera and moves the light target to the camera position:
  `sun.position = camera.position + dir * 100000`, `sun.target.position = camera.position`.
- **Why this matters**: Copying only the numeric light props into collision-test mode is not enough. A static world-space sun can make the scene look wrong and break shadow coverage, even when the light color/intensity look identical on paper.
- **Lesson**: When matching export-reader visuals, compare the full runtime behavior, not just the constructor arguments. Renderer state, per-frame light updates, and material/shader setup all matter.

### 165.7 Export-reader fill lights use linear colors, not hex approximations
- **Bug**: Collision-test mode initially recreated export-reader ambient/hemisphere lights with hex strings like `#7f7f7f` and `#667299`. Export-reader does **not** get those colors from sRGB hex — it gets them from linear float arrays in `environment.json` (`ambientColor`, `skyLightColor * skyColorMultiplier`).
- **Symptom**: With only ambient/hemi enabled the scene looked like a dark "6pm" fill, and when the directional sun turned on it overwhelmed the scene like a floodlight because the fill lights were much darker than export-reader.
- **Fix**: Use exact linear `THREE.Color(r, g, b)` values for ambient and hemisphere sky lights in collision-test mode. This keeps the sun/fill balance consistent with export-reader.

### 165.8 Remaining export-reader parity gaps after sun matching
- **Camera mismatch**: export-reader camera is `PerspectiveCamera(60, aspect, 20, 500000)` with orbit distance `220..1800` and camera height `120`. Collision-test gameplay camera is a different rig entirely (`fov=72`, `near=0.5`, default `far=2000`, third-person follow camera with `CAM_DIST_BACK=20`, `CAM_HEIGHT=10`). The same sunlight will read differently under a very different camera/framing setup.
- **Renderer mismatch**: export-reader creates `WebGLRenderer({ antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true })` and caps pixel ratio to `min(devicePixelRatio, 1.5)`. Collision-test currently only sets `antialias: true` on the R3F canvas. This can affect depth precision and overall visual response on large terrain.
- **Takeaway**: If a scene must look exactly like export-reader, matching the light alone is insufficient. Camera model and renderer construction are part of the visual pipeline.

### 165.9 Centralize test UI behind one hotkey panel
- **Problem**: Floating debug/test widgets piled up on screen and interfered with visual comparison work.
- **Fix**: Moved env toggles + sun controls into a centered testing panel opened by `F8`, with section-level show/hide toggles so future tools can live in one place.
- **Default policy**: Keep the testing UI hidden by default, but preserve useful debug controls behind the hotkey instead of deleting them.

### 165.10 Use `Esc` as the primary in-game testing/debug panel hotkey
- **Problem**: The testing panel was on `F8` only, while the user expected an `Esc` panel. Existing top-right widgets (`碰撞体`, `Blueprint`, `XY%`, control mode gear) were still scattered outside the panel.
- **Fix**: `Esc` now toggles the centered debug panel. The panel now contains environment toggles, sun config, live XYZ position, movement/combat status, collision/grid toggles, and control mode settings.
- **Current input policy**: Keep `Esc` for the panel, but leave the original camera zoom behavior on the mouse wheel. Avoid piling extra debug bindings onto unrelated gameplay keys unless explicitly requested.

### 165.11 Height / jump HUD must be floor-relative, not absolute-Z
- **Bug**: The frontend jump HUD tracked takeoff/landing with `Z > 0.01` / `Z <= 0.01`, which only works when the current floor is world Z=0. Rooftop jumps never measured correctly, and peak height was reported in absolute world Z instead of height above the floor the player jumped from.
- **Fix**: Track jump state from `currentZ - groundBelowMe`, store the floor height at takeoff, and report peak jump height as `(peakZ - takeoffFloor) / 2.2` in new units. This also keeps the live `A | B` HUD correct on rooftops.
- **Files**: `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`

### 165.12 Double-jump prediction can feel wrong even when jump constants match
- **Root cause**: The client and backend jump constants already matched. The visible snap came from frontend Z reconciliation being too aggressive immediately after a local jump input, especially on double jump where the server naturally lags the client by about one movement tick.
- **Fix**: Keep the same jump physics, but soften in-air Z reconciliation. Briefly trust local prediction more after a jump press, use larger airborne snap thresholds, and avoid zeroing vertical velocity unless the player is effectively grounded.
- **Files**: `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`

### 165.13 Invalid extra jump input can corrupt local airborne state
- **Symptom**: After a legal double jump, pressing `Space` again while no jumps remained could still latch `jumpLocalRef` on the frontend. That made the client feel like the player instantly dropped or stalled until the backend corrected the state.
- **Root cause**: Keyboard and joystick jump handlers queued local jump input without checking the current local jump budget. Once an impossible jump was latched, some airborne helper branches treated the player as still waiting to jump.
- **Fix**: Add one guarded local jump queue path in `BattleArena.tsx`. It now checks the effective jump cap before latching the press, and the physics tick clears any stale impossible jump request before it can interfere with airborne handling.
- **Files**: `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`

### 165.14 鸟翔碧空 needs a local jump-cap prediction bridge
- **Symptom**: Right after casting `鸟翔碧空`, the frontend could still think the player only had the normal 2-jump cap until the server buff snapshot arrived. That created a short prediction mismatch window for extra jumps.
- **Fix**: Add a short-lived local `MULTI_JUMP` prediction bridge in `BattleArena.tsx` when `鸟翔碧空` is cast, so local jump gating and post-dash jump allowance stop lagging behind the server buff.
- **Authoritative flat-map measurements**:
  - `鸟翔碧空` first jump: peak `~5.002u`, rise `51` ticks (`~1700ms`), total airtime `88` ticks (`~2933ms`).
  - `扶摇直上 + 鸟翔碧空` first jump: peak `~23.549u`, rise `53` ticks (`~1767ms`), total airtime `110` ticks (`~3667ms`).
  - `扶摇` only: a third `Space` after the double jump is already a backend no-op; `jumpCount` stays at `2` and `vz` continues naturally.
- **Takeaway**: Backend Bird stats were already correct. The main remaining risk was frontend state lag, not authoritative jump math.
- **Files**: `backend/game/engine/loop/movement.ts`, `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`, `backend/game/abilities/abilities.ts`

### 165.15 玉门关 mode should not surface pickups
- **Change**: Collision-test / 玉门关 no longer initializes pickups in battle state, clears legacy pickups from already-started collision-test loops, and filters pickup rendering/interactions out of `BattleArena.tsx`.
- **Takeaway**: If a mode should not use a shared subsystem, disable it at both state initialization and frontend presentation. Hiding the UI alone is not enough when older loop state can still contain data.
- **Files**: `backend/game/services/battle/battleService.ts`, `backend/game/routes/draft.routes.ts`, `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`

### 165.16 Fuyao directional jump has special travel budgets
- **Rule update**: Non-`鸟翔碧空` Fuyao directional jumps do not use the normal `6u` travel budget. The first directional Fuyao jump uses `18u`, and a directional double jump performed during a Fuyao airtime uses `12u`.
- **Important distinction**: This applies to forward, left, and right directional jumps because they all share the same directional jump path. It does **not** apply to the special `扶摇直上 + 鸟翔碧空` combined jump, which keeps its previous movement behavior.
- **Implementation detail**: The first Fuyao directional jump keys off the live `JUMP_BOOST` consumption. The follow-up directional double jump keys off `isPowerJump` from the current airtime, because the Fuyao buff has already been consumed by then.
- **Flat-map backend verification**:
  - Fuyao directional first jump: travel `~17.84u`, peak `~12.56u`, airtime `110` ticks.
  - Fuyao directional double jump: travel `~11.85u`, peak `~13.27u`, airtime `133` ticks from takeoff.
  - Fuyao + Bird directional first jump stayed unchanged at `~5.95u` travel.
- **Files**: `backend/game/engine/loop/movement.ts`, `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`

### 165.17 Frontend Fuyao arc smoothing depends on budget order and render follow-through
- **Bug**: The client cleared `hasFuyaoBuffRef` before picking the directional jump budget, so the first directional Fuyao jump still predicted the old `6u` travel budget locally. That caused visible reconciliation and made the Fuyao jump arc feel rough.
- **Fix**: Pick the local directional jump budget before consuming the Fuyao flag, then let the render position follow airborne jump prediction more tightly right after jump input so the curve stays smooth through Fuyao into double jump.
- **UI cleanup shipped with the same pass**: The measurement tool now lives inside the `Esc` panel behind its own toggle, the standalone floating measurement widget is gone, the boss-style self HP bar no longer shows a mana strip, and the center distance HUD keeps only the numeric readout.
- **Files**: `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`, `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.module.css`

### 165.18 Bird directional jumps can use the same travel budget as Fuyao follow-up jumps
- **Rule update**: `鸟翔碧空` directional jumps felt too short at the default `6u` budget. For Bird-only directional jumps, use the same `12u` travel budget as the Fuyao follow-up jump.
- **Important distinction**: This does not change the special first jump of `扶摇直上 + 鸟翔碧空`. The combined opener keeps its old behavior; only Bird directional jumps without a live Fuyao consumption get the longer travel.
- **Frontend/UI update in the same pass**: `Esc` now prioritizes clearing target/self selection before opening the Esc menu. The Esc menu is now a checkbox-only `控制面板` with a three-column toggle grid and larger checkboxes. It directly toggles on-screen widgets: `灯光控制` at the top-left, `角色状态` around `x=5% / y=50%`, `体积碰撞开关` now rendered as two simple top-right checkbox boxes (`显示碰撞体`, `显示蓝本`) instead of a titled sub-panel, `显示屏幕坐标` as its own top-right checkbox box, and `距离测试` at `x=70% / y=60%`. `跳跃细节` and `显示距离地面的距离` remain independent jump/height HUD toggles. The old blur-backed overlay style is removed, and the obsolete desktop joystick-mode switch UI was removed without changing touch controls.
- **Runtime verification note**: A previous PM2 tail showed stale frontend `EADDRINUSE :3000` lines even though the app later came up cleanly. `pm2 flush && pm2 restart all` is a useful follow-up when validating restart health so the next log read reflects only the latest boot. After a clean restart, frontend logs were clean, while backend still emitted repeated `[MOVEMENT] GameLoop not active ...` warnings that appear unrelated to this UI pass.
- **Files**: `backend/game/engine/loop/movement.ts`, `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`, `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.module.css`, `.github/copilot-instructions.md`

### 165.19 Mid-air facing must stay authoritative, and the combined 扶摇+鸟翔 opener can now use the boosted forward budget
- **Bug**: During jump airtime, the frontend kept rotating the avatar and facing display, but the backend skipped its facing-update branch entirely. That meant mid-air turns looked correct locally while server-facing stayed frozen, so directional dashes and front-facing ability checks could still use the old jump-start direction.
- **Fix**: Apply explicit `input.facing` on the backend even during jump airtime, while still leaving the one intentional RMB-diagonal display mismatch to the client payload rule. This lets players turn mid-jump and have the authoritative facing update for later dashes.
- **Rule update**: The special `扶摇直上 + 鸟翔碧空` directional opener no longer falls back to the old `6u` travel budget. When the combined opener consumes a live Fuyao boost, it now uses the same boosted forward budget as a Fuyao directional jump, and the frontend prediction mirrors that change.
- **Visual update**: The selected facing hemisphere in `scene/Character.tsx` was still positioned for the older larger avatar. Move the arc origin closer to the current body and expand the facing display radius to `7u` so the indicator no longer floats with a visible gap in front of the character.
- **Runtime verification note**: PM2 restart failures on this repo can come from stray manual dev servers, not only stale PM2 children. In this pass, a standalone `ts-node index.ts` backend on `5000` and a standalone `next dev` / `next-server` frontend on `3000` kept causing `EADDRINUSE` during PM2 restarts. When that happens, inspect the live listeners and kill the occupying processes first, then `pm2 flush` and restart again.
- **Files**: `backend/game/engine/loop/movement.ts`, `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`, `frontend/app/game/screens/in-game/components/BattleArena/scene/Character.tsx`

### 165.20 Unit rescale mistake: ability-layer distances were scaled when only locomotion needed scaling
- **Mistake**: Dash distance, cast range, and knockback were multiplied by `2.2` on top of the locomotion rescale. That made abilities travel/check farther than the user intended.
- **Fix**: Keep the `2.2` conversion only in movement/jump physics. Remove it from `DirectionalDash.ts`, `Dash.ts`, `validateAction.ts`, and `GameLoop.ts` knockback so ability numbers remain literal.
- **Files**: `backend/game/engine/effects/definitions/DirectionalDash.ts`, `backend/game/engine/effects/definitions/Dash.ts`, `backend/game/engine/rules/validateAction.ts`, `backend/game/engine/loop/GameLoop.ts`, `backend/game/engine/loop/movement.ts`

### 165.21 Explicit steer-dash speeds can still be old-scale even after dash-distance rollback
- **Bug**: `踏星行` and `穹隆化生` were still using authored `speedPerTick` values like `0.4166667`, which are old-scale movement units per tick. After removing the broader dash-distance scaling, those two became obviously too slow.
- **Attempted fix (later reverted)**: Scaling authored `speedPerTick` through `UNIT_SCALE` in `movement.ts` made `踏星行` far too fast. The correct resolution is to keep authored `speedPerTick` literal and retune per-ability values where needed.
- **Audit result**: Frontend has no separate active-dash physics for the local player; active dashes are server-authoritative. Jump prediction in `BattleArena.tsx` still mirrors backend jump constants and was not double-scaled the way dash/range had been.
- **Files**: `backend/game/engine/loop/movement.ts`, `backend/game/abilities/abilities.ts`, `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`

### 165.22 Correction: explicit steer-dash `speedPerTick` values are literal authored units
- **Correction**: The runtime `movement.ts` scaling above was wrong for authored `speedPerTick`. `踏星行` should stay at `12.5 u/s` (`0.4166667` per tick) with no extra runtime multiplier, while `穹隆化生` should be authored directly as `33 units / 2 seconds = 0.55` per tick.
- **Requested tuning**: `疾` reverted to a `1s` dash, and `散流霞` now completes its `10-unit` forward dash in `0.5s`.
- **Files**: `backend/game/engine/loop/movement.ts`, `backend/game/abilities/abilities.ts`

### 165.23 Uneven exported terrain can sink flat ground-effect visuals below the floor
- **Bug**: AOE rings/discs for effects like `穹隆化生`, `风来吴山`, `狂龙乱舞`, and `百足` were rendered at raw `zone.z` / `player.z`, so on non-flat exported terrain parts of the visual could clip underground.
- **Fix**: In `ArenaScene.tsx`, clamp effect visuals to the local support ground under the zone center in `collision-test` mode and add a small vertical lift so the full animation stays above the floor.
- **Files**: `frontend/app/game/screens/in-game/components/BattleArena/scene/ArenaScene.tsx`, `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`

### 165.24 Exported-map ground casts need their own pointer surface
- **Bug**: `百足` ground-cast stopped working after switching to the exported collision-test map because `ArenaScene` only forwarded pointer events through the old flat `Ground` component. The exported-map path rendered no interactive cast surface, so ground preview/click never fired.
- **Fix**: Add pointer props to `ExportedMapScene` and attach them to an invisible-but-raycastable plane sized to the map. This restores ground-target preview and click casting for abilities like `百足` in collision-test mode.
- **Files**: `frontend/app/game/screens/in-game/components/BattleArena/scene/ExportedMapScene.tsx`, `frontend/app/game/screens/in-game/components/BattleArena/scene/ArenaScene.tsx`

### 165.25 Base movement must be normalized across all control modes
- **Bug**: Traditional mode already sent normalized `dx/dy`, but the backend boolean-input path summed `up/down/left/right` directly. That made joystick/boolean diagonal movement faster than the intended base speed.
- **Fix**: Normalize boolean movement vectors in `movement.ts` before multiplying by `effectiveMoveSpeed`. The configured base move speed remains `0.3666667` world units per tick, which is exactly `5.0` new units per second after dividing by `2.2` and multiplying by `30Hz`.
- **Testing method**: Add a `Base Move Speed Test` widget in `BattleArena.tsx` that shows configured base speed, live measured speed, and a base-only capture that ignores dash / jump / speed-buff samples.
- **Files**: `backend/game/engine/loop/movement.ts`, `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`

### 165.26 RMB strafe facing + jump-phase travel budgets (2026-04-14)
- **Bug**: In traditional RMB movement, `A/D` strafe and `W+A/D` diagonal movement moved correctly but the avatar kept facing camera-forward because both the raw mouse-drag path and the movement POST always forced facing from `camYaw` instead of the actual move vector.
- **Definition**: RMB `A/D` strafe and RMB `W+A/D` diagonal facing are frontend-only visuals. The local avatar can render facing sideways/diagonal, but backend-facing stays camera-forward in traditional RMB mode so facing-based abilities still use the forward direction.
- **Jump-system mismatch**: The old jump logic mixed preserved XY momentum with a generic air-steering limiter. That could not match the requested rules: upward jump with one locked 2-unit air shift over 1 second, and directional jump with a fixed 6-unit travel budget scaled from move speed at jump start and spread over that jump phase's airtime.
- **Fix**:
  - Frontend `BattleArena.tsx` now derives one shared traditional-mode movement intent and uses it for both the rendered local-facing and the movement POST, but the POST sends backend-facing separately.
  - RMB `A/D` and RMB `W+A/D` now rotate the rendered facing to the actual movement direction immediately; pure backpedal still keeps facing unchanged.
  - Upward-jump drift is translation-only. Locking the mid-air drift direction must NOT rotate facing on either backend or frontend.
  - Backend `movement.ts` now zeroes horizontal velocity on jump start and treats each jump as its own phase: upward jump arms a 2-unit one-direction air shift that locks on the first airborne input for up to 1 second, while directional jump immediately locks direction and spends a 6-unit budget across the jump's remaining airtime, scaled by the move-speed snapshot taken when the jump starts.
  - The abrupt mid-air "drop straight down" feeling came from directional jumps consuming their horizontal budget over a fixed 1 second while the vertical arc lasted longer. Estimating airtime per jump phase fixes that.
  - Follow-up airborne jumps were under-scaling because jump distance only looked at buffed run speed. The fix is to carry forward the latest special airborne planar speed snapshot (for example, dash speed) and let the next jump phase scale from that when it is higher than base movement speed.
  - Frontend prediction also had a dash-end bug: it reset local jump state to grounded even when the backend kept the player airborne with one remaining jump. Local dash-end state now mirrors backend airborne/grounded handling.
  - Double-jump snapping root cause: jump is a one-shot pulse, but movement input was being overwritten every packet. A later non-jump movement packet could replace the pending jump before the next loop tick consumed it, and frontend movement fetch aborts made that even easier to reproduce. The fix is to latch pending jump input in `GameLoop.setPlayerInput()` until a tick clears it, stop aborting movement POSTs in the frontend, and send monotonic movement sequence numbers so stale packets cannot overwrite newer input.
  - Collision-test jump overshoot + end-snap root cause: the exported-map BVH step-up rule was allowed to fire during jump airtime. On rising terrain this could snap a player to the floor while they were still about 0.5 gameplay units above it, which made the jump visibly drop at the end and resumed normal ground movement early, inflating measured forward distance far beyond the intended 6-unit base jump. Restricting BVH step-up to non-jump states fixes both the snap and the distance inflation. Backend simulation after the fix measured about 5.88u at base speed, 12.00u at +100% move speed, and 2.94u at -50% speed on the collision-test map.
  - Later confirmation: one of the reported "12-unit single jump" readings was not jump travel at all. It was the center HUD value showing player-to-target distance. That display must be labeled explicitly as target distance so it is not confused with jump-range telemetry.
  - Later WASD changes in the same jump phase are ignored until the next jump or landing.
- **Disproved approach**: Only fixing facing was not enough. As long as the old airborne velocity steering stayed in place, jump distance still depended on preserved momentum and mid-air redirection, so it could not hit deterministic 6-unit / 12-unit directional jump ranges.
- **Files**: `backend/game/engine/loop/movement.ts`, `backend/game/engine/loop/GameLoop.ts`, `backend/game/engine/state/types/state.ts`, `backend/game/routes/gameplay.routes.ts`, `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`

---


## 166. Unit Rescale (2026-04-14)

**Problem**:
Maps imported from real games have a different scale than our original arena. Measurement confirmed: a specific house is 22 units tall in our world and 10 units in the reference game → ratio = 2.2. Without rescaling, the player moves too slowly across the map and attack/dash ranges feel short.

**Solution — `UNIT_SCALE = 2.2` (1 new unit = 2.2 old world units)**:
All game-design values (move speed, jump heights, dash distances, ranges, knockback) stay the same **numbers** in abilities.ts and configs. The physics/validation code multiplies by `UNIT_SCALE = 2.2` at every point where a design value is converted to a world-coordinate displacement.

### 166.1 Collision-test canonical-unit migration (2026-04-14)
- Collision-test runtime now stores canonical gameplay units directly (`state.unitScale = 1`) instead of relying on the legacy `2.2` stored scale.
- Legacy modes keep their previous stored scale (`state.unitScale = 2.2`) so their behavior stays stable.
- Collision-test map boundaries, spawn positions, frontend collision-test AABBs, and exported-map render/BVH bridge constants are now converted once at the asset boundary. Gameplay code no longer needs extra `/ 2.2` or `* 2.2` math in collision-test mode.
- Shared helpers (`calculateDistance`, `gameplayUnitsToWorldUnits`, `worldUnitsToGameplayUnits`) now read the active state's stored-unit scale so range checks, dash travel, ground zones, and pickup ranges stay consistent across modes.
- Frontend collision-test prediction, jump telemetry, movement-speed HUD, range checks, pickup distance labels, and measurement tools now display and simulate the same canonical units the backend stores.
- Remaining legacy-scale references are now intentionally isolated to compatibility paths for non-collision-test modes or to the one-time import bridge from raw exported assets.

**Files changed**:
| File | What changed |
|---|---|
| `backend/game/engine/loop/movement.ts` | Added `UNIT_SCALE=2.2`; all GRAVITY/VZ jump constants now include `×2.2`; `AIR_NUDGE_TOTAL_DISTANCE = 1 × 2.2`; dead zones for dash angle capture scaled ×2.2; `snapUpUnits` and `diveVzPerTick` multiplied by `UNIT_SCALE` at apply-time |
| `backend/game/services/battle/battleService.ts` | `moveSpeed: 0.1666667 → 0.3666667` |
| `backend/game/routes/draft.routes.ts` | Same moveSpeed update |
| `backend/game/engine/effects/definitions/DirectionalDash.ts` | Added `UNIT_SCALE`; `worldDistance = distance × 2.2` used for `vxPerTick`, `vyPerTick`, angle caps, arc peak height, route-damage endpoint, and route radius |
| `backend/game/engine/effects/definitions/Dash.ts` | Added `UNIT_SCALE`; stop distance 1→2.2 world units; dash speed ×2.2 |
| `backend/game/engine/rules/validateAction.ts` | Added `UNIT_SCALE`; range check: `distance > ability.range × 2.2`; minRange check: `distance < ability.minRange × 2.2` |
| `backend/game/engine/loop/GameLoop.ts` | `knockbackUnits` multiplied by `UNIT_SCALE` (inline constant) before applying to position |
| `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx` | `MAX_SPEED` and all GRAVITY/VZ prediction constants scaled ×2.2; `AIR_NUDGE_TOTAL_DISTANCE = 2.2`; fallback `baseMoveSpeed` updated |

**Key principle**:
**Never change the numbers in abilities.ts** (range: 20, value: 1.7, etc.). Only scale at the physics/validation boundary. This way the design intent is readable in one place and the scale factor is in one constant (`UNIT_SCALE = 2.2`).

### 166.2 Follow-up clarification — gameplay range must use new units end-to-end (2026-04-14)
- **Problem**: After jump rescaling was fixed, several other systems still mixed raw map distance with authored gameplay distance. Result: jump telemetry could say `6u`, but cast range, dash travel, target distance HUD, and some zone radii still behaved like the old raw coordinate system.
- **Definition**:
  - Raw player/map positions remain in legacy world coordinates.
  - Authored gameplay numbers in abilities and configs are in new world units.
  - Conversion rule: `1 new unit = 2.2 old/raw units`, so `raw = new × 2.2` and `new = raw / 2.2`.
- **Fix**:
  - Added shared conversion helpers in `backend/game/engine/state/types/position.ts`.
  - Backend `calculateDistance()` now returns new-unit distance so cast validation, channel break range, timed AOE range, and buff cancel-on-range all compare in the same unit system as ability definitions.
  - Any backend geometry that must stay in raw coordinate space now converts authored new units explicitly before writing world-space values: directional dash travel, dash stop distance/speed, route radius, arc height, ground-zone radii, and forward zone offsets.
  - Frontend target distance display, selected-opponent nameplate distance, local range gating, pickup distance readouts, and ground-cast preview radius now convert raw coordinates back into new units for display/comparison.
- **Practical result**:
  - `蹑云逐月` authored as `value: 20` should travel `20` new units, which is `44` raw map units.
  - A measured raw separation of `13.2` means `6` new units.

### 166.3 Remaining blocker — canonical runtime state is still raw coordinates (2026-04-14)
- **Unresolved issue**: The project still has two unit systems in runtime architecture. New units are the gameplay/design language, but core stored coordinates and imported collision/map assets are still raw/legacy units.
- **Where raw units still fundamentally own the data**:
  - `backend/game/engine/state/types/position.ts`: `Position.x/y/z` are still stored as raw coordinates; conversion helpers wrap around them.
  - `backend/game/engine/state/types/map.ts`: `MapObject` is still documented in generic "world units" rather than explicitly new units, and current map objects use raw values.
  - `backend/game/map/exportedMap.ts` and `frontend/.../collisionTestMap.ts`: exported entity AABBs are stored in raw coordinates.
  - `backend/game/map/exportedMapCollision.ts` and `frontend/.../scene/ExportedMapScene.tsx`: collision/render transforms still depend on raw export-space constants (`BASE_RENDER_SF`, `MAP_SCALE`, `GROUP_POS_*`).
  - `backend/game/engine/loop/movement.ts` and `frontend/.../BattleArena.tsx`: jump/movement physics still multiply by `2.2` because movement state is raw.
  - `backend/game/routes/gameplay.routes.ts`: pickup inspect/claim ranges are still compared directly against raw XYZ deltas.
- **Migration direction**:
  - Make new units the only canonical runtime unit for `Position`, `Velocity`, `moveSpeed`, `MapObject`, ground-zone radius/height, and all gameplay interactions.
  - Convert imported/exported map assets from raw to new units once at load/build time instead of converting distances repeatedly during gameplay.
  - Keep only render/BVH-space transforms that are unrelated to the old-vs-new gameplay unit distinction.

### 166.4 新增锁足技能与锁足施法限制联动 (2026-04-19)
- **需求实现**: 新增 `五方行尽`（`wufang_xingjin`）为类百足的对地/对目标范围技能，半径 `6`，命中立即造成 `1` 点伤害并附加 `10s ROOT`。
- **实现要点**: 不复用 `BAIZU_AOE` 的硬编码分支，而是新增独立效果 `WUFANG_XINGJIN_AOE`，避免错误复用百足专属标记与 buff 名称匹配逻辑。
- **施法限制经验**: ROOT 默认只限制移动与转向，不限制施法。若要实现“部分技能被锁足时不可放”，应新增能力级布尔属性（`cannotCastWhileRooted`）并在 `validateCastAbility` 与 `validatePlayAbility` 同步校验。
- **默认赋值范围**: 该属性默认开启于四个通用位移轻功（`蹑云逐月/迎风回浪/凌霄揽胜/瑶台枕鹤`）以及 `后撤`、`疾`、`鸟翔碧空`，并同步下发到 preload 与前端就绪判断，避免前后端判定漂移。
- **免疫联动确认**: `女娲补天` 通过 `ROOT_SLOW_IMMUNE` 生效；`addBuff()` 会在敌方施加前先过滤 `ROOT/SLOW`，过滤后若无剩余效果直接返回，因此 `五方行尽` 在女娲状态下仍可吃到伤害但不会被锁足。

### 166.5 五方行尽地面施法、递减层数与后半段受击解除修正 (2026-04-19)
- **灰置根因**: 前端 readiness 在无选中目标时仍会回退检查首个敌人距离，导致可对地施法技能在敌人超距时被错误置灰。
- **修正**: 对 `allowGroundCastWithoutTarget` 技能，在“未选中目标”分支直接判定可施放（仍保留自身控制/冷却/姿态限制），不再被回退目标距离和朝向条件误伤。
- **双层递减根因**: `五方行尽` 的 ROOT 既在自定义 `WUFANG_XINGJIN_AOE` 分支施加，又被通用 `applyAbilityBuffs()` 额外施加一次，导致同次命中触发两次 ROOT 递减。
- **修正**: 将 `wufang_xingjin` 标记为自定义施加路径，跳过通用 buff 自动附加，确保每次命中只结算一次 ROOT。
- **后半段受击解除实现**: 新增 `buffId=1331` 保护 buff（“被击不会解除五方锁足”）。每次成功施加 ROOT 后，按实际 ROOT 持续时间的 `50%` 动态生成保护时长；ROOT 进入后半段后，目标每次受伤按 `100%` 概率移除 `buffId=1330`。
- **时长缩放要点**: 保护 buff 时长不写死 5 秒，而是读取本次实际落地 ROOT 的 runtime 持续时间（已包含递减），再按一半计算，确保 `10s -> 5s`、`5s -> 2.5s` 等比例保持正确。

### 166.6 条件强化技能“棒打狗头”实现经验 (2026-04-19)
- **核心机制**: 技能基础为 `0` 基础冷却且吃 GCD；命中无 `心怵·一` 目标时施加 `2s ROOT + 心怵·一(6s, 易伤6%)`。
- **升级分支**: 若目标已有 `心怵·一`，则移除 `心怵·一`，改为施加 `棒打狗头·定身(2s CONTROL)` 和 `心怵·二(6s, 易伤6%)`，并将本次技能实例冷却提升为 `16s`。
- **冷却判定实现**: 通过施放后检查目标是否在本次施放窗口内获得 `心怵·二`（`appliedAt` 时间窗）来触发 16 秒冷却覆盖，避免在未触发升级分支时误加长冷却。

### 166.7 读条同步与充能并行恢复修正 (2026-04-19)
- **读条问题根因**: 后端在每个广播 tick 都重复下发 `activeChannel`，前端读条又使用 `animationDelay` 反复重算 CSS 动画，叠加后会出现进度条观感“忽快忽慢/重置感”。
- **修正**: `GameLoop` 仅在 `activeChannel` 内容变化时下发 diff（开始/变化/结束），前端 `ChannelBar` 改为按当前时间直接计算宽度（forward/reverse 都用显式 width），不再依赖重复重启动画。
- **截阳充能根因**: 原实现是单一 `chargeRegenTicksRemaining` 串行恢复，连续消耗多层后会出现“回到 2 层后还要等一整段才回 3 层”的体感停顿。
- **修正**: 改为缺失层独立并行恢复队列 `_chargeRegenQueueTicks`，每次消耗新增一个恢复计时；循环内统一推进并在完成时批量返还层数，同时继续对前端暴露最近一层的 `chargeRegenTicksRemaining` 供 UI 进度显示。

### 166.8 新技能实现与位移预测核对 (2026-04-19)
- **新增技能**: `云栖松`（12s 60% 闪避 + 5s 每秒回 1，吃 GCD）、`捉影式`（0.5s 无 GCD 读条，结束拉到施法者前方 1 尺并附加 `滞影` 封轻功 5s）、`守如山`（8s 80% 减伤）。
- **新效果类型**: 新增 `TIMED_PULL_TARGET_TO_FRONT` 并在 `GameLoop` 读条完成分支处理，落点后执行碰撞解算与地面高度修正，再附加 `滞影` debuff。
- **前端预测核对**: 本次位移属于“目标被敌方技能拉拽”的后端权威位置更改，`BattleArena.tsx` 当前没有对敌方受控位移做本地预测分支，表现以服务端位置同步为准；本次无需额外前端预测公式改动。

### 166.9 捉影式时序与空中拉拽修正 (2026-04-19)
- **绝脉时长修正**: `截阳` 的 `绝脉` 若需作为持续压制 debuff，6 秒会过短。将 buff 时长从 `6_000ms` 调整为 `30_000ms`。
- **读条顺滑度经验**: 读条条本地进度若按 `setInterval(50ms)` 驱动，会有明显“台阶感”。改为 `requestAnimationFrame` 后，进度更新与浏览器渲染节奏一致，观感更连贯。
- **空中拉拽经验**: 拉拽逻辑若只取地面高度会把目标强制贴地，破坏空战手感。应以施法者当前 Z 为目标高度上限（且不低于地面），实现“施法者在空中时目标也被拉到空中”。
- **拉拽同步经验**: 即时改坐标会造成“看起来没拉拽过程”的不同步体感。把捉影改为目标 `activeDash` 位移（30 tick 基准）后，后端逐 tick 推进、前端按同一 runtime 状态渲染，1 秒 20 单位拉拽的时间感更稳定。
- **技能体验修正**: `捉影式` 射程提升到 `35`，并设置读条不因移动/跳跃中断；命中后仍附加 `滞影（封轻功）5秒`。

### 166.10 Bug fixes and new abilities (2026-04-21)

#### Bug fix: buffRuntime.ts stacking increment
- **Root cause**: Stack increment was hardcoded `+ 1` regardless of `initialStacks`.
- **Fix**: Changed to `+ (runtimeBuff.initialStacks ?? 1)` — re-applying 截阳 now correctly adds 3 stacks of 绝脉 per cast.

#### Bug fix: GameLoop.ts TIMED_AOE_DAMAGE range check (world units vs gameplay units)
- **Root cause**: Range check used raw `Math.sqrt(dx*dx+dy*dy+dz*dz)` in world units, but `e.range` is in gameplay units. This caused 心诤 final AOE to never fire because the world-unit distances were much larger than the 10-unit gameplay range.
- **Fix**: Replaced raw distance with `calculateDistance(player.position, opp.position, storedUnitScale)` which returns gameplay units. Also fixed the cone angle check to use its own local dx/dy vars.

#### Item 3: 烟雨行 jump consumption
- Added check `dash.abilityId === "yan_yu_xing"` at both dash-start and dash-end-airborne points in movement.ts, setting `player.jumpCount = MAX_JUMPS` (consumes all air jumps, prevents mid-dash or post-dash air jumping).

#### Item 4: 春泥护花 duration/stacks update
- Changed: `durationMs: 60_000 → 15_000`, `initialStacks: 8 → 5`, `maxStacks: 8 → 5`.

#### Item 5: combatMath.ts stack-scaled HEAL_REDUCTION
- `resolveHealAmount` now sums HEAL_REDUCTION × (buff.stacks ?? 1) across all debuffs instead of using `.find()`. Existing single-stack heal reduction buffs unaffected.

#### New effect type: GROUND_TARGET_DASH
- Added to `effects.ts` EffectType union and `categories.ts` map.
- Handler in `immediateEffects.ts`: computes direction from source to `castContext.groundTarget` (or opponent position), sets `source.facing`, then delegates to `handleDirectionalDash` with `dirMode: "TOWARD"`.

#### New abilities (2026-04-21)
- **万剑归宗** (wan_jian_gui_zong): SELF-target, no GCD, `AOE_APPLY_BUFFS` range 6 → ROOT 3s (buffId 2319) + 玄一 5 stacks HEAL_REDUCTION 10%/stack (buffId 2320, 30s).
- **孤风飒踏** (gu_feng_sa_ta): OPPONENT+allowGroundCastWithoutTarget, `GROUND_TARGET_DASH` 20u/0.5s (15 ticks), CLEANSE, no GCD. Uses 百足-style pending ground-cast mode: key press → setPendingGroundCastAbilityId, hover circle shown, left-click confirms, right-click cancels.
- **撼地** (han_di): OPPONENT+allowGroundCastWithoutTarget+qinggong, `GROUND_TARGET_DASH` 20u/0.5s (15 ticks), GCD, range 20. On land: AOE stun (5u/3s, buffId 2321). Handled in GameLoop.ts post-dash check. Uses 百足-style pending ground-cast mode.
- **跃潮斩波** (yue_chao_zhan_bo): OPPONENT, DIRECTIONAL_DASH TOWARD 20u/30 ticks, qinggong, GCD, range 25. On land: 15 damage to enemies within 8u world units. Handled in GameLoop.ts post-dash check.
- **无我无剑** (wu_wo_wu_jian): OPPONENT, DAMAGE 7, range 4, GCD.
- **听雷** (ting_lei): OPPONENT, range 4, no GCD, DAMAGE 3, mobile/airborne. Buff 听雷·伤 (buffId 2322, applyTo: "SELF", DAMAGE_MULTIPLIER 1.1 with restrictToAbilityId: 'ting_lei', 12s, maxStacks 3). DAMAGE_MULTIPLIER.restrictToAbilityId added to BuffEffect type; combatMath.ts skips restricted buffs unless abilityId matches; Damage.ts passes ability.id to resolveScheduledDamage.
- **绛唇珠袖** (jiang_chun_zhu_xiu): excluded from applyAbilityBuffs; cast-time applies only buff 2323 (debuff) via addBuff in PlayAbility.ts. Buff 2324 (silence) only fires via qinggong trigger in playService.ts.
- **鹤归孤山** (he_gui_gu_shan): GameLoop post-dash handler now pushes DAMAGE events for both base (10u AOE) and inner (4u) hits. After all opponent processing, applies 0.5s dash runtime buff (CONTROL_IMMUNE + KNOCKBACK_IMMUNE) to caster via applyDashRuntimeBuff.
- **Hover circle on walls**: ExportedMapScene.tsx getHitPoint now returns {point, isHorizontal} using face.normal.transformDirection(matrixWorld).y > 0.5. ArenaScene passes isHorizontal as 4th arg to onGroundPointerMove. groundCastPreview state tracks isValid; circle shows red (#ff3333) and uses raw hit Z (no getZoneVisualZ snap) when isValid === false.
- **绛唇珠袖** (jiang_chun_zhu_xiu): OPPONENT, range 22, GCD. Debuff 绛唇珠袖 (buffId 2323, 9s) on target. Trigger hook in playService.ts: after any qinggong ability is cast, if caster has buffId 2323, apply 绛唇珠袖·沉默 (buffId 2324, SILENCE 2s) via addBuff + 1 damage. Child buff 2324 declared in ability.buffs for preload visibility.
- **鹤归孤山** (he_gui_gu_shan): OPPONENT, DIRECTIONAL_DASH TOWARD 15u/30ticks, qinggong, GCD, range 25. Post-dash GameLoop handler: 2 damage + stun 3s (buffId 2325, via addBuff, triggers 眩晕递减) to enemies within 10u; extra 2 damage to enemies within 4u.
- **天地低昂** (tian_di_di_ang): SELF, instant, DAMAGE_REDUCTION 40% 10s (buffId 2326), allowWhileControlled: true. Normal buff via applyAbilityBuffs.
- **九转归一** (jiu_zhuan_gui_yi): OPPONENT, range 8, GCD. New effect type `KNOCKBACK_DASH` (value 12, durationTicks 18 = 12u ÷ 20u/sec × 30tick/sec, wallStunMs 4000). In immediateEffects.ts: checks `hasKnockbackImmune` first; sets `activeDash` on target with 18 ticks at 20u/sec; stores `_wallKnockSourceUserId` on target; applies KNOCKED_BACK buff (buffId 9201 "九转击退", 1000ms) via `addBuff`. After 18 ticks of movement, KNOCKED_BACK buff holds target locked for the remaining ~12 ticks = 1 second total CC. Wall hit: movement.ts sets `_wallKnockStunMs` + `_wallKnockAbilityId` on player; GameLoop removes buffId 9201 then calls `addBuff` for buffId 9202 "羽化" (CONTROL 4000ms) — triggers 眩晕递减 automatically.
- **Buff direct-push anti-pattern** (2026-04-22): Never use `buffs.push({...})` directly — bypasses status bar, immunity checks, 递减 system, and BUFF_APPLIED events. Always use `addBuff()`. For forced dashes on opponents, store caster's userId as `(target as any)._wallKnockSourceUserId` so GameLoop can use it as `sourceUserId` in the addBuff call.

---


## 167. Post-Pull Stun Pattern (极乐引)
- CONTROL buffs are blocked by CONTROL_IMMUNE which is applied at pull start alongside `activeDash`.
- Solution: `PULL_CHANNEL_POST_STUN_CONFIG` constant + `pendingPostPullStuns Map<targetUserId, ...>` class field in GameLoop. When pull activeDash clears (`dashStateBefore && !player.activeDash`), apply the stun via `addBuff` (which now passes since CONTROL_IMMUNE expired with the dash buff).


## 168. On-Play Trigger Hook (傍花随柳)
- Implemented directly in `PlayAbility.ts` at the end of `applyAbility()`. Check by `buffId === 2611`; decrement stacks; last stack → `ATTACK_LOCK` silence via `addBuff`; earlier stacks → direct `applyDamageToTarget` + DAMAGE event.
- `applyDamageToTarget` called directly (not via handleDamage) to bypass redirect/shields for this trigger damage, as intended.


## 169. 逐云寒蕊 (zhu_yun_han_rui) — first targetable HP-bearing entity

- Introduced new top-level `state.entities: TargetEntity[]` (separate from `groundZones`).
  Diffed/published like other state arrays. Defined in `backend/game/engine/state/types/state.ts` and re-exported via `state/types.ts` barrel.
- Cast pipeline plumbed `entityTargetId?` through:
  `gameplay.routes.ts` → `playService.playAbility` → `applyEffects` → `applyAbility` (PlayAbility.ts/executeAbility.ts) → `applyImmediateEffects` (`castContext.entityTargetId`).
- DAMAGE effect routes to entity HP when `castContext.entityTargetId` is set and effect is enemy-applied (skip player damage path entirely).
- Custom effect `PLACE_ZHU_YUN_HAN_RUI` creates the entity at caster's snapped ground Z and applies caster control-immune buff via `addBuff`.
- Buff 2715 covers ALL control levels: must include both `CONTROL_IMMUNE` and `KNOCKBACK_IMMUNE` effects (CONTROL_IMMUNE filter does not strip KNOCKED_BACK / PULLED — those are handled by `hasKnockbackImmune`).
- Per-tick stealth granting: GameLoop iterates entities → in-zone friendlies → entry timestamp + 1 s grant delay → `addBuff(2716)` with `breakOnPlay`. Buff 2716 has short `durationMs` (500 ms) refreshed every tick; out-of-zone immediately removes it. Death/expiry cascades via emit `BUFF_EXPIRED` for all stealth buffs sourced from the dying entity.
- Frontend: separate `selectedEntityId` state in BattleArena; mutually exclusive with `selectedTargetId`. OPPONENT-target abilities prefer player target if both set. Entity rendered via new `TargetEntityVisual` (clickable orb + ground ring + HP bar billboard).
- Gotcha: Custom effect type names must be added in 3 places: `effects.ts` EffectType union, `categories.ts` EFFECT_CATEGORY_MAP, AND `applyAbilityBuffs` exclusion list in `buffs.ts` if the handler manages buffs manually.
- GameLoop movement broadcasts must include `/entities` once targetable ability-created objects exist; otherwise entity HP/expiry/destruction changes never reach the client and zones appear stuck after their server-side expiry.
- For 逐云寒蕊-style hidden states, reuse the 散流霞 visual path only for transparency, but add a separate `hideHpBar` switch on the character renderer so enemy HP/name billboards can be suppressed without making the unit fully invisible.
- Tab targeting should use a live ref of all current targetable enemies (players + ability-created entities), not a stale opponent-only list captured by the keyboard effect.
- If PM2 restart races port 3000 and leaves stale `EADDRINUSE` lines, use a clean frontend-only restart: `pm2 stop frontend` -> kill `lsof -ti:3000` -> `pm2 flush frontend` -> `pm2 restart frontend`.
- Entity selection must feed the SAME top-center target HUD path as player selection. If `selectedEntityId` is handled only in cast checks, the object can technically be targetable but still feels unselectable to the player.
- Arena target feedback has 3 separate surfaces to keep in sync for non-player targets: top-center target panel, center distance label, and the 3D target line. Missing any one of them makes selection feel broken.
- Entity damage events should not reuse the owner player's `targetUserId`; otherwise frontend hit feedback attaches to the owner player instead of the entity. Emit `entityId`/`entityName` on DAMAGE events for targetable objects.
- For entity floating damage numbers, track per-entity projected screen bounds in the scene layer and use them when processing DAMAGE events from the local attacker.
- In large React arena components, never compute values for JSX inside an effect-local helper if the JSX reads them later. `selectedTargetDistance` was added inside a `useEffect` draft-ability block, so production build succeeded but runtime render crashed with `ReferenceError`. Put render-consumed target values in top-level render scope.

### 169.1 Entity-target combat surfaces (2026-04-22)
- **Custom effect handlers must consult `explicitEntityTarget`**: `applyImmediateEffects` previously set `effTarget = state.players[effTargetIndex]` for every effect in the loop. Custom handlers (BANG_DA_GOU_TOU, dash effects, AoE pulls) used that `effTarget` and ignored entity targeting, so casting a dash on a dummy actually flew toward the opposing player and damaged both.
  - Fix: when `explicitEntityTarget && enemyApplied`, override `effTarget` with the entity. Entities expose `userId / position / hp / buffs / shield` which is enough for `handleDash`, `addBuff`, and the existing damage helpers. Also patched `DIRECTIONAL_DASH` and `GROUND_TARGET_DASH` to take entity position when an entity is targeted.
- **Static dummies and pull**: dummies have no movement loop, so `JILE_YIN_AOE_PULL` and `TIMED_PULL_TARGET_TO_FRONT` previously silently no-op'd on entity targets. Workaround: teleport the entity to the pull endpoint (1u in front of caster for single-target pull, STOP_DISTANCE from caster for AoE pull) and still apply the PULLED buff for status visibility.
- **`getImmediateEnemyDamageTargets` already includes entities**, so `BAIZU_AOE` / `WUFANG_XINGJIN_AOE` / channel AoE damage paths require no change for Point 7.
- **Frontend selection of own dummies**: `TargetEntityVisual` previously gated `onClick` behind `!isOwn` which prevented inspecting friendly dummies. Removed the gate — users may always click any entity for selection / inspection. The cast layer still rejects entity targets owned by the caster (`getExplicitEnemyEntityTarget`), so this only affects HUD selection.
- **Target HUD label**: the top-center target panel hard-coded `${owner}的逐云寒蕊`. Added dummy-aware branch (`敌方木桩` / `友方木桩`) and made `entityOwner` lookup also include the local player so own-dummy ownership resolves correctly.
- **Dummy 3D model**: added a player-style cylinder body to `TargetEntityVisual` (radius 0.42, height 1.5, matching `Character.tsx`) so dummies are visible as upright cylinders rather than just a ring on the ground.
- **Layout**: cheat ability grid widened to `repeat(7, 32px)` (7 icons per row instead of 6) to use the previously empty horizontal space; control panel button + panel relocated to `right: 290` so the open cheat panel never covers them.


## 170. TargetEntity 综合战斗作业 (Round 2)

### 170.1 Pull on entities was a teleport
- TIMED_PULL_TARGET_TO_FRONT and JILE_YIN_AOE_PULL set entity position directly because there was no entity movement loop. Replaced with `entity.activeDash = { vxPerTick, vyPerTick, ticksRemaining }` plus a new entity integrator in `GameLoop.tickGame` (parallel to the player movement section). Use proportional duration based on `pullDistance / maxPullDistance` to keep speed consistent.

### 170.2 Ground-AOE on entity targeted player position
- 百足/无方·星辰 pulled `groundTarget ?? target.position` for AOE center. When the user has an entity selected (no mouse-ground), `target` is the opposing player. Fix: prefer `explicitEntityTarget.position` over `target.position` whenever no `groundTarget` is provided.

### 170.3 Tab cycling needed exclusion + front cone
- New rule: Tab/F1 must (a) exclude `currentSelectedId` so re-pressing always advances and (b) only consider candidates in the 180° front cone (`dot(facing, dir) > 0`). Implemented in `BattleArena.tsx` Tab handler. When no candidate found, silently keep current selection.

### 170.4 Knockback didn't push dummies
- Dummies have `buffs: []`; the bug was missing entity movement integrator (same root cause as Pull). After adding the entity activeDash tick, dummies are pushed correctly. **Never** whitelist entities — treat them like an unbuffed player; rely on `hasKnockbackImmune`/`blocksControlByImmunity` instead.

### 170.5 沧月 (multi-target test ability)
- Added EffectType `CANG_YUE_AOE` (3 registration sites: types/effects.ts, definitions/categories.ts, flow/play/buffs.ts exclusion list) plus ability `cang_yue` and a custom handler that:
  1. Damage 1 to primary (entity or player)
  2. addBuff knockdown 1340 (CONTROL 2s)
  3. Iterate `getImmediateEnemyBuffTargets` within 6u of primary (excluding primary by reference); for each non-immune target set `activeDash` (30u over 30 ticks) + addBuff KNOCKED_BACK 1341 1s.
- Used `t === primary` for dedupe (entities have no userId).
- Buff IDs collide easily — checked with grep `buffId: 1[3-4][0-9][0-9]` before picking 1340/1341 (1336/1337 already used by 无方/棒打 series).


## 171. TargetEntity Round 3 hotfix — entity collision crash + revert 沧月 angle

### 171.1 `resolveMapCollisions` is player-only (reads `velocity`)
- Calling `resolveMapCollisions(entity as any, mapCtx)` on a TargetEntity from the GameLoop entity-dash loop crashed with `TypeError: Cannot read properties of undefined (reading 'vz')` because both `resolveExportedRecovery` and `resolveObjectCollision` write/read `player.velocity.{vx,vy,vz}`. The crash threw mid-tick, so the cang_yue secondary knockback never executed (knockdown ran before the crash, hence "knockdown works, knockback doesn't") and clients were disconnected by the broken loop.
- Added `resolveEntityHorizontalCollision(ent, mapCtx)` in `movement.ts` which only does the BVH horizontal sphere resolve and never reads/writes velocity. Use this for any non-player object dashed by an ability.

### 171.2 沧月 angle reverted to primary-relative
- User confirmed primary-relative outward direction looks correct in practice. Reverted from caster-relative back to `victim − primary` outward (caster-relative fallback retained for the same-spot case).


## 172. 盾立 Reflect — Universal Coverage (round 2)
Issue: PlayAbility-level reflect was too narrow. AoE / channel-tick / zone-tick / dash-route / knockback / control-buff paths bypassed it. Many call sites pre-skipped via `if (hasDamageImmune) continue;` which blocked damage but never reflected.

Fix:
- Centralized reflect helper `backend/game/engine/effects/dunLiReflect.ts` already in place.
- Damage chokepoints now reflect: `handleDamage` (Damage.ts), `applyImmediateDamageToEnemyTarget` (immediateEffects.ts), `applyDamageToHostileTarget` (GameLoop.ts).
- Removed pre-immunity skips at GameLoop.ts (TIMED_AOE_DAMAGE, channel completion, CHANNEL_AOE_TICK_DAMAGE, 天绝地灭 explode) so the reflect-aware helper actually receives the call.
- Added 盾立 reflect for buffs in `addBuff()` (buffRuntime.ts) — any debuff applied to a 盾立 holder is redirected to caster (covers 帝骖龙翔, 极乐引 stun, etc).
- DirectionalDash route damage (疾) now checks immunity + reflects.
- 龙啸九天 knockback: redirects activeDash to caster when victim has 盾立.
- 极乐引 pull: skipped on 盾立 holder (buffs reflect via addBuff hook).

Lesson: damage/buff/movement reflection MUST hook at every chokepoint. Pre-immunity skips block reflection — remove them where the helper now handles immunity.


## 173. 盾立 Reflect — regression fixes after round 2

### 173.1 捉影式 reflected only the debuff, not the pull movement
- `TIMED_PULL_TARGET_TO_FRONT` in `GameLoop.ts` applied `activeDash` directly to the original target, then applied the qinggong-seal debuff via `addBuff()`. Result: 盾立 correctly reflected the debuff, but the 盾立 holder still got pulled.
- Fix: resolve `getDunLiReflectVictim(...)` inside the timed-pull branch and switch the actual movement recipient, post-pull stun recipient, 雷霆震怒 strip target, and qinggong-seal target to the reflected victim. For reflected pulls, anchor/facing now come from the 盾立 holder, so the original caster is pulled to the 盾立 holder’s front.

### 173.2 Ground-zone tick loops still had one raw `hasDamageImmune()` bypass
- The generic ground-zone damage loop (used by 狂龙乱舞 and similar persistent zones) still did `if (hasDamageImmune(target)) continue;` before calling `applyDamageToHostileTarget()`. That made the earlier reflect work look correct in helper code but unreachable in live zone ticks.
- Fix: remove the raw skip and let `applyDamageToHostileTarget()` handle both immunity and reflect.

### 173.3 百足 / 五方 need payload-only reflect, not cast-entry reflect
- `PlayAbility.ts` reflects any direct opponent-target cast before `applyImmediateEffects()`. For targetable area spells like 百足 and 五方行尽, that bounces the whole cast back to the caster, which is wrong because the zone/impact point should stay where the player aimed it. Only the emitted damage/root/DoT payload should reflect.
- Fix: skip cast-entry reflect for `BAIZU_AOE` and `WUFANG_XINGJIN_AOE`, and rely on downstream reflect-aware damage/buff handlers to redirect the payload only.


## 174. 盾立 Reflect — six-point follow-up round

### 174.1 百足 / 五方 still skipped 盾立 before the shared helper
- `getImmediateEnemyDamageTargets()` in `immediateEffects.ts` still filtered out `hasDamageImmune()` players/entities before BAIZU_AOE and WUFANG_XINGJIN_AOE reached `applyImmediateDamageToEnemyTarget()` / `addBuff()`. Result: the cast-entry reflect was gone, the zone place stayed correct, but the actual damage/root payload never saw the 盾立 target at all.
- Fix: remove the early damage-immune filter from `getImmediateEnemyDamageTargets()` and let the downstream damage/buff handlers handle immunity + reflect.

### 174.2 少明指 dispel payload had no reflect path of its own
- Both `DISPEL_BUFF_ATTRIBUTE` handlers (channel-completion in `GameLoop.ts` and immediate in `immediateEffects.ts`) directly stripped buffs from the current target with no `getDunLiReflectVictim()` step. For the channel case, dispel was also skipped if the prior damage leg set `channelEffectDodged`.
- Fix: resolve the dispel target through `getDunLiReflectVictim()` in both handlers. In the channel version, only skip dispel on `channelEffectDodged` when there was no 盾立 redirect.

### 174.3 振翅图南 / 飞刃回转 follow-zones must resolve 盾立 before choosing the follow target
- `PLACE_FOLLOW_ZONE` always attached the zone to the selected enemy target. If that target had 盾立, the zone still spawned on and followed them, which bypassed the intended direct-target reflect behavior for the follow lock-on itself.
- Fix: in `PLACE_FOLLOW_ZONE`, resolve the selected target through `getDunLiReflectVictim()` before setting the zone center / `followTargetUserId`.

### 174.4 极乐引 reflected only the CC buffs, not the pull movement
- The earlier hotfix explicitly `continue`d after reflecting the pull/stun buffs, so the activeDash pull never switched to the caster.
- Fix: resolve `pullSource` / `pullTarget` through `getDunLiReflectVictim()` and assign both the activeDash movement and the pull/stun buffs to the reflected target.

### 174.5 连环弩 used a fully custom tick path outside the shared damage helper
- The `lian_huan_nu` tick branch in `GameLoop.ts` did all of its own work: raw `!hasDamageImmune()` gating, manual `resolveScheduledDamage()`, direct `applyDamageToTarget()`, and direct `activeDash` knockback. That bypassed 盾立 reflect entirely. It also applied no actual `KNOCKED_BACK` CC state, so reflected knockback did not reliably break the caster’s channel.
- Fix: route damage through `applyDamageToHostileTarget()`, resolve the actual knockback victim through `getDunLiReflectVictim()`, add a short `KNOCKED_BACK` debuff when knockback lands, and explicitly clear `activeChannel` on the knockback victim so reflected self-knockback breaks 连环弩 immediately.


## 175. TLS cert mismatch incident: zhenchuan domain serving baizhan cert (2026-06-01)

### 175.1 What was verified
- Public endpoint `170.9.60.63:443` currently serves `CN=baizhan.renstoolbox.com` for both SNI and non-SNI handshakes.
- Local nginx on this VM serves `CN=zhenchuan.renstoolbox.com` correctly for `-servername zhenchuan.renstoolbox.com`.
- `zhenchuan` local cert is present and valid (`/etc/letsencrypt/live/zhenchuan.renstoolbox.com-0001/fullchain.pem`, expires 2026-08-09).
- Active local nginx config includes `sites-enabled/zhenchuan` with zhenchuan certificate paths.

### 175.2 Conclusion
- The public TLS terminator for `zhenchuan.renstoolbox.com` is not currently using this VM's zhenchuan cert chain.
- This is an ingress/DNS/LB-side mismatch, not an app runtime failure.

### 175.3 Operational lesson
- Always compare `public IP cert fingerprint` vs `local cert fingerprint` when a domain suddenly shows another host's certificate; this quickly distinguishes local nginx config issues from upstream ingress drift.


