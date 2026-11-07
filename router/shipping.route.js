import express from "express";
import {
  createShippingRate,
  deleteShippingRate,
  getAllShippingRates,
  getShippingRateByDistrict,
  getShippingSettings,
  updateShippingRate,
  updateShippingSettings,
} from "../controller/shipping.controller.js";
import { verifyAdmin, verifyToken } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/getShippingSettings", getShippingSettings);
router.put("/updateShippingSettings", verifyToken, verifyAdmin, updateShippingSettings);
router.post("/createShippingRate", verifyToken, verifyAdmin, createShippingRate);
router.put("/updateShippingRate", verifyToken, verifyAdmin, updateShippingRate);
router.get("/getAllShippingRates", getAllShippingRates);
router.get("/getShippingRateByDistrict", getShippingRateByDistrict);
router.delete("/deleteShippingRate", verifyToken, verifyAdmin, deleteShippingRate);

export default router;
