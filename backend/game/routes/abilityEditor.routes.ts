import express from "express";

import {
  buildAbilityEditorSnapshot,
  setAbilityEditorDamageValue,
  setAbilityEditorNumericValue,
  setAbilityEditorProperty,
  setAbilityIsProjectile,
  setAbilityTag,
} from "../abilities/abilities";
import { AbilityPropertyId, TAG_GROUP_DEFINITIONS, TagGroupId } from "../abilities/abilityPropertySystem";
import {
  BUFF_ATTRIBUTES,
  BuffAttribute,
  BuffProperty,
  BUFF_PROPERTY_TYPES,
  buildBuffEditorSnapshot,
  setBuffAttribute,
  setBuffDescription,
  setBuffHidden,
  setBuffName,
  setBuffProperties,
  setBuffDurationMs,
} from "../abilities/buffTagSystem";
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
    const { isProjectile } = req.body ?? {};
    if (typeof isProjectile !== "boolean") {
      return res.status(400).json({ error: "ERR_INVALID_PAYLOAD" });
    }
    setAbilityIsProjectile(req.params.abilityId, isProjectile);
    return res.json(buildAbilityEditorSnapshot());
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