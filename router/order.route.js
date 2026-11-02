import express from "express";
import {
  createOrder,
  deleteOrder,
  getAllOrderData,
  getOrderDetails,
  getUserOrders,
  sendOrderToCourier,
  trackPublicOrder,
  updateOrder,
} from "../controller/order.controller.js";
import { trackOrder } from "../controller/courier.controller.js";
import { verifyAdmin, verifyToken } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/createOrder", createOrder);
router.get("/getAllOrderData", verifyToken, verifyAdmin, getAllOrderData);
router.get("/getOrderDetails", getOrderDetails);
router.get("/myOrders", verifyToken, getUserOrders);
router.get("/trackPublicOrder", trackPublicOrder);
router.put("/updateOrder", verifyToken, verifyAdmin, updateOrder);
router.post("/sendToCourier", verifyToken, verifyAdmin, sendOrderToCourier);
router.get("/trackOrder", trackOrder);
router.delete("/deleteOrder", verifyToken, verifyAdmin, deleteOrder);

export default router;
