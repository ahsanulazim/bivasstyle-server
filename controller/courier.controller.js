import {
  checkSteadfastBalance,
  trackSteadfastByCode,
  trackSteadfastByInvoice,
} from "../services/steadfast.js";
import { sendOrderToCourier } from "./order.controller.js";

export const createOrder = sendOrderToCourier;

export const getBalance = async (req, res) => {
  try {
    const data = await checkSteadfastBalance();
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const trackOrder = async (req, res) => {
  const { trackingCode, invoice } = req.query;
  try {
    let data;
    if (trackingCode) {
      data = await trackSteadfastByCode(trackingCode);
    } else if (invoice) {
      data = await trackSteadfastByInvoice(invoice);
    } else {
      return res.status(400).json({
        success: false,
        message: "trackingCode or invoice is required",
      });
    }
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
