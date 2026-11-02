import express from "express";
import {
  createShippingRate,
  deleteShippingRate,
  getAllShippingRates,
  getShippingRateByDistrict,
} from "../controller/shipping.controller.js";

const router = express.Router();

router.post("/createShippingRate", createShippingRate);
router.get("/getAllShippingRates", getAllShippingRates);
router.get("/getShippingRateByDistrict", getShippingRateByDistrict);
router.delete("/deleteShippingRate", deleteShippingRate);

export default router;
