import express from "express";

import {
  buildAbilityEditorSnapshot,
  setAbilityEditorDamageValue,
  setAbilityEditorNumericValue,
  setAbilityEditorProperty,
} from "../abilities/abilities";
import { AbilityPropertyId } from "../abilities/abilityPropertySystem";
import {
  BUFF_ATTRIBUTES,
  BuffAttribute,
  buildBuffEditorSnapshot,
  setBuffAttribute,
  setBuffDescription,
  setBuffHidden,
  setBuffName,
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
    message === "ERR_INVALID_BUFF_NAME"
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

export default router;