import { ObjectId } from "mongodb";
import dotenv from "dotenv";
import { deductOrderStock } from "./order.controller.js";
import { emitRealtimeEvent } from "../lib/socket.js";
import { orderCollection } from "../db/db.collection.js";
dotenv.config();

export const paymentVerify = async (req, res) => {
  const { invoice_id, metadata } = req.body;

  try {
    const verifyData = await ziniPayVerifyPayment(
      invoice_id,
      process.env.ZINIPAY_API_KEY,
    );

    if (verifyData.status === "COMPLETED") {
      const orderId = metadata?.order_id;
      let order = null;

      if (orderId) {
        order = await orderCollection.findOne({ _id: new ObjectId(orderId) });
      }

      if (order) {
        // If stock was not deducted yet, deduct it now upon verified payment
        if (!order.stockDeducted && Array.isArray(order.products)) {
          await deductOrderStock(order.products);
        }

        await orderCollection.updateOne(
          { _id: order._id },
          {
            $set: {
              status: "pending", // Ready for fulfillment
              paymentStatus: "paid",
              transactionId: verifyData.transaction_id,
              invoiceId: verifyData.invoice_id,
              stockDeducted: true,
              updatedAt: new Date(),
            },
          },
        );

        emitRealtimeEvent("order:updated", { orderId: order._id.toString(), status: "pending", paymentStatus: "paid" });
        emitRealtimeEvent("dashboard:update", { type: "order", action: "payment_verified", orderId: order._id.toString() });

        return res.json({
          success: true,
          message: "Order payment verified and updated successfully",
        });
      } else {
        // Fallback: If order wasn't found, insert new
        const fallbackOrder = {
          _id: orderId ? new ObjectId(orderId) : new ObjectId(),
          user: metadata?.user_id || "guest",
          customer: {
            name: verifyData.cus_name,
            email: verifyData.cus_email,
          },
          subtotal: verifyData.amount,
          totalPrice: verifyData.amount,
          paymentMethod: verifyData.payment_method || "online",
          transactionId: verifyData.transaction_id,
          invoiceId: verifyData.invoice_id,
          status: "pending",
          paymentStatus: "paid",
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await orderCollection.insertOne(fallbackOrder);
        emitRealtimeEvent("order:created", { orderId: fallbackOrder._id.toString(), order: fallbackOrder });
        emitRealtimeEvent("dashboard:update", { type: "order", action: "created", orderId: fallbackOrder._id.toString() });
        return res.json({
          success: true,
          message: "Order created and payment verified successfully",
        });
      }
    }

    return res
      .status(400)
      .json({ success: false, message: "Payment not completed", verifyData });
  } catch (err) {
    console.error("Verify error:", err.message);
    return res
      .status(500)
      .json({ success: false, message: "Verification failed" });
  }
};

export const checkPaymentStatus = async (req, res) => {
  const { orderId } = req.query;
  if (!orderId) {
    return res.status(400).json({ success: false, message: "Order ID is required" });
  }

  try {
    const order = await orderCollection.findOne({ _id: new ObjectId(orderId) });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    return res.json({
      success: true,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
    });
  } catch (error) {
    console.error("Error checking payment status:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export async function ziniPayCreatePayment(payload, apiKey) {
  try {
    const response = await fetch("https://api.zinipay.com/v1/payment/create", {
      method: "POST",
      headers: {
        "zini-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(err || "Payment create failed");
    }

    return await response.json();
  } catch (e) {
    console.error("Create Payment Error:", e.message);
    throw e;
  }
}

export async function ziniPayVerifyPayment(invoiceId, apiKey) {
  try {
    const response = await fetch("https://api.zinipay.com/v1/payment/verify", {
      method: "POST",
      headers: {
        "zini-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ invoiceId }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(err || "Payment verify failed");
    }

    return await response.json();
  } catch (e) {
    console.error("Verify Payment Error:", e.message);
    throw e;
  }
}
