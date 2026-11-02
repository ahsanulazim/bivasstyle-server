import express from "express";
import {
  exportAnalyticsReport,
  getAnalyticsSummary,
} from "../controller/analytics.controller.js";
import { verifyAdmin, verifyToken } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/summary", verifyToken, verifyAdmin, getAnalyticsSummary);
router.get("/export", verifyToken, verifyAdmin, exportAnalyticsReport);

export default router;
