import express from "express";
import {
  createReview,
  deleteReview,
  getProductReviews,
} from "../controller/review.controller.js";
import { verifyAdmin, verifyToken } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/product", getProductReviews);
router.post("/create", createReview);
router.delete("/delete", verifyToken, verifyAdmin, deleteReview);

export default router;

