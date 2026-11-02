import { ObjectId } from "mongodb";
import {
  couponCollection,
  orderCollection,
  productCollection,
} from "../db/db.collection.js";
import { emitRealtimeEvent } from "../lib/socket.js";

/**
 * Reusable server-side coupon evaluation helper.
 * Used both by the `/coupons/validate` endpoint and `createOrder` in `order.controller.js`.
 */
export const evaluateCoupon = async ({
  code,
  cartItems = [],
  userId = null,
  email = null,
  phone = null,
  shippingCharge = 0,
}) => {
  if (!code || typeof code !== "string") {
    return { valid: false, message: "Coupon code is required" };
  }

  const normalizedCode = code.trim().toUpperCase();
  const coupon = await couponCollection.findOne({ code: normalizedCode });

  if (!coupon) {
    return { valid: false, message: "Invalid coupon code" };
  }

  if (!coupon.isActive) {
    return { valid: false, message: "This coupon is currently inactive" };
  }

  const now = new Date();
  if (coupon.startDate && new Date(coupon.startDate) > now) {
    return {
      valid: false,
      message: `This coupon will be active from ${new Date(coupon.startDate).toLocaleDateString()}`,
    };
  }

  if (coupon.endDate && new Date(coupon.endDate) < now) {
    return { valid: false, message: "This coupon has expired" };
  }

  if (
    Number(coupon.usageLimit) > 0 &&
    Number(coupon.usedCount || 0) >= Number(coupon.usageLimit)
  ) {
    return {
      valid: false,
      message: "This coupon has reached its maximum usage limit",
    };
  }

  // Per-user & First-order-only checks
  const userIdentityFilters = [];
  if (userId && userId !== "guest") {
    userIdentityFilters.push({ user: userId.toString() });
    if (ObjectId.isValid(userId)) {
      userIdentityFilters.push({ user: new ObjectId(userId) });
    }
  }
  if (email && email.trim()) {
    userIdentityFilters.push({ "customer.email": email.trim() });
  }
  if (phone && phone.trim()) {
    userIdentityFilters.push({ "customer.phone": phone.trim() });
  }

  if (coupon.firstOrderOnly && userIdentityFilters.length > 0) {
    const existingOrdersCount = await orderCollection.countDocuments({
      status: { $ne: "cancelled" },
      $or: userIdentityFilters,
    });
    if (existingOrdersCount > 0) {
      return {
        valid: false,
        message: "This coupon is valid for first-time orders only",
      };
    }
  }

  if (Number(coupon.perUserLimit) > 0 && userIdentityFilters.length > 0) {
    const userCouponUsageCount = await orderCollection.countDocuments({
      couponCode: normalizedCode,
      status: { $ne: "cancelled" },
      $or: userIdentityFilters,
    });
    if (userCouponUsageCount >= Number(coupon.perUserLimit)) {
      return {
        valid: false,
        message: `You have already used this coupon the maximum allowed times (${coupon.perUserLimit})`,
      };
    }
  }

  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    return { valid: false, message: "Your cart is empty" };
  }

  // Verify cart items against DB products
  let cartSubtotal = 0;
  let totalQuantity = 0;
  let eligibleSubtotal = 0;
  let eligibleQuantity = 0;

  for (const item of cartItems) {
    const prodId = item.productId || item._id;
    if (!prodId || !ObjectId.isValid(prodId)) continue;

    const dbProduct = await productCollection.findOne({
      _id: new ObjectId(prodId),
    });
    if (!dbProduct) continue;

    const matchedVariant = dbProduct.variantDetails?.find(
      (v) => v.color === item.color,
    );
    const matchedSize = matchedVariant?.sizes?.find(
      (s) => s.size === item.size,
    );

    const regularPrice = Number(
      matchedSize?.price ?? dbProduct.price ?? item.price ?? 0,
    );
    const discountPrice = Number(
      matchedSize?.discount ?? dbProduct.discount ?? 0,
    );
    const isAlreadyDiscounted =
      discountPrice > 0 && discountPrice < regularPrice;
    const effectiveUnitPrice = isAlreadyDiscounted
      ? discountPrice
      : regularPrice;

    const qty = Math.max(Number(item.quantity) || 1, 1);
    const lineTotal = effectiveUnitPrice * qty;

    cartSubtotal += lineTotal;
    totalQuantity += qty;

    // Check if product is eligible for this coupon
    let isTargetMatch = true;
    if (coupon.applicableTo === "categories") {
      const targetCats = Array.isArray(coupon.targetCategories)
        ? coupon.targetCategories
        : [];
      isTargetMatch = targetCats.includes(dbProduct.category);
    } else if (coupon.applicableTo === "products") {
      const targetProds = Array.isArray(coupon.targetProducts)
        ? coupon.targetProducts
        : [];
      isTargetMatch =
        targetProds.includes(dbProduct._id.toString()) ||
        targetProds.includes(dbProduct.slug);
    }

    if (coupon.excludeDiscountedProducts && isAlreadyDiscounted) {
      isTargetMatch = false;
    }

    if (isTargetMatch) {
      eligibleSubtotal += lineTotal;
      eligibleQuantity += qty;
    }
  }

  if (
    Number(coupon.minOrderAmount) > 0 &&
    cartSubtotal < Number(coupon.minOrderAmount)
  ) {
    return {
      valid: false,
      message: `Minimum order subtotal of ৳${coupon.minOrderAmount} is required for this coupon`,
    };
  }

  if (
    Number(coupon.minQuantity) > 0 &&
    totalQuantity < Number(coupon.minQuantity)
  ) {
    return {
      valid: false,
      message: `At least ${coupon.minQuantity} items are required in your cart to use this coupon`,
    };
  }

  if (eligibleSubtotal <= 0 && coupon.discountType !== "free_shipping") {
    if (coupon.excludeDiscountedProducts) {
      return {
        valid: false,
        message:
          "This coupon cannot be applied to items that are already on sale/discount",
      };
    }
    return {
      valid: false,
      message: "No eligible products in your cart match this coupon's criteria",
    };
  }

  let discountAmount = 0;
  let freeShipping = false;

  if (coupon.discountType === "percentage") {
    const pct = Math.min(Math.max(Number(coupon.discountValue) || 0, 0), 100);
    discountAmount = Math.round((eligibleSubtotal * pct) / 100);
    if (
      Number(coupon.maxDiscountAmount) > 0 &&
      discountAmount > Number(coupon.maxDiscountAmount)
    ) {
      discountAmount = Number(coupon.maxDiscountAmount);
    }
  } else if (coupon.discountType === "fixed") {
    discountAmount = Math.min(
      Number(coupon.discountValue) || 0,
      eligibleSubtotal,
    );
  } else if (coupon.discountType === "free_shipping") {
    freeShipping = true;
    discountAmount = Number(shippingCharge) || 0;
  }

  discountAmount = Math.max(Math.round(discountAmount), 0);

  return {
    valid: true,
    coupon: {
      _id: coupon._id,
      code: coupon.code,
      title: coupon.title,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      maxDiscountAmount: coupon.maxDiscountAmount,
    },
    discountAmount,
    freeShipping,
    cartSubtotal,
    eligibleSubtotal,
    message:
      coupon.discountType === "free_shipping"
        ? `Free shipping coupon (${coupon.code}) applied!`
        : `Coupon ${coupon.code} applied! You saved ৳${discountAmount}`,
  };
};

// 1. Create Coupon (Admin)
export const createCoupon = async (req, res) => {
  try {
    const {
      code,
      title,
      description,
      discountType = "percentage", // "percentage" | "fixed" | "free_shipping"
      discountValue = 0,
      maxDiscountAmount = 0,
      minOrderAmount = 0,
      minQuantity = 0,
      applicableTo = "all", // "all" | "categories" | "products"
      targetCategories = [],
      targetProducts = [],
      excludeDiscountedProducts = false,
      firstOrderOnly = false,
      usageLimit = 0, // 0 = unlimited
      perUserLimit = 0, // 0 = unlimited
      startDate = null,
      endDate = null,
      isActive = true,
      isPublic = true,
      showBanner = false,
    } = req.body;

    if (!code || !code.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Coupon code is required" });
    }

    const normalizedCode = code.trim().toUpperCase();

    if (
      discountType !== "free_shipping" &&
      (Number(discountValue) <= 0 || isNaN(Number(discountValue)))
    ) {
      return res.status(400).json({
        success: false,
        message: "Discount value must be greater than 0",
      });
    }

    if (discountType === "percentage" && Number(discountValue) > 100) {
      return res.status(400).json({
        success: false,
        message: "Percentage discount cannot exceed 100%",
      });
    }

    const existing = await couponCollection.findOne({ code: normalizedCode });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Coupon code "${normalizedCode}" already exists`,
      });
    }

    // If showBanner is true, optionally unset showBanner on other coupons if desired, or allow multiple
    const newCoupon = {
      code: normalizedCode,
      title: title?.trim() || normalizedCode,
      description: description?.trim() || "",
      discountType,
      discountValue:
        discountType === "free_shipping" ? 0 : Number(discountValue),
      maxDiscountAmount: Number(maxDiscountAmount) || 0,
      minOrderAmount: Number(minOrderAmount) || 0,
      minQuantity: Number(minQuantity) || 0,
      applicableTo,
      targetCategories: Array.isArray(targetCategories) ? targetCategories : [],
      targetProducts: Array.isArray(targetProducts) ? targetProducts : [],
      excludeDiscountedProducts: Boolean(excludeDiscountedProducts),
      firstOrderOnly: Boolean(firstOrderOnly),
      usageLimit: Number(usageLimit) || 0,
      perUserLimit: Number(perUserLimit) || 0,
      usedCount: 0,
      totalDiscountGiven: 0,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      isActive: Boolean(isActive),
      isPublic: Boolean(isPublic),
      showBanner: Boolean(showBanner),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await couponCollection.insertOne(newCoupon);
    emitRealtimeEvent("coupon:updated", {
      action: "created",
      code: normalizedCode,
    });
    emitRealtimeEvent("dashboard:update", {
      type: "coupon",
      action: "created",
    });

    return res.status(201).json({
      success: true,
      message: "Coupon created successfully",
      coupon: { ...newCoupon, _id: result.insertedId },
    });
  } catch (error) {
    console.error("Error creating coupon:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to create coupon" });
  }
};

// 2. Update Coupon (Admin)
export const updateCoupon = async (req, res) => {
  try {
    const id = req.query.id || req.body.id || req.body._id;
    if (!id || !ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Valid coupon ID is required" });
    }

    const existing = await couponCollection.findOne({ _id: new ObjectId(id) });
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Coupon not found" });
    }

    const {
      code,
      title,
      description,
      discountType,
      discountValue,
      maxDiscountAmount,
      minOrderAmount,
      minQuantity,
      applicableTo,
      targetCategories,
      targetProducts,
      excludeDiscountedProducts,
      firstOrderOnly,
      usageLimit,
      perUserLimit,
      startDate,
      endDate,
      isActive,
      isPublic,
      showBanner,
    } = req.body;

    const normalizedCode = code ? code.trim().toUpperCase() : existing.code;

    if (normalizedCode !== existing.code) {
      const duplicate = await couponCollection.findOne({
        code: normalizedCode,
        _id: { $ne: new ObjectId(id) },
      });
      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: `Coupon code "${normalizedCode}" is already in use`,
        });
      }
    }

    const finalType = discountType ?? existing.discountType;
    const updatedFields = {
      code: normalizedCode,
      title: title !== undefined ? title.trim() : existing.title,
      description:
        description !== undefined ? description.trim() : existing.description,
      discountType: finalType,
      discountValue:
        finalType === "free_shipping"
          ? 0
          : discountValue !== undefined
            ? Number(discountValue)
            : existing.discountValue,
      maxDiscountAmount:
        maxDiscountAmount !== undefined
          ? Number(maxDiscountAmount) || 0
          : existing.maxDiscountAmount,
      minOrderAmount:
        minOrderAmount !== undefined
          ? Number(minOrderAmount) || 0
          : existing.minOrderAmount,
      minQuantity:
        minQuantity !== undefined
          ? Number(minQuantity) || 0
          : existing.minQuantity,
      applicableTo: applicableTo ?? existing.applicableTo,
      targetCategories: Array.isArray(targetCategories)
        ? targetCategories
        : existing.targetCategories,
      targetProducts: Array.isArray(targetProducts)
        ? targetProducts
        : existing.targetProducts,
      excludeDiscountedProducts:
        excludeDiscountedProducts !== undefined
          ? Boolean(excludeDiscountedProducts)
          : existing.excludeDiscountedProducts,
      firstOrderOnly:
        firstOrderOnly !== undefined
          ? Boolean(firstOrderOnly)
          : existing.firstOrderOnly,
      usageLimit:
        usageLimit !== undefined
          ? Number(usageLimit) || 0
          : existing.usageLimit,
      perUserLimit:
        perUserLimit !== undefined
          ? Number(perUserLimit) || 0
          : existing.perUserLimit,
      startDate:
        startDate !== undefined
          ? startDate
            ? new Date(startDate)
            : null
          : existing.startDate,
      endDate:
        endDate !== undefined
          ? endDate
            ? new Date(endDate)
            : null
          : existing.endDate,
      isActive:
        isActive !== undefined ? Boolean(isActive) : existing.isActive,
      isPublic:
        isPublic !== undefined ? Boolean(isPublic) : existing.isPublic,
      showBanner:
        showBanner !== undefined ? Boolean(showBanner) : existing.showBanner,
      updatedAt: new Date(),
    };

    await couponCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedFields },
    );

    emitRealtimeEvent("coupon:updated", {
      action: "updated",
      couponId: id,
      code: normalizedCode,
    });
    emitRealtimeEvent("dashboard:update", {
      type: "coupon",
      action: "updated",
    });

    return res.status(200).json({
      success: true,
      message: "Coupon updated successfully",
      coupon: { ...existing, ...updatedFields },
    });
  } catch (error) {
    console.error("Error updating coupon:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to update coupon" });
  }
};

// 3. Toggle Coupon Active / Banner Status (Admin)
export const toggleCouponStatus = async (req, res) => {
  try {
    const { id, field = "isActive", value } = req.body;
    if (!id || !ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Valid coupon ID is required" });
    }

    const allowedFields = ["isActive", "isPublic", "showBanner"];
    if (!allowedFields.includes(field)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid toggle field" });
    }

    await couponCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { [field]: Boolean(value), updatedAt: new Date() } },
    );

    emitRealtimeEvent("coupon:updated", {
      action: "toggled",
      couponId: id,
      field,
      value: Boolean(value),
    });
    emitRealtimeEvent("dashboard:update", {
      type: "coupon",
      action: "toggled",
    });

    return res.status(200).json({
      success: true,
      message: "Coupon status updated",
    });
  } catch (error) {
    console.error("Error toggling coupon:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to update status" });
  }
};

// 4. Delete Coupon (Admin)
export const deleteCoupon = async (req, res) => {
  try {
    const { id } = req.query;
    if (!id || !ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Valid coupon ID is required" });
    }

    const result = await couponCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Coupon not found" });
    }

    emitRealtimeEvent("coupon:updated", { action: "deleted", couponId: id });
    emitRealtimeEvent("dashboard:update", {
      type: "coupon",
      action: "deleted",
    });

    return res
      .status(200)
      .json({ success: true, message: "Coupon deleted successfully" });
  } catch (error) {
    console.error("Error deleting coupon:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to delete coupon" });
  }
};

// 5. Get All Coupons (Admin)
export const getAllCoupons = async (req, res) => {
  try {
    const coupons = await couponCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      coupons,
    });
  } catch (error) {
    console.error("Error fetching coupons:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch coupons" });
  }
};

// 6. Get Public / Storefront Active Coupons
export const getPublicCoupons = async (req, res) => {
  try {
    const now = new Date();
    const coupons = await couponCollection
      .find({
        isActive: true,
        $or: [{ isPublic: true }, { showBanner: true }],
      })
      .sort({ createdAt: -1 })
      .toArray();

    const validCoupons = coupons.filter((c) => {
      if (c.startDate && new Date(c.startDate) > now) return false;
      if (c.endDate && new Date(c.endDate) < now) return false;
      if (Number(c.usageLimit) > 0 && Number(c.usedCount || 0) >= Number(c.usageLimit)) {
        return false;
      }
      return true;
    });

    return res.status(200).json({
      success: true,
      coupons: validCoupons.map((c) => ({
        _id: c._id,
        code: c.code,
        title: c.title,
        description: c.description,
        discountType: c.discountType,
        discountValue: c.discountValue,
        maxDiscountAmount: c.maxDiscountAmount,
        minOrderAmount: c.minOrderAmount,
        minQuantity: c.minQuantity,
        applicableTo: c.applicableTo,
        targetCategories: c.targetCategories,
        firstOrderOnly: c.firstOrderOnly,
        endDate: c.endDate,
        isPublic: c.isPublic,
        showBanner: c.showBanner,
      })),
    });
  } catch (error) {
    console.error("Error fetching public coupons:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch active promotions" });
  }
};

// 7. Validate Coupon Code at Cart / Checkout
export const validateCouponCode = async (req, res) => {
  try {
    const { code, cartItems, userId, email, phone, shippingCharge } = req.body;
    const result = await evaluateCoupon({
      code,
      cartItems,
      userId,
      email,
      phone,
      shippingCharge,
    });

    if (!result.valid) {
      return res.status(400).json({
        success: false,
        message: result.message,
      });
    }

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Error validating coupon:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to validate coupon" });
  }
};

// 8. Advanced Bulk Product & Category Discount Manager (Admin)
export const applyBulkProductDiscount = async (req, res) => {
  try {
    const {
      scope = "all", // "all" | "category" | "products"
      category = "",
      productIds = [],
      action = "percentage", // "percentage" | "fixed" | "clear"
      discountValue = 0,
    } = req.body;

    const filter = {};
    if (scope === "category") {
      if (!category) {
        return res
          .status(400)
          .json({ success: false, message: "Please select a category" });
      }
      filter.category = category;
    } else if (scope === "products") {
      if (!Array.isArray(productIds) || productIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Please select at least one product",
        });
      }
      filter._id = {
        $in: productIds
          .filter((id) => ObjectId.isValid(id))
          .map((id) => new ObjectId(id)),
      };
    }

    if (
      action !== "clear" &&
      (Number(discountValue) <= 0 || isNaN(Number(discountValue)))
    ) {
      return res.status(400).json({
        success: false,
        message: "Discount value must be greater than 0",
      });
    }

    if (action === "percentage" && Number(discountValue) >= 100) {
      return res.status(400).json({
        success: false,
        message: "Percentage discount must be less than 100%",
      });
    }

    const products = await productCollection.find(filter).toArray();
    if (products.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No matching products found for this scope",
      });
    }

    const computeDiscountedPrice = (basePrice) => {
      const reg = Number(basePrice) || 0;
      if (reg <= 0 || action === "clear") return "";
      if (action === "percentage") {
        const discounted = Math.round(reg - (reg * Number(discountValue)) / 100);
        return Math.max(discounted, 1);
      }
      if (action === "fixed") {
        const discounted = Math.round(reg - Number(discountValue));
        return discounted > 0 && discounted < reg ? discounted : "";
      }
      return "";
    };

    let updatedCount = 0;
    for (const product of products) {
      const newProductDiscount = computeDiscountedPrice(product.price);
      const updatedVariants = Array.isArray(product.variantDetails)
        ? product.variantDetails.map((variant) => ({
            ...variant,
            sizes: Array.isArray(variant.sizes)
              ? variant.sizes.map((s) => ({
                  ...s,
                  discount: computeDiscountedPrice(s.price || product.price),
                }))
              : [],
          }))
        : [];

      await productCollection.updateOne(
        { _id: product._id },
        {
          $set: {
            discount: newProductDiscount,
            variantDetails: updatedVariants,
            updatedAt: new Date(),
          },
        },
      );
      updatedCount++;
    }

    emitRealtimeEvent("product:updated", {
      action: "bulk_discount",
      scope,
      discountAction: action,
      updatedCount,
    });
    emitRealtimeEvent("dashboard:update", {
      type: "product",
      action: "bulk_discount",
    });

    return res.status(200).json({
      success: true,
      updatedCount,
      message:
        action === "clear"
          ? `Cleared discounts on ${updatedCount} product(s)`
          : `Applied ${
              action === "percentage" ? `${discountValue}%` : `৳${discountValue}`
            } discount to ${updatedCount} product(s)`,
    });
  } catch (error) {
    console.error("Error applying bulk discount:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to apply bulk discount" });
  }
};

