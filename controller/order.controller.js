import { ObjectId } from "mongodb";
import dotenv from "dotenv";
import { createSteadfastOrder } from "../services/steadfast.js";
import { emitRealtimeEvent } from "../lib/socket.js";
import { evaluateCoupon } from "./coupon.controller.js";
import {
  couponCollection,
  locationCollection,
  orderCollection,
  productCollection,
  shippingRateCollection,
  userCollection,
} from "../db/db.collection.js";
dotenv.config();

// Helper to deduct stock
export const deductOrderStock = async (products) => {
  for (const product of products) {
    const productData = await productCollection.findOne({
      _id: new ObjectId(product.productId),
    });
    if (!productData || !productData.variantDetails) continue;

    const variantData = productData.variantDetails.map((variant) => {
      if (variant.color === product.color) {
        return {
          ...variant,
          sizes: variant.sizes.map((size) =>
            size.size === product.size
              ? { ...size, stock: Math.max(0, size.stock - product.quantity) }
              : size,
          ),
        };
      }
      return variant;
    });

    await productCollection.updateOne(
      { _id: new ObjectId(product.productId) },
      { $set: { variantDetails: variantData } },
    );
  }
  emitRealtimeEvent("product:updated", { action: "stock_deducted" });
};

// Helper to restore stock
export const restoreOrderStock = async (products) => {
  for (const product of products) {
    const productData = await productCollection.findOne({
      _id: new ObjectId(product.productId),
    });
    if (!productData || !productData.variantDetails) continue;

    const variantData = productData.variantDetails.map((variant) => {
      if (variant.color === product.color) {
        return {
          ...variant,
          sizes: variant.sizes.map((size) =>
            size.size === product.size
              ? { ...size, stock: size.stock + product.quantity }
              : size,
          ),
        };
      }
      return variant;
    });

    await productCollection.updateOne(
      { _id: new ObjectId(product.productId) },
      { $set: { variantDetails: variantData } },
    );
  }
  emitRealtimeEvent("product:updated", { action: "stock_restored" });
};

export const createOrder = async (req, res) => {
  const { customer, products, user, paymentMethod, couponCode } = req.body;

  if (!customer || !products || !Array.isArray(products) || products.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "Customer and products are required" });
  }

  if (!user) {
    return res
      .status(400)
      .json({ success: false, message: "User is required" });
  }

  try {
    // 1. Calculate shipping charge
    const insideDhaka = await shippingRateCollection.findOne({
      "location.value": customer.district,
    });
    const outsideDhaka = await shippingRateCollection.findOne({
      "location.value": "all",
    });

    let shippingCharge = 0;
    if (insideDhaka) {
      shippingCharge = insideDhaka.baseCharge + (insideDhaka.extraCharge ?? 0);
    } else if (outsideDhaka) {
      shippingCharge =
        outsideDhaka.baseCharge + (outsideDhaka.extraCharge ?? 0);
    }

    // 2. Validate stock & prepare order products list
    const orderProducts = [];
    for (const product of products) {
      const productData = await productCollection.findOne({
        _id: new ObjectId(product.productId),
      });

      if (!productData) {
        return res
          .status(400)
          .json({ success: false, message: `Product not found: ${product.productName || product.productId}` });
      }

      const matchedVariant = productData.variantDetails?.find(
        (v) => v.color === product.color,
      );
      const matchedSize = matchedVariant?.sizes?.find(
        (s) => s.size === product.size,
      );

      if (!matchedSize) {
        return res.status(400).json({
          success: false,
          message: `Size ${product.size} for ${productData.productName} (${product.color}) not found`,
        });
      }

      if (matchedSize.stock < product.quantity) {
        return res.status(400).json({
          success: false,
          message: `${productData.productName} (${product.color} - ${product.size}) is out of stock (Available: ${matchedSize.stock})`,
        });
      }

      const unitPrice =
        Number(matchedSize?.discount) > 0
          ? Number(matchedSize.discount)
          : Number(matchedSize?.price) > 0
            ? Number(matchedSize.price)
            : Number(productData.discount) > 0
              ? Number(productData.discount)
              : Number(productData.price);

      orderProducts.push({
        productId: productData._id,
        productName: productData.productName,
        color: product.color,
        size: product.size,
        quantity: product.quantity,
        price: unitPrice,
        image: matchedVariant?.swatchImage || matchedVariant?.imageGallery?.[0] || productData.productImages?.[0] || null,
      });
    }

    // 3. Total calculation & Coupon validation
    const subtotal = orderProducts.reduce(
      (sum, p) => sum + p.price * p.quantity,
      0,
    );

    let appliedCouponCode = null;
    let discountAmount = 0;

    if (couponCode && typeof couponCode === "string" && couponCode.trim()) {
      const couponEval = await evaluateCoupon({
        code: couponCode,
        cartItems: products,
        userId: user?._id ? user._id : user,
        email: customer?.email,
        phone: customer?.phone,
        shippingCharge,
      });

      if (!couponEval.valid) {
        return res.status(400).json({
          success: false,
          message: couponEval.message || "Invalid coupon code",
        });
      }

      appliedCouponCode = couponEval.coupon.code;
      discountAmount = Number(couponEval.discountAmount) || 0;
    }

    const totalPrice = Math.max(subtotal + shippingCharge - discountAmount, 0);

    const recordCouponUsage = async () => {
      if (appliedCouponCode) {
        await couponCollection.updateOne(
          { code: appliedCouponCode },
          {
            $inc: {
              usedCount: 1,
              totalDiscountGiven: discountAmount,
            },
            $set: { updatedAt: new Date() },
          },
        );
        emitRealtimeEvent("coupon:updated", {
          action: "redeemed",
          code: appliedCouponCode,
        });
      }
    };

    // 4. Order creation for COD (Cash on Delivery)
    await deductOrderStock(orderProducts);
    await recordCouponUsage();

    const order = {
      user: user._id ? user._id : user,
      customer,
      products: orderProducts,
      shippingCharge,
      subtotal,
      couponCode: appliedCouponCode,
      discountAmount,
      totalPrice,
      status: "pending",
      paymentStatus: "unpaid",
      paymentMethod: "cod",
      stockDeducted: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = await orderCollection.insertOne(order);
    const createdOrder = { ...order, _id: result.insertedId };

    emitRealtimeEvent("order:created", { orderId: result.insertedId });
    emitRealtimeEvent("dashboard:update", { type: "order", action: "created" });

    return res.status(201).json({
      success: true,
      message: "Order created successfully",
      order: createdOrder,
    });
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const getAllOrderData = async (req, res) => {
  try {
    const orderData = await orderCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    const userData = await userCollection.find({}).toArray();

    const orders = orderData.map((order) => {
      const user = userData.find(
        (u) => u._id.toString() === order.user?.toString(),
      );
      if (user) {
        return { user, ...order };
      }
      return { ...order };
    });

    res
      .status(200)
      .json({ success: true, message: "Orders fetched successfully", orders });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const deleteOrder = async (req, res) => {
  try {
    const { id } = req.query;

    const order = await orderCollection.findOne({ _id: new ObjectId(id) });
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    // Restore stock if it was deducted
    if (order.stockDeducted && Array.isArray(order.products)) {
      await restoreOrderStock(order.products);
    }

    await orderCollection.deleteOne({ _id: new ObjectId(id) });
    emitRealtimeEvent("order:deleted", { orderId: id });
    emitRealtimeEvent("dashboard:update", { type: "order", action: "deleted" });
    res
      .status(200)
      .json({ success: true, message: "Order deleted successfully" });
  } catch (error) {
    console.error("Error deleting order:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const getOrderDetails = async (req, res) => {
  const { orderId } = req.query;

  try {
    const order = await orderCollection.findOne({ _id: new ObjectId(orderId) });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order Not Found" });
    }

    const customer = order.customer || {};
    const customerDistrict = customer.district;

    let districtName = customerDistrict || "";
    if (customerDistrict) {
      const district = await locationCollection.findOne({ id: customerDistrict });
      if (district?.name?.en) {
        districtName = district.name.en;
      }
    }

    const customerData = {
      name: (customer.firstName ? `${customer.firstName} ${customer.lastName || ""}` : customer.name) || "Guest",
      firstName: customer.firstName || customer.name || "",
      lastName: customer.lastName || "",
      address: [customer.address, customer.thana, districtName].filter(Boolean).join(", "),
      rawAddress: customer.address || "",
      thana: customer.thana || "",
      district: customer.district || "",
      districtName,
      email: customer.email || "",
      phone: customer.phone || "",
      comment: customer.comment || "",
    };

    const enrichedProducts = await Promise.all(
      (order.products || []).map(async (p) => {
        try {
          const product = await productCollection.findOne({
            _id: new ObjectId(p.productId),
          });
          const variant = product?.variantDetails?.find(
            (v) => v.color?.toLowerCase() === p.color?.toLowerCase(),
          );
          const imageLink = variant?.swatchImage || variant?.imageGallery?.[0] || product?.productImages?.[0] || p.image;
          return {
            ...p,
            category: product?.category || "Apparel",
            image: imageLink || null,
          };
        } catch {
          return p;
        }
      }),
    );

    const enrichedOrder = {
      ...order,
      products: enrichedProducts,
    };

    if (order.user === "guest" || !order.user) {
      return res.status(200).json({
        success: true,
        order: { ...enrichedOrder, customer: customerData },
      });
    }

    try {
      const userID = order.user;
      const user = await userCollection.findOne({ _id: new ObjectId(userID) });

      const userData = user
        ? { name: user.name, email: user.email, phone: user.phone }
        : null;

      return res.status(200).json({
        success: true,
        order: {
          ...enrichedOrder,
          user: userData,
          customer: customerData,
        },
      });
    } catch {
      return res.status(200).json({
        success: true,
        order: { ...enrichedOrder, customer: customerData },
      });
    }
  } catch (error) {
    console.error("Error fetching order details:", error);
    res
      .status(500)
      .json({ success: false, message: "Unable to fetch order data" });
  }
};

export const updateOrder = async (req, res) => {
  const { orderId, status, paymentStatus, customer } = req.body;

  if (!orderId) {
    return res
      .status(400)
      .json({ success: false, message: "Order ID is required" });
  }

  try {
    const order = await orderCollection.findOne({ _id: new ObjectId(orderId) });
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    const updateFields = { updatedAt: new Date() };

    if (status) {
      updateFields.status = status;

      // If cancelling an order where stock was deducted, restore stock
      if (
        status === "cancelled" &&
        order.stockDeducted &&
        Array.isArray(order.products)
      ) {
        await restoreOrderStock(order.products);
        updateFields.stockDeducted = false;
      }

      // If restoring from cancelled back to active and stock wasn't deducted, deduct it
      if (
        status !== "cancelled" &&
        !order.stockDeducted &&
        Array.isArray(order.products)
      ) {
        await deductOrderStock(order.products);
        updateFields.stockDeducted = true;
      }
    }

    if (paymentStatus) {
      updateFields.paymentStatus = paymentStatus;
    }

    if (customer && typeof customer === "object") {
      updateFields.customer = {
        ...(order.customer || {}),
        ...customer,
      };
    }

    await orderCollection.updateOne(
      { _id: new ObjectId(orderId) },
      { $set: updateFields },
    );

    const updatedOrder = await orderCollection.findOne({
      _id: new ObjectId(orderId),
    });

    emitRealtimeEvent("order:updated", { orderId, status: updatedOrder?.status, paymentStatus: updatedOrder?.paymentStatus });
    emitRealtimeEvent("dashboard:update", { type: "order", action: "updated", orderId });

    return res.status(200).json({
      success: true,
      message: "Order updated successfully",
      order: updatedOrder,
    });
  } catch (error) {
    console.error("Error updating order:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to update order" });
  }
};

export const sendOrderToCourier = async (req, res) => {
  const { orderId } = req.body;

  if (!orderId) {
    return res
      .status(400)
      .json({ success: false, message: "Order ID is required" });
  }

  try {
    const order = await orderCollection.findOne({ _id: new ObjectId(orderId) });
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    if (order.courier?.consignmentId) {
      return res.status(400).json({
        success: false,
        message: `Order already sent to Steadfast (Tracking: ${order.courier.trackingCode})`,
      });
    }

    const customer = order.customer || {};
    let districtName = customer.district || "";
    if (customer.district) {
      const district = await locationCollection.findOne({
        id: customer.district,
      });
      if (district?.name?.en) {
        districtName = district.name.en;
      }
    }

    const recipientName =
      (customer.firstName
        ? `${customer.firstName} ${customer.lastName || ""}`.trim()
        : customer.name) || "Customer";
    const recipientPhone = (customer.phone || "").replace(/[^0-9]/g, "");
    const recipientAddress = [customer.address, customer.thana, districtName]
      .filter(Boolean)
      .join(", ");

    const codAmount =
      order.paymentStatus === "paid" ? 0 : Number(order.totalPrice || 0);

    const steadfastPayload = {
      invoice: order._id.toString(),
      recipient_name: recipientName,
      recipient_phone: recipientPhone,
      recipient_address: recipientAddress,
      cod_amount: codAmount,
      note: customer.comment || "",
    };

    const courierRes = await createSteadfastOrder(steadfastPayload);

    if (courierRes?.status === 200 && courierRes?.consignment) {
      const consignment = courierRes.consignment;
      const courierData = {
        provider: "Steadfast",
        consignmentId: consignment.consignment_id,
        trackingCode: consignment.tracking_code,
        status: consignment.status || "in_review",
        sentAt: new Date(),
      };

      await orderCollection.updateOne(
        { _id: order._id },
        {
          $set: {
            courier: courierData,
            status: "processing",
            updatedAt: new Date(),
          },
        },
      );

      emitRealtimeEvent("order:updated", { orderId: order._id.toString(), status: "processing", courier: courierData });
      emitRealtimeEvent("dashboard:update", { type: "order", action: "courier_dispatched", orderId: order._id.toString() });

      return res.status(200).json({
        success: true,
        message: "Order sent to Steadfast Courier successfully!",
        courier: courierData,
      });
    } else {
      return res.status(400).json({
        success: false,
        message:
          courierRes?.message ||
          (courierRes?.errors
            ? Object.values(courierRes.errors).flat().join(", ")
            : "Steadfast rejected the parcel"),
        details: courierRes,
      });
    }
  } catch (error) {
    console.error("Error sending order to courier:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to send order to Steadfast Courier",
    });
  }
};

export const getUserOrders = async (req, res) => {
  const { userId, email } = req.query;

  if (!userId && !email) {
    return res.status(400).json({
      success: false,
      message: "userId or email is required",
    });
  }

  try {
    const orConditions = [];
    if (userId) {
      orConditions.push({ user: userId });
      if (ObjectId.isValid(userId)) {
        orConditions.push({ user: new ObjectId(userId) });
      }
    }
    if (email) {
      orConditions.push({ "customer.email": email });
    }

    const orders = await orderCollection
      .find({ $or: orConditions })
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      orders,
    });
  } catch (error) {
    console.error("Error fetching user orders:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user orders",
    });
  }
};

export const trackPublicOrder = async (req, res) => {
  const { query } = req.query;

  if (!query || !query.trim()) {
    return res.status(400).json({
      success: false,
      message: "Please enter an Order ID, Phone Number, or Tracking Code",
    });
  }

  const cleaned = query.trim().replace(/^#/, "");

  try {
    let orders = [];

    // 1. If valid 24-char ObjectId
    if (ObjectId.isValid(cleaned) && cleaned.length === 24) {
      const exact = await orderCollection.findOne({
        _id: new ObjectId(cleaned),
      });
      if (exact) orders = [exact];
    }

    // 2. Otherwise search by phone, courier trackingCode, or partial order ID suffix
    if (orders.length === 0) {
      const allOrders = await orderCollection
        .find({})
        .sort({ createdAt: -1 })
        .limit(200)
        .toArray();

      const qLower = cleaned.toLowerCase();
      orders = allOrders.filter((o) => {
        const idStr = o._id.toString().toLowerCase();
        const phoneStr = (o.customer?.phone || "").toLowerCase();
        const trackingStr = (o.courier?.trackingCode || "").toLowerCase();
        return (
          idStr.endsWith(qLower) ||
          phoneStr.includes(qLower) ||
          (trackingStr && trackingStr === qLower)
        );
      });
    }

    if (orders.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No matching order found. Please check your Order ID or Phone Number.",
      });
    }

    return res.status(200).json({
      success: true,
      orders: orders.slice(0, 5),
    });
  } catch (error) {
    console.error("Error tracking public order:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to track order",
    });
  }
};
