import express from "express";
import {
  applyBulkProductDiscount,
  createCoupon,
  deleteCoupon,
  getAllCoupons,
  getPublicCoupons,
  toggleCouponStatus,
  updateCoupon,
  validateCouponCode,
} from "../controller/coupon.controller.js";
import { verifyAdmin, verifyToken } from "../middleware/auth.middleware.js";

const router = express.Router();

// Public & Customer Checkout Routes
router.get("/public", getPublicCoupons);
router.post("/validate", validateCouponCode);

// Admin Protected Routes
router.get("/all", verifyToken, verifyAdmin, getAllCoupons);
router.post("/create", verifyToken, verifyAdmin, createCoupon);
router.put("/update", verifyToken, verifyAdmin, updateCoupon);
router.patch("/toggle", verifyToken, verifyAdmin, toggleCouponStatus);
router.delete("/delete", verifyToken, verifyAdmin, deleteCoupon);
router.post("/bulk-discount", verifyToken, verifyAdmin, applyBulkProductDiscount);

export default router;

