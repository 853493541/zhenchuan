import express from "express";

import {
  buildCanCastWhileMountedSnapshot,
  buildAbilityEditorSnapshot,
  buildAbilityDescriptionReviewSnapshot,
  buildNoWeaponRequiredSnapshot,
  setAbilityAdControlStatus,
  buildHasteUnaffectedSnapshot,
  buildQinggongGcdImmuneSnapshot,
  buildQinggongSnapshot,
  setAbilityCanCastWhileMountedOverride,
  setAbilityDescriptionOverride,
  setAbilityDescriptionReviewStatus,
  setAbilityEditorDamageValue,
  setAbilityEditorNumericValue,
  setAbilityEditorProperty,
  setAbilityNoWeaponRequiredOverride,
  setAbilityHasteUnaffectedOverride,
  setAbilityQinggongGcdImmuneOverride,
  setAbilityQinggongOverride,
  setAbilityIsProjectile,
  setAbilityDunLiWhitelisted,
  setAbilityTag,
} from "../abilities/abilities";
import { AbilityPropertyId, TAG_GROUP_DEFINITIONS, TagGroupId } from "../abilities/abilityPropertySystem";
import {
  BUFF_ATTRIBUTES,
  BuffAttribute,
  BuffProperty,
  BUFF_PROPERTY_TYPES,
  buildBuffEditorSnapshot,
  buildBuffDescriptionReviewSnapshot,
  setBuffAttribute,
  setBuffDescription,
  setBuffDescriptionReviewStatus,
  setBuffHidden,
  setBuffName,
  setBuffProperties,
  setBuffDurationMs,
} from "../abilities/buffTagSystem";
import {
  buildQinYinGongMingSnapshot,
  setQinYinGongMingBuffOverride,
} from "../abilities/qinYinGongMing";
import {
  buildDamageReductionOverrideSnapshot,
  setDamageReductionOverride,
} from "../abilities/damageReductionOverride";
import {
  buildHiddenBuffSnapshot,
  setHiddenBuffOverride,
} from "../abilities/hiddenBuffs";
import {
  buildManualCancelableBuffSnapshot,
  setManualCancelableBuffOverride,
} from "../abilities/manualCancelableBuffs";
import {
  buildBuffTimerVisibilitySnapshot,
  setBuffTimerVisibilityOverride,
} from "../abilities/buffTimerVisibility";
import { getUserIdFromCookie } from "./auth";

const router = express.Router();

function handleAbilityEditorError(res: express.Response, error: unknown) {
  const message = error instanceof Error ? error.message : "ERR_UNKNOWN";

  if (message === "ERR_NOT_AUTHENTICATED") {
    return res.status(401).json({ error: message });
  }

  if (message === "ERR_ABILITY_NOT_FOUND") {
    return res.status(404).json({ error: message });
  }

  if (message === "ERR_BUFF_NOT_FOUND") {
    return res.status(404).json({ error: message });
  }

  if (
    message === "ERR_INVALID_ABILITY_PROPERTY" ||
    message === "ERR_PROPERTY_NOT_APPLICABLE" ||
    message === "ERR_INVALID_ABILITY_NUMERIC_FIELD" ||
    message === "ERR_INVALID_ABILITY_NUMERIC_VALUE" ||
    message === "ERR_INVALID_ABILITY_DESCRIPTION" ||
    message === "ERR_INVALID_DESCRIPTION_REVIEW_STATUS" ||
    message === "ERR_INVALID_BUFF_DESCRIPTION" ||
    message === "ERR_INVALID_BUFF_NAME" ||
    message === "ERR_INVALID_BUFF_PROPERTIES" ||
    message === "ERR_HIDDEN_BUFF_CANNOT_HAVE_ATTRIBUTE" ||
    message === "ERR_INVALID_TAG_GROUP" ||
    message === "ERR_INVALID_TAG_VALUE"
  ) {
    return res.status(400).json({ error: message });
  }

  console.error("[AbilityEditor] Route failure", error);
  return res.status(500).json({ error: "ERR_ABILITY_EDITOR_FAILED" });
}

router.get("/ability-editor", (req, res) => {
  try {
    getUserIdFromCookie(req);
    return res.json(buildAbilityEditorSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.get("/ability-editor/no-weapon-required", (req, res) => {
  try {
    getUserIdFromCookie(req);
    return res.json(buildNoWeaponRequiredSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.get("/ability-editor/can-cast-while-mounted", (req, res) => {
  try {
    getUserIdFromCookie(req);
    return res.json(buildCanCastWhileMountedSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.get("/ability-editor/description-review", (req, res) => {
  try {
    getUserIdFromCookie(req);
    return res.json(buildAbilityDescriptionReviewSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/description-review/:abilityId/status", (req, res) => {
  try {
    getUserIdFromCookie(req);
    const { status } = req.body ?? {};
    if (status !== "fixed" && status !== "needs-more" && status !== "unfixed") {
      return res.status(400).json({ error: "ERR_INVALID_DESCRIPTION_REVIEW_STATUS" });
    }
    return res.json(setAbilityDescriptionReviewStatus(req.params.abilityId, status));
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/description-review/:abilityId/description", (req, res) => {
  try {
    getUserIdFromCookie(req);
    const { description } = req.body ?? {};
    if (typeof description !== "string") {
      return res.status(400).json({ error: "ERR_INVALID_ABILITY_DESCRIPTION" });
    }
    return res.json(setAbilityDescriptionOverride(req.params.abilityId, description));
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/ad-control/:abilityId/status", (req, res) => {
  try {
    getUserIdFromCookie(req);
    const { status } = req.body ?? {};
    if (status !== "fixed" && status !== "needs-more" && status !== "unfixed") {
      return res.status(400).json({ error: "ERR_INVALID_DESCRIPTION_REVIEW_STATUS" });
    }
    return res.json(setAbilityAdControlStatus(req.params.abilityId, status));
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/no-weapon-required/:abilityId", (req, res) => {
  try {
    getUserIdFromCookie(req);

    const { mode } = req.body ?? {};
    if (mode !== "manual-include" && mode !== "manual-exclude" && mode !== "clear") {
      return res.status(400).json({ error: "ERR_INVALID_PAYLOAD" });
    }

    setAbilityNoWeaponRequiredOverride(req.params.abilityId, mode);

    return res.json(buildNoWeaponRequiredSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/can-cast-while-mounted/:abilityId", (req, res) => {
  try {
    getUserIdFromCookie(req);

    const { mode } = req.body ?? {};
    if (mode !== "manual-include" && mode !== "manual-exclude" && mode !== "clear") {
      return res.status(400).json({ error: "ERR_INVALID_PAYLOAD" });
    }

    setAbilityCanCastWhileMountedOverride(req.params.abilityId, mode);

    return res.json(buildCanCastWhileMountedSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/:abilityId/property", (req, res) => {
  try {
    getUserIdFromCookie(req);

    const { propertyId, enabled } = req.body ?? {};
    if (typeof propertyId !== "string" || typeof enabled !== "boolean") {
      return res.status(400).json({ error: "ERR_INVALID_PAYLOAD" });
    }

    setAbilityEditorProperty(
      req.params.abilityId,
      propertyId as AbilityPropertyId,
      enabled
    );

    return res.json(buildAbilityEditorSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/:abilityId/damage", (req, res) => {
  try {
    getUserIdFromCookie(req);

    const { damageId, value } = req.body ?? {};
    if (typeof damageId !== "string" || typeof value !== "number") {
      return res.status(400).json({ error: "ERR_INVALID_PAYLOAD" });
    }

    setAbilityEditorDamageValue(req.params.abilityId, damageId, value);

    return res.json(buildAbilityEditorSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/:abilityId/numeric", (req, res) => {
  try {
    getUserIdFromCookie(req);

    const { fieldId, value } = req.body ?? {};
    if (typeof fieldId !== "string" || typeof value !== "number") {
      return res.status(400).json({ error: "ERR_INVALID_PAYLOAD" });
    }

    setAbilityEditorNumericValue(req.params.abilityId, fieldId, value);

    return res.json(buildAbilityEditorSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/:abilityId/tag", (req, res) => {
  try {
    getUserIdFromCookie(req);
    const { tagGroup, value } = req.body ?? {};
    if (typeof tagGroup !== "string" || !TAG_GROUP_DEFINITIONS[tagGroup as TagGroupId]) {
      return res.status(400).json({ error: "ERR_INVALID_TAG_GROUP" });
    }
    const groupDef = TAG_GROUP_DEFINITIONS[tagGroup as TagGroupId];
    if (value !== null && (typeof value !== "string" || !(groupDef.values as readonly string[]).includes(value))) {
      return res.status(400).json({ error: "ERR_INVALID_TAG_VALUE" });
    }
    setAbilityTag(req.params.abilityId, tagGroup as TagGroupId, value as string | null);
    return res.json(buildAbilityEditorSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/:abilityId/is-projectile", (req, res) => {
  try {
    getUserIdFromCookie(req);
    const { isProjectile, mode } = req.body ?? {};
    const nextMode = mode ?? isProjectile;
    if (
      typeof nextMode !== "boolean" &&
      nextMode !== "manual-include" &&
      nextMode !== "manual-exclude" &&
      nextMode !== "clear"
    ) {
      return res.status(400).json({ error: "ERR_INVALID_PAYLOAD" });
    }
    setAbilityIsProjectile(req.params.abilityId, nextMode);
    return res.json(buildAbilityEditorSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/:abilityId/dun-li-whitelist", (req, res) => {
  try {
    getUserIdFromCookie(req);
    const { dunLiWhitelisted, mode } = req.body ?? {};
    const nextMode = mode ?? dunLiWhitelisted;
    if (
      typeof nextMode !== "boolean" &&
      nextMode !== "manual-include" &&
      nextMode !== "manual-exclude" &&
      nextMode !== "clear"
    ) {
      return res.status(400).json({ error: "ERR_INVALID_PAYLOAD" });
    }
    setAbilityDunLiWhitelisted(req.params.abilityId, nextMode);
    return res.json(buildAbilityEditorSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.get("/ability-editor/qinggong", (req, res) => {
  try {
    getUserIdFromCookie(req);
    return res.json(buildQinggongSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/qinggong/:abilityId", (req, res) => {
  try {
    getUserIdFromCookie(req);
    const { mode } = req.body ?? {};
    if (mode !== "manual-include" && mode !== "manual-exclude" && mode !== "clear") {
      return res.status(400).json({ error: "ERR_INVALID_PAYLOAD" });
    }
    return res.json(setAbilityQinggongOverride(req.params.abilityId, mode));
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.get("/ability-editor/qinggong-gcd-immune", (req, res) => {
  try {
    getUserIdFromCookie(req);
    return res.json(buildQinggongGcdImmuneSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/qinggong-gcd-immune/:abilityId", (req, res) => {
  try {
    getUserIdFromCookie(req);
    const { mode } = req.body ?? {};
    if (mode !== "manual-include" && mode !== "manual-exclude" && mode !== "clear") {
      return res.status(400).json({ error: "ERR_INVALID_PAYLOAD" });
    }
    return res.json(setAbilityQinggongGcdImmuneOverride(req.params.abilityId, mode));
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.get("/ability-editor/haste-unaffected", (req, res) => {
  try {
    getUserIdFromCookie(req);
    return res.json(buildHasteUnaffectedSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/haste-unaffected/:abilityId", (req, res) => {
  try {
    getUserIdFromCookie(req);
    const { mode } = req.body ?? {};
    if (mode !== "manual-include" && mode !== "manual-exclude" && mode !== "clear") {
      return res.status(400).json({ error: "ERR_INVALID_PAYLOAD" });
    }
    return res.json(setAbilityHasteUnaffectedOverride(req.params.abilityId, mode));
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

// ─── Buff attribute editor ───────────────────────────────────────────────────

router.get("/ability-editor/buffs", (req, res) => {
  try {
    getUserIdFromCookie(req);
    return res.json(buildBuffEditorSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.get("/ability-editor/qin-yin-gong-ming", (req, res) => {
  try {
    getUserIdFromCookie(req);
    return res.json(buildQinYinGongMingSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.get("/ability-editor/buff-description-review", (req, res) => {
  try {
    getUserIdFromCookie(req);
    return res.json(buildBuffDescriptionReviewSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/buff-description-review/:buffId/status", (req, res) => {
  try {
    getUserIdFromCookie(req);
    const buffId = parseInt(req.params.buffId, 10);
    if (!Number.isFinite(buffId)) return res.status(400).json({ error: "ERR_INVALID_BUFF_ID" });
    const { status } = req.body ?? {};
    if (status !== "fixed" && status !== "needs-more" && status !== "unfixed") {
      return res.status(400).json({ error: "ERR_INVALID_DESCRIPTION_REVIEW_STATUS" });
    }
    return res.json(setBuffDescriptionReviewStatus(buffId, status));
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/buff-description-review/:buffId/description", (req, res) => {
  try {
    getUserIdFromCookie(req);
    const buffId = parseInt(req.params.buffId, 10);
    if (!Number.isFinite(buffId)) return res.status(400).json({ error: "ERR_INVALID_BUFF_ID" });
    const { description } = req.body ?? {};
    if (typeof description !== "string") return res.status(400).json({ error: "ERR_INVALID_BUFF_DESCRIPTION" });
    setBuffDescription(buffId, description);
    return res.json(buildBuffDescriptionReviewSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/qin-yin-gong-ming/:buffId", (req, res) => {
  try {
    getUserIdFromCookie(req);

    const buffId = parseInt(req.params.buffId, 10);
    if (!Number.isFinite(buffId)) {
      return res.status(400).json({ error: "ERR_INVALID_BUFF_ID" });
    }

    const { mode } = req.body ?? {};
    if (mode !== "manual-include" && mode !== "manual-exclude" && mode !== "clear") {
      return res.status(400).json({ error: "ERR_INVALID_PAYLOAD" });
    }

    setQinYinGongMingBuffOverride(buffId, mode);

    return res.json(buildQinYinGongMingSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.get("/ability-editor/damage-reduction-override", (req, res) => {
  try {
    getUserIdFromCookie(req);
    return res.json(buildDamageReductionOverrideSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/damage-reduction-override/:buffId", (req, res) => {
  try {
    getUserIdFromCookie(req);

    const buffId = parseInt(req.params.buffId, 10);
    if (!Number.isFinite(buffId)) {
      return res.status(400).json({ error: "ERR_INVALID_BUFF_ID" });
    }

    const { mode } = req.body ?? {};
    if (mode !== "can-override" && mode !== "no-override" && mode !== "clear") {
      return res.status(400).json({ error: "ERR_INVALID_PAYLOAD" });
    }

    setDamageReductionOverride(buffId, mode);

    return res.json(buildDamageReductionOverrideSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.get("/ability-editor/manual-cancelable-buffs", (req, res) => {
  try {
    getUserIdFromCookie(req);
    return res.json(buildManualCancelableBuffSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/manual-cancelable-buffs/:buffId", (req, res) => {
  try {
    getUserIdFromCookie(req);

    const buffId = parseInt(req.params.buffId, 10);
    if (!Number.isFinite(buffId)) {
      return res.status(400).json({ error: "ERR_INVALID_BUFF_ID" });
    }

    const { mode } = req.body ?? {};
    if (mode !== "manual-include" && mode !== "manual-exclude" && mode !== "clear") {
      return res.status(400).json({ error: "ERR_INVALID_PAYLOAD" });
    }

    setManualCancelableBuffOverride(buffId, mode);

    return res.json(buildManualCancelableBuffSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.get("/ability-editor/buff-timer-visibility", (req, res) => {
  try {
    getUserIdFromCookie(req);
    return res.json(buildBuffTimerVisibilitySnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/buff-timer-visibility/:buffId", (req, res) => {
  try {
    getUserIdFromCookie(req);

    const buffId = parseInt(req.params.buffId, 10);
    if (!Number.isFinite(buffId)) {
      return res.status(400).json({ error: "ERR_INVALID_BUFF_ID" });
    }

    const { mode } = req.body ?? {};
    if (mode !== "manual-include" && mode !== "manual-exclude" && mode !== "clear") {
      return res.status(400).json({ error: "ERR_INVALID_PAYLOAD" });
    }

    setBuffTimerVisibilityOverride(buffId, mode);

    return res.json(buildBuffTimerVisibilitySnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.get("/ability-editor/hidden-buffs", (req, res) => {
  try {
    getUserIdFromCookie(req);
    return res.json(buildHiddenBuffSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/hidden-buffs/:buffId", (req, res) => {
  try {
    getUserIdFromCookie(req);

    const buffId = parseInt(req.params.buffId, 10);
    if (!Number.isFinite(buffId)) {
      return res.status(400).json({ error: "ERR_INVALID_BUFF_ID" });
    }

    const { mode } = req.body ?? {};
    if (mode !== "manual-include" && mode !== "manual-exclude" && mode !== "clear") {
      return res.status(400).json({ error: "ERR_INVALID_PAYLOAD" });
    }

    setHiddenBuffOverride(buffId, mode);

    return res.json(buildHiddenBuffSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/buffs/:buffId/attribute", (req, res) => {
  try {
    getUserIdFromCookie(req);

    const buffId = parseInt(req.params.buffId, 10);
    if (!Number.isFinite(buffId)) {
      return res.status(400).json({ error: "ERR_INVALID_BUFF_ID" });
    }

    const { attribute } = req.body ?? {};
    if (typeof attribute !== "string" || !(BUFF_ATTRIBUTES as string[]).includes(attribute)) {
      return res.status(400).json({ error: "ERR_INVALID_ATTRIBUTE" });
    }

    setBuffAttribute(buffId, attribute as BuffAttribute);

    return res.json(buildBuffEditorSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/buffs/:buffId/description", (req, res) => {
  try {
    getUserIdFromCookie(req);

    const buffId = parseInt(req.params.buffId, 10);
    if (!Number.isFinite(buffId)) {
      return res.status(400).json({ error: "ERR_INVALID_BUFF_ID" });
    }

    const { description } = req.body ?? {};
    if (typeof description !== "string") {
      return res.status(400).json({ error: "ERR_INVALID_BUFF_DESCRIPTION" });
    }

    setBuffDescription(buffId, description);

    return res.json(buildBuffEditorSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/buffs/:buffId/name", (req, res) => {
  try {
    getUserIdFromCookie(req);

    const buffId = parseInt(req.params.buffId, 10);
    if (!Number.isFinite(buffId)) {
      return res.status(400).json({ error: "ERR_INVALID_BUFF_ID" });
    }

    const { name } = req.body ?? {};
    if (typeof name !== "string") {
      return res.status(400).json({ error: "ERR_INVALID_BUFF_NAME" });
    }

    setBuffName(buffId, name);

    return res.json(buildBuffEditorSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/buffs/:buffId/hidden", (req, res) => {
  try {
    getUserIdFromCookie(req);

    const buffId = parseInt(req.params.buffId, 10);
    if (!Number.isFinite(buffId)) {
      return res.status(400).json({ error: "ERR_INVALID_BUFF_ID" });
    }

    const { hidden } = req.body ?? {};
    if (typeof hidden !== "boolean") {
      return res.status(400).json({ error: "ERR_INVALID_PAYLOAD" });
    }

    setBuffHidden(buffId, hidden);

    return res.json(buildBuffEditorSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/buffs/:buffId/properties", (req, res) => {
  try {
    getUserIdFromCookie(req);

    const buffId = parseInt(req.params.buffId, 10);
    if (!Number.isFinite(buffId)) {
      return res.status(400).json({ error: "ERR_INVALID_BUFF_ID" });
    }

    const { properties } = req.body ?? {};
    if (!Array.isArray(properties)) {
      return res.status(400).json({ error: "ERR_INVALID_BUFF_PROPERTIES" });
    }

    for (const prop of properties) {
      if (!prop || typeof prop !== "object") {
        return res.status(400).json({ error: "ERR_INVALID_BUFF_PROPERTIES" });
      }
      if (!(BUFF_PROPERTY_TYPES as string[]).includes(prop.type)) {
        return res.status(400).json({ error: "ERR_INVALID_BUFF_PROPERTIES" });
      }
      if (prop.value !== undefined && (typeof prop.value !== "number" || !Number.isFinite(prop.value))) {
        return res.status(400).json({ error: "ERR_INVALID_BUFF_PROPERTIES" });
      }
      if (prop.noOverride !== undefined && typeof prop.noOverride !== "boolean") {
        return res.status(400).json({ error: "ERR_INVALID_BUFF_PROPERTIES" });
      }
    }

    setBuffProperties(buffId, properties as BuffProperty[]);

    return res.json(buildBuffEditorSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

router.put("/ability-editor/buffs/:buffId/duration", (req, res) => {
  try {
    getUserIdFromCookie(req);

    const buffId = parseInt(req.params.buffId, 10);
    if (!Number.isFinite(buffId)) {
      return res.status(400).json({ error: "ERR_INVALID_BUFF_ID" });
    }

    const { durationMs } = req.body ?? {};
    if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 100 || durationMs > 300_000) {
      return res.status(400).json({ error: "ERR_INVALID_DURATION" });
    }

    setBuffDurationMs(buffId, durationMs);

    return res.json(buildBuffEditorSnapshot());
  } catch (error) {
    return handleAbilityEditorError(res, error);
  }
});

export default router;