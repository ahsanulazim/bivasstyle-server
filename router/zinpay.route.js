import express from "express";
import {
  checkPaymentStatus,
  paymentVerify,
  ziniPayCreatePayment,
  ziniPayVerifyPayment,
} from "../controller/zinpay.controller.js";

const router = express.Router();

router.post("/ziniPayCreatePayment", ziniPayCreatePayment);
router.post("/ziniPayVerifyPayment", ziniPayVerifyPayment);
router.post("/payment-webhook", paymentVerify);
router.get("/checkStatus", checkPaymentStatus);

export default router;
