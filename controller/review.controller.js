import { ObjectId } from "mongodb";
import cloudinary from "../lib/cloudinary.js";
import { orderCollection, reviewCollection } from "../db/db.collection.js";
import { emitRealtimeEvent } from "../lib/socket.js";

export const createReview = async (req, res) => {
  try {
    const {
      productId,
      productSlug,
      userName,
      userEmail,
      rating,
      comment,
      images = [],
    } = req.body;

    if (!productSlug && !productId) {
      return res
        .status(400)
        .json({ success: false, message: "Product reference is required" });
    }

    if (!rating || Number(rating) < 1 || Number(rating) > 5) {
      return res.status(400).json({
        success: false,
        message: "Please provide a rating between 1 and 5 stars",
      });
    }

    if (!comment || !comment.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Review comment is required" });
    }

    let uploadedPhotos = [];
    if (Array.isArray(images) && images.length > 0) {
      uploadedPhotos = await Promise.all(
        images.slice(0, 4).map(async (img) => {
          if (typeof img === "string" && img.startsWith("http")) return img;
          const uploadRes = await cloudinary.uploader.upload(img, {
            folder: "reviews",
          });
          return uploadRes?.secure_url || "";
        }),
      );
      uploadedPhotos = uploadedPhotos.filter(Boolean);
    }

    // Check if verified buyer
    let verifiedPurchase = false;
    if (userEmail) {
      const matchingOrder = await orderCollection.findOne({
        "customer.email": userEmail,
        status: { $ne: "cancelled" },
      });
      if (matchingOrder) verifiedPurchase = true;
    }

    const reviewDoc = {
      productId: productId || null,
      productSlug: productSlug || null,
      userName: userName?.trim() || "Customer",
      userEmail: userEmail?.trim() || "",
      rating: Number(rating),
      comment: comment.trim(),
      images: uploadedPhotos,
      verifiedPurchase,
      createdAt: new Date(),
    };

    const result = await reviewCollection.insertOne(reviewDoc);
    emitRealtimeEvent("review:updated", {
      action: "created",
      productSlug,
      productId,
    });

    return res.status(201).json({
      success: true,
      message: "Thank you! Your review has been submitted.",
      review: { ...reviewDoc, _id: result.insertedId },
    });
  } catch (error) {
    console.error("Error creating review:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to submit review" });
  }
};

export const getProductReviews = async (req, res) => {
  try {
    const { slug, productId } = req.query;
    const filter = {};
    if (slug && productId) {
      filter.$or = [{ productSlug: slug }, { productId }];
    } else if (slug) {
      filter.productSlug = slug;
    } else if (productId) {
      filter.productId = productId;
    } else {
      return res.status(200).json({ success: true, reviews: [] });
    }

    const reviews = await reviewCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      reviews,
    });
  } catch (error) {
    console.error("Error fetching reviews:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch reviews" });
  }
};

export const deleteReview = async (req, res) => {
  try {
    const { id } = req.query;
    if (!id || !ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Valid review ID is required" });
    }

    await reviewCollection.deleteOne({ _id: new ObjectId(id) });
    emitRealtimeEvent("review:updated", { action: "deleted", reviewId: id });

    return res
      .status(200)
      .json({ success: true, message: "Review deleted successfully" });
  } catch (error) {
    console.error("Error deleting review:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to delete review" });
  }
};

