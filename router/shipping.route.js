import express from "express";
import {
  createShippingRate,
  deleteShippingRate,
  getAllShippingRates,
  getShippingRateByDistrict,
  updateShippingRate,
} from "../controller/shipping.controller.js";
import { verifyAdmin, verifyToken } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/createShippingRate", verifyToken, verifyAdmin, createShippingRate);
router.put("/updateShippingRate", verifyToken, verifyAdmin, updateShippingRate);
router.get("/getAllShippingRates", getAllShippingRates);
router.get("/getShippingRateByDistrict", getShippingRateByDistrict);
router.delete("/deleteShippingRate", verifyToken, verifyAdmin, deleteShippingRate);

export default router;
