import { ObjectId } from "mongodb";
import dotenv from "dotenv";
import { createSteadfastOrder } from "../services/steadfast.js";
import { sendFacebookCapiEvent } from "../services/facebookCapi.js";
import { emitRealtimeEvent } from "../lib/socket.js";
import { evaluateCoupon } from "./coupon.controller.js";
import {
  couponCollection,
  locationCollection,
  orderCollection,
  productCollection,
  shippingRateCollection,
  shippingSettingsCollection,
  userCollection,
} from "../db/db.collection.js";
dotenv.config();

// Helper to deduct stock
export const deductOrderStock = async (products) => {
  for (const product of products) {
    const productData = await productCollection.findOne({
      _id: new ObjectId(product.productId),
    });
    if (!productData) continue;

    if (
      Array.isArray(productData.variantDetails) &&
      productData.variantDetails.length > 0
    ) {
      let variantMatched = false;
      const variantData = productData.variantDetails.map((variant) => {
        // Case 1: Variant matched by Color
        if (
          product.color &&
          variant.color?.toLowerCase() === product.color?.toLowerCase()
        ) {
          variantMatched = true;
          if (
            product.size &&
            Array.isArray(variant.sizes) &&
            variant.sizes.length > 0
          ) {
            return {
              ...variant,
              sizes: variant.sizes.map((size) =>
                size.size?.toLowerCase() === product.size?.toLowerCase()
                  ? {
                      ...size,
                      stock: Math.max(
                        0,
                        Number(size.stock || 0) - product.quantity,
                      ),
                    }
                  : size,
              ),
            };
          } else {
            // Color-only variant
            return {
              ...variant,
              stock: Math.max(
                0,
                Number(variant.stock || 0) - product.quantity,
              ),
            };
          }
        }

        // Case 2: Variant matched by Size directly (Size-only variant, without color)
        if (
          !product.color &&
          product.size &&
          (variant.size?.toLowerCase() === product.size?.toLowerCase() ||
            variant.name?.toLowerCase() === product.size?.toLowerCase())
        ) {
          variantMatched = true;
          return {
            ...variant,
            stock: Math.max(
              0,
              Number(variant.stock || 0) - product.quantity,
            ),
          };
        }

        // Case 3: Variant matched by Custom Attribute (e.g. Material)
        if (
          product.attributeValue &&
          ((variant.attributeValue && variant.attributeValue?.toLowerCase() === product.attributeValue?.toLowerCase()) ||
            (variant.name && variant.name?.toLowerCase() === product.attributeValue?.toLowerCase()))
        ) {
          variantMatched = true;
          return {
            ...variant,
            stock: Math.max(
              0,
              Number(variant.stock || 0) - product.quantity,
            ),
          };
        }

        return variant;
      });

      const totalVariantStock = variantData.reduce((total, variant) => {
        if (Array.isArray(variant.sizes) && variant.sizes.length > 0) {
          const variantStock = variant.sizes.reduce(
            (sum, s) => sum + Number(s.stock || 0),
            0,
          );
          return total + variantStock;
        }
        return total + Number(variant.stock || 0);
      }, 0);

      await productCollection.updateOne(
        { _id: new ObjectId(product.productId) },
        {
          $set: {
            variantDetails: variantData,
            stock: totalVariantStock,
            updatedAt: new Date(),
          },
        },
      );
    } else {
      // Simple product stock deduction
      const currentStock = Number(productData.stock || 0);
      const newStock = Math.max(0, currentStock - product.quantity);
      await productCollection.updateOne(
        { _id: new ObjectId(product.productId) },
        { $set: { stock: newStock, updatedAt: new Date() } },
      );
    }
  }
  emitRealtimeEvent("product:updated", { action: "stock_deducted" });
};

// Helper to restore stock
export const restoreOrderStock = async (products) => {
  for (const product of products) {
    const productData = await productCollection.findOne({
      _id: new ObjectId(product.productId),
    });
    if (!productData) continue;

    if (
      Array.isArray(productData.variantDetails) &&
      productData.variantDetails.length > 0 &&
      product.color
    ) {
      const variantData = productData.variantDetails.map((variant) => {
        if (variant.color?.toLowerCase() === product.color?.toLowerCase()) {
          if (
            product.size &&
            Array.isArray(variant.sizes) &&
            variant.sizes.length > 0
          ) {
            return {
              ...variant,
              sizes: variant.sizes.map((size) =>
                size.size === product.size
                  ? {
                      ...size,
                      stock: Number(size.stock || 0) + product.quantity,
                    }
                  : size,
              ),
            };
          } else {
            // Color-only variant
            return {
              ...variant,
              stock: Number(variant.stock || 0) + product.quantity,
            };
          }
        }
        return variant;
      });

      const totalVariantStock = variantData.reduce((total, variant) => {
        if (Array.isArray(variant.sizes) && variant.sizes.length > 0) {
          const variantStock = variant.sizes.reduce(
            (sum, s) => sum + Number(s.stock || 0),
            0,
          );
          return total + variantStock;
        }
        return total + Number(variant.stock || 0);
      }, 0);

      await productCollection.updateOne(
        { _id: new ObjectId(product.productId) },
        {
          $set: {
            variantDetails: variantData,
            stock: totalVariantStock,
            updatedAt: new Date(),
          },
        },
      );
    } else {
      // Simple product stock restoration
      const currentStock = Number(productData.stock || 0);
      const newStock = currentStock + product.quantity;
      await productCollection.updateOne(
        { _id: new ObjectId(product.productId) },
        { $set: { stock: newStock, updatedAt: new Date() } },
      );
    }
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
    // 1. Validate stock & prepare order products list
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

      const hasProductVariants = Boolean(
        productData.hasVariants !== false &&
          Array.isArray(productData.variantDetails) &&
          productData.variantDetails.length > 0,
      );

      let matchedVariant = null;
      let matchedSize = null;
      let availableStock = Number(productData.stock || 0);
      let unitPrice =
        Number(productData.discount) > 0
          ? Number(productData.discount)
          : Number(productData.price || 0);

      if (hasProductVariants) {
        matchedVariant = productData.variantDetails?.find(
          (v) => v.color?.toLowerCase() === product.color?.toLowerCase(),
        );

        if (!matchedVariant) {
          return res.status(400).json({
            success: false,
            message: `Color ${product.color} for ${productData.productName} not found`,
          });
        }

        const hasVariantSizes =
          Array.isArray(matchedVariant.sizes) &&
          matchedVariant.sizes.length > 0;

        if (hasVariantSizes) {
          matchedSize = matchedVariant.sizes.find(
            (s) => s.size?.toLowerCase() === product.size?.toLowerCase(),
          );
          if (!matchedSize) {
            return res.status(400).json({
              success: false,
              message: `Size ${product.size} for ${productData.productName} (${product.color}) not found`,
            });
          }
          availableStock = Number(matchedSize.stock || 0);
          unitPrice =
            Number(matchedSize.discount) > 0
              ? Number(matchedSize.discount)
              : Number(matchedSize.price) > 0
                ? Number(matchedSize.price)
                : Number(productData.discount) > 0
                  ? Number(productData.discount)
                  : Number(productData.price);
        } else {
          // Color-only variant
          availableStock = Number(
            matchedVariant.stock ?? productData.stock ?? 0,
          );
          unitPrice =
            Number(matchedVariant.discount) > 0
              ? Number(matchedVariant.discount)
              : Number(matchedVariant.price) > 0
                ? Number(matchedVariant.price)
                : Number(productData.discount) > 0
                  ? Number(productData.discount)
                  : Number(productData.price);
        }
      }

      if (availableStock < product.quantity) {
        return res.status(400).json({
          success: false,
          message: `${productData.productName} ${
            product.color
              ? `(${product.color}${product.size ? ` - ${product.size}` : ""})`
              : ""
          } is out of stock (Available: ${availableStock})`,
        });
      }

      orderProducts.push({
        productId: productData._id,
        productName: productData.productName,
        color: product.color || null,
        size: product.size || null,
        quantity: product.quantity,
        price: unitPrice,
        weight: Number(productData.weight || 0),
        image:
          matchedVariant?.swatchImage ||
          matchedVariant?.imageGallery?.[0] ||
          productData.productImages?.[0] ||
          null,
      });
    }

    // 2. Weight calculation & Active shipping rate lookup
    const totalWeight = orderProducts.reduce(
      (sum, p) => sum + (Number(p.weight || 0) * Number(p.quantity || 1)),
      0,
    );

    const districtQueries = [customer.district];
    if (customer.district && !isNaN(customer.district)) {
      districtQueries.push(Number(customer.district));
    }

    let activeRate = await shippingRateCollection.findOne({
      status: true,
      "location.value": { $in: districtQueries },
    });

    if (!activeRate) {
      activeRate = await shippingRateCollection.findOne({
        status: true,
        "location.value": "all",
      });
    }

    let shippingCharge = 0;
    if (activeRate) {
      const baseCharge = Number(activeRate.baseCharge || 0);
      const weightLimit = Number(activeRate.weightLimit || 0);
      const extraCharge = Number(activeRate.extraCharge || 0);

      if (weightLimit > 0 && totalWeight > weightLimit && extraCharge > 0) {
        const extraWeight = totalWeight - weightLimit;
        const extraUnits = Math.ceil(extraWeight);
        shippingCharge = baseCharge + (extraUnits * extraCharge);
      } else {
        shippingCharge = baseCharge;
      }
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
      totalWeight,
      shippingCharge,
      shippingRateId: activeRate?._id || null,
      courierCompany: activeRate?.companyName || null,
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

    // Asynchronously dispatch Facebook Conversions API (CAPI) Purchase event
    sendFacebookCapiEvent({
      eventName: "Purchase",
      eventId: result.insertedId.toString(),
      eventSourceUrl:
        req.body?.eventSourceUrl ||
        `${process.env.FRONTEND_URL || "https://bivasstyle.com"}/cart/checkout`,
      customer,
      user,
      req,
      fbp: req.body?.fbp,
      fbc: req.body?.fbc,
      customData: {
        currency: "BDT",
        value: Number(totalPrice || 0),
        order_id: result.insertedId.toString(),
        content_type: "product",
        contents: orderProducts.map((p) => ({
          id: p.productId?.toString(),
          quantity: p.quantity,
          item_price: p.price,
        })),
        num_items: orderProducts.reduce((sum, p) => sum + p.quantity, 0),
      },
    }).catch((capiErr) => {
      console.error(
        "[Facebook CAPI] Purchase error on order placement:",
        capiErr,
      );
    });

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
