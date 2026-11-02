import express from "express";
import {
  createVariation,
  deleteVariation,
  getAllVariation,
  getAllVariationAsType,
} from "../controller/variation.controller.js";

const router = express.Router();

router.post("/createVariation", createVariation);
router.get("/getAllVariationsAsType/:type", getAllVariationAsType);
router.get("/getAllVariations", getAllVariation);
router.delete("/deleteVariation", deleteVariation);

export default router;
