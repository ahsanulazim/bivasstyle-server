import { ObjectId } from "mongodb";
import { categoryCollection } from "../db/db.collection.js";
import cloudinary from "../lib/cloudinary.js";
import { emitRealtimeEvent } from "../lib/socket.js";

export const createCategory = async (req, res) => {
  const { name, slug, thumbnail, isFeatured } = req.body;
  const createdAt = new Date();
  const updatedAt = new Date();

  let coverThumbnail = "";

  if (thumbnail && typeof thumbnail === "string" && thumbnail.startsWith("data:image")) {
    try {
      const uploadThumbnail = await cloudinary.uploader.upload(thumbnail, {
        folder: "category",
      });
      coverThumbnail = uploadThumbnail?.secure_url || "";
    } catch (uploadError) {
      console.error("Cloudinary upload error:", uploadError);
    }
  } else if (thumbnail && typeof thumbnail === "string") {
    coverThumbnail = thumbnail;
  }

  const category = {
    name,
    slug,
    coverThumbnail,
    isFeatured: Boolean(isFeatured),
    createdAt,
    updatedAt,
  };

  try {
    await categoryCollection.insertOne(category);
    emitRealtimeEvent("category:updated", { action: "created", slug, isFeatured: category.isFeatured });
    emitRealtimeEvent("dashboard:update", { type: "category", action: "created" });
    res.status(201).json({ success: true, message: "Category is created" });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Category creation Failed" });
  }
};

export const updateCategory = async (req, res) => {
  const { id } = req.query;
  const { name, slug, thumbnail, isFeatured } = req.body;

  if (!id || !ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: "Valid category ID is required" });
  }

  try {
    const category = await categoryCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    const updateDoc = {
      name: name !== undefined ? name : category.name,
      slug: slug !== undefined ? slug : category.slug,
      updatedAt: new Date(),
    };

    if (isFeatured !== undefined) {
      updateDoc.isFeatured = Boolean(isFeatured);
    }

    if (thumbnail && thumbnail !== category.coverThumbnail) {
      if (typeof thumbnail === "string" && thumbnail.startsWith("data:image")) {
        try {
          const uploadThumbnail = await cloudinary.uploader.upload(thumbnail, {
            folder: "category",
          });
          updateDoc.coverThumbnail = uploadThumbnail?.secure_url || "";
        } catch (uploadErr) {
          console.error("Cloudinary upload error:", uploadErr);
        }
      } else {
        updateDoc.coverThumbnail = thumbnail;
      }
    } else if (thumbnail === null || thumbnail === "") {
      updateDoc.coverThumbnail = "";
    }

    await categoryCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateDoc }
    );

    emitRealtimeEvent("category:updated", {
      action: "updated",
      slug: updateDoc.slug,
      categoryId: id,
      isFeatured: updateDoc.isFeatured !== undefined ? updateDoc.isFeatured : category.isFeatured,
    });
    emitRealtimeEvent("dashboard:update", { type: "category", action: "updated" });

    res.status(200).json({ success: true, message: "Category updated successfully" });
  } catch (error) {
    console.error("Error updating category:", error);
    res.status(500).json({ success: false, message: "Failed to update category" });
  }
};

export const toggleCategoryFeatured = async (req, res) => {
  const id = req.query.id || req.body.id;
  const { isFeatured } = req.body;

  if (!id || !ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: "Valid category ID is required" });
  }

  try {
    const category = await categoryCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    const nextFeatured = isFeatured !== undefined ? Boolean(isFeatured) : !category.isFeatured;

    await categoryCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          isFeatured: nextFeatured,
          updatedAt: new Date(),
        },
      }
    );

    emitRealtimeEvent("category:updated", {
      action: "featured_toggled",
      categoryId: id,
      isFeatured: nextFeatured,
    });
    emitRealtimeEvent("dashboard:update", {
      type: "category",
      action: "featured_toggled",
    });

    res.status(200).json({
      success: true,
      message: `Category ${nextFeatured ? "marked as featured" : "unmarked as featured"}`,
      isFeatured: nextFeatured,
    });
  } catch (error) {
    console.error("Error toggling category featured status:", error);
    res.status(500).json({ success: false, message: "Failed to toggle featured status" });
  }
};

export const getAllCategories = async (req, res) => {
  try {
    const categories = await categoryCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json(categories);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ success: false, message: "Cannot get Categories" });
  }
};

export const deleteCategory = async (req, res) => {
  const { id } = req.query;
  try {
    const category = await categoryCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!category) {
      return res.status(404).json({ success: false, message: "Cannot Find Category" });
    }

    if (category.coverThumbnail) {
      const deleteImage = category.coverThumbnail.split("/").pop().split(".");
      try {
        await cloudinary.uploader.destroy(`category/${deleteImage}`);
      } catch (error) {
        console.error("Cloudinary Error", error);
      }
    }

    await categoryCollection.deleteOne({ _id: new ObjectId(id) });
    emitRealtimeEvent("category:updated", { action: "deleted", categoryId: id });
    emitRealtimeEvent("dashboard:update", { type: "category", action: "deleted" });
    res.status(200).json({ success: true, message: "Category Deleted" });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Failed to delete category" });
  }
};
