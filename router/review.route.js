import express from "express";
import {
  createReview,
  deleteReview,
  getAllReviewsAdmin,
  getProductReviews,
  toggleReviewApproval,
} from "../controller/review.controller.js";
import { verifyAdmin, verifyToken } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/product", getProductReviews);
router.post("/create", createReview);
router.get("/all", verifyToken, verifyAdmin, getAllReviewsAdmin);
router.patch("/toggleStatus", verifyToken, verifyAdmin, toggleReviewApproval);
router.delete("/delete", verifyToken, verifyAdmin, deleteReview);

export default router;
