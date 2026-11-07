import { ObjectId } from "mongodb";
import cloudinary from "../lib/cloudinary.js";
import { productCollection } from "../db/db.collection.js";
import { emitRealtimeEvent } from "../lib/socket.js";

export const uploadProductImages = async (req, res) => {
  try {
    const files = req.files || (req.file ? [req.file] : []);
    if (!files || files.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No image file provided" });
    }

    const uploadPromises = files.map(
      (file) =>
        new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            { folder: "products" },
            (error, result) => {
              if (error) reject(error);
              else resolve(result.secure_url);
            },
          );
          uploadStream.end(file.buffer);
        }),
    );

    const urls = await Promise.all(uploadPromises);
    return res.status(200).json({
      success: true,
      urls,
      url: urls[0],
    });
  } catch (error) {
    console.error("Cloudinary upload error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to upload image(s)" });
  }
};

export const createProduct = async (req, res) => {
  const {
    productName,
    slug,
    stock,
    productDescription,
    price,
    costPrice,
    discount,
    category,
    productImages,
    sku,
    barcode,
    status = "published",
    weight = 0,
    lowStockThreshold = 5,
    featured = false,
    hasVariants,
    variantDetails,
  } = req.body;

  if (!productName || !slug || !productDescription || !price) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  const cleanSlug = slug.trim().toLowerCase();
  const existingProductWithSlug = await productCollection.findOne({ slug: cleanSlug });
  if (existingProductWithSlug) {
    return res.status(409).json({
      success: false,
      message: `A product with the slug "${cleanSlug}" already exists. Please choose a different slug.`,
    });
  }

  let uploadedImageUrls = [];

  if (productImages && Array.isArray(productImages)) {
    uploadedImageUrls = await Promise.all(
      productImages.map(async (image) => {
        if (typeof image === "string" && image.startsWith("http")) {
          return image;
        }
        const uploadRes = await cloudinary.uploader.upload(image, {
          folder: "products",
        });
        return uploadRes?.secure_url || "";
      }),
    );
  }

  const hasVariantsBool =
    hasVariants !== undefined
      ? Boolean(hasVariants)
      : Boolean(variantDetails && variantDetails.length > 0);

  let processedVariants = hasVariantsBool ? variantDetails || [] : [];

  if (processedVariants && Array.isArray(processedVariants)) {
    await Promise.all(
      processedVariants.map(async (variant) => {
        if (variant.imageGallery && Array.isArray(variant.imageGallery)) {
          const uploadedGallery = await Promise.all(
            variant.imageGallery.map(async (img) => {
              if (typeof img === "string" && img.startsWith("http")) {
                return img;
              }
              const uploadRes = await cloudinary.uploader.upload(img, {
                folder: "products",
              });
              return uploadRes?.secure_url || "";
            }),
          );
          variant.imageGallery = uploadedGallery;
        }
        if (
          variant.swatchImage &&
          typeof variant.swatchImage === "string" &&
          !variant.swatchImage.startsWith("http")
        ) {
          const uploadRes = await cloudinary.uploader.upload(
            variant.swatchImage,
            {
              folder: "products",
            },
          );
          variant.swatchImage = uploadRes?.secure_url || "";
        }
      }),
    );
  }

  // Calculate stock: if has variants, sum sizes stock or variant stock; otherwise use root stock
  let computedStock = Number(stock || 0);
  if (hasVariantsBool && processedVariants.length > 0) {
    computedStock = processedVariants.reduce((sum, v) => {
      if (Array.isArray(v.sizes) && v.sizes.length > 0) {
        const vStock = v.sizes.reduce(
          (sSum, s) => sSum + Number(s.stock || 0),
          0,
        );
        return sum + vStock;
      }
      return sum + Number(v.stock || 0);
    }, 0);
  }

  const createdAt = new Date();
  const updatedAt = new Date();

  const product = {
    productName,
    slug: cleanSlug,
    stock: computedStock,
    category,
    productDescription,
    price: Number(price || 0),
    costPrice:
      costPrice !== undefined && costPrice !== "" ? Number(costPrice) : 0,
    discount: discount !== undefined && discount !== "" ? Number(discount) : 0,
    productImages: uploadedImageUrls,
    sku: sku || "",
    barcode: barcode || "",
    status: status || "published",
    weight: Number(weight || 0),
    lowStockThreshold: Number(lowStockThreshold || 5),
    featured: Boolean(featured),
    hasVariants: hasVariantsBool,
    variantDetails: processedVariants,
    createdAt,
    updatedAt,
  };

  try {
    await productCollection.insertOne(product);
    emitRealtimeEvent("product:updated", { action: "created", slug: product.slug });
    emitRealtimeEvent("dashboard:update", { type: "product", action: "created" });
    res.status(201).json({ success: true, message: "Product created successfully", product });
  } catch (error) {
    console.error("Error creating product:", error);
    res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

export const updateProduct = async (req, res) => {
  const { id } = req.query;
  const {
    productName,
    slug,
    stock,
    productDescription,
    price,
    costPrice,
    discount,
    category,
    productImages,
    sku,
    barcode,
    status,
    weight,
    lowStockThreshold,
    featured,
    hasVariants,
    variantDetails,
  } = req.body;

  if (!id) {
    return res.status(400).json({ success: false, message: "Product ID is required" });
  }

  try {
    const existingProduct = await productCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!existingProduct) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    let cleanSlug = existingProduct.slug;
    if (slug) {
      cleanSlug = slug.trim().toLowerCase();
      if (cleanSlug !== existingProduct.slug) {
        const existingBySlug = await productCollection.findOne({
          slug: cleanSlug,
          _id: { $ne: new ObjectId(id) },
        });
        if (existingBySlug) {
          return res.status(409).json({
            success: false,
            message: `A product with slug "${cleanSlug}" already exists. Please choose a different slug.`,
          });
        }
      }
    }

    let uploadedImageUrls = existingProduct.productImages || [];
    if (productImages && Array.isArray(productImages)) {
      uploadedImageUrls = await Promise.all(
        productImages.map(async (image) => {
          if (typeof image === "string" && image.startsWith("http")) {
            return image;
          }
          const uploadRes = await cloudinary.uploader.upload(image, {
            folder: "products",
          });
          return uploadRes?.secure_url || "";
        }),
      );
    }

    const hasVariantsBool =
      hasVariants !== undefined
        ? Boolean(hasVariants)
        : variantDetails !== undefined
          ? Boolean(variantDetails && variantDetails.length > 0)
          : existingProduct.hasVariants ?? (existingProduct.variantDetails?.length > 0);

    let processedVariants = hasVariantsBool
      ? variantDetails !== undefined
        ? variantDetails
        : existingProduct.variantDetails || []
      : [];

    if (Array.isArray(processedVariants)) {
      await Promise.all(
        processedVariants.map(async (variant) => {
          if (variant.imageGallery && Array.isArray(variant.imageGallery)) {
            variant.imageGallery = await Promise.all(
              variant.imageGallery.map(async (img) => {
                if (typeof img === "string" && img.startsWith("http")) {
                  return img;
                }
                const uploadRes = await cloudinary.uploader.upload(img, {
                  folder: "products",
                });
                return uploadRes?.secure_url || "";
              }),
            );
          }
          if (
            variant.swatchImage &&
            typeof variant.swatchImage === "string" &&
            !variant.swatchImage.startsWith("http")
          ) {
            const uploadRes = await cloudinary.uploader.upload(
              variant.swatchImage,
              {
                folder: "products",
              },
            );
            variant.swatchImage = uploadRes?.secure_url || "";
          }
        }),
      );
    }

    let computedStock =
      stock !== undefined ? Number(stock) : existingProduct.stock || 0;
    if (hasVariantsBool && processedVariants.length > 0) {
      computedStock = processedVariants.reduce((sum, v) => {
        if (Array.isArray(v.sizes) && v.sizes.length > 0) {
          const vStock = v.sizes.reduce(
            (sSum, s) => sSum + Number(s.stock || 0),
            0,
          );
          return sum + vStock;
        }
        return sum + Number(v.stock || 0);
      }, 0);
    }

    const updatedDoc = {
      productName: productName ?? existingProduct.productName,
      slug: cleanSlug,
      stock: computedStock,
      category: category ?? existingProduct.category,
      productDescription:
        productDescription ?? existingProduct.productDescription,
      price: price !== undefined ? Number(price) : existingProduct.price,
      costPrice:
        costPrice !== undefined
          ? Number(costPrice)
          : existingProduct.costPrice || 0,
      discount:
        discount !== undefined
          ? Number(discount)
          : existingProduct.discount || 0,
      productImages: uploadedImageUrls,
      sku: sku ?? existingProduct.sku,
      barcode: barcode ?? existingProduct.barcode ?? "",
      status: status ?? existingProduct.status ?? "published",
      weight:
        weight !== undefined ? Number(weight) : existingProduct.weight || 0,
      lowStockThreshold:
        lowStockThreshold !== undefined
          ? Number(lowStockThreshold)
          : existingProduct.lowStockThreshold || 5,
      featured:
        featured !== undefined
          ? Boolean(featured)
          : existingProduct.featured || false,
      hasVariants: hasVariantsBool,
      variantDetails: processedVariants,
      updatedAt: new Date(),
    };

    await productCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedDoc },
    );

    emitRealtimeEvent("product:updated", { action: "updated", productId: id, slug: updatedDoc.slug });
    emitRealtimeEvent("dashboard:update", { type: "product", action: "updated", productId: id });

    res.status(200).json({
      success: true,
      message: "Product updated successfully",
      product: { _id: id, ...updatedDoc },
    });
  } catch (error) {
    console.error("Error updating product:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to update product" });
  }
};

export const getAllProducts = async (req, res) => {
  try {
    const products = await productCollection.find().toArray();
    res.status(200).json(products);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getProductBySlug = async (req, res) => {
  const { slug } = req.query;

  try {
    const product = await productCollection.findOne({ slug });
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.status(200).json(product);
  } catch (error) {
    console.error("Error fetching product:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getProductsByFilters = async (req, res) => {
  const { category, minPrice, maxPrice, sizes, colors, stock, sort, search } =
    req.query;

  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 12, 50);
  const skip = (page - 1) * limit;

  try {
    const andConditions = [];

    // Only filter by category if category is provided and not "all"
    if (category && category !== "all" && category !== "undefined") {
      andConditions.push({
        $or: [
          { category: category },
          { category: category.replace(/-/g, " ") },
          { category: { $regex: new RegExp(`^${category.replace(/-/g, "[ -]?")}$`, "i") } },
        ],
      });
    }

    // Search query support
    if (search && search.trim()) {
      const searchRegex = { $regex: search.trim(), $options: "i" };
      andConditions.push({
        $or: [
          { productName: searchRegex },
          { category: searchRegex },
          { sku: searchRegex },
        ],
      });
    }

    if (minPrice || maxPrice) {
      const priceCond = {};
      if (minPrice) priceCond.$gte = Number(minPrice);
      if (maxPrice) priceCond.$lte = Number(maxPrice);

      andConditions.push({
        $or: [
          { "variantDetails.sizes.price": priceCond },
          { price: priceCond },
        ],
      });
    }

    if (sizes) {
      andConditions.push({
        $or: [
          { "variantDetails.sizes.size": { $in: sizes.split(",") } },
          { "variantDetails.size": { $in: sizes.split(",") } },
        ],
      });
    }

    if (colors) {
      andConditions.push({
        "variantDetails.color": { $in: colors.split(",") },
      });
    }

    if (stock === "in") {
      andConditions.push({
        $or: [
          { "variantDetails.sizes.stock": { $gt: 0 } },
          { stock: { $gt: 0 } },
        ],
      });
    } else if (stock === "out") {
      andConditions.push({
        $or: [
          { "variantDetails.sizes.stock": { $eq: 0 } },
          { stock: { $lte: 0 } },
        ],
      });
    }

    const filter = andConditions.length > 0 ? { $and: andConditions } : {};

    // Sorting
    let sortOption = { createdAt: -1 };
    if (sort === "newest") {
      sortOption = { createdAt: -1 };
    } else if (sort === "price-asc") {
      sortOption = { price: 1 };
    } else if (sort === "price-desc") {
      sortOption = { price: -1 };
    } else if (sort === "oldest") {
      sortOption = { createdAt: 1 };
    }

    const totalProducts = await productCollection.countDocuments(filter);

    const products = await productCollection
      .find(filter)
      .sort(sortOption)
      .skip(skip)
      .limit(limit)
      .toArray();

    res.status(200).json({
      products: products || [],
      totalPages: Math.ceil(totalProducts / limit) || 0,
      totalProducts,
      currentPage: page,
      hasNext: page * limit < totalProducts,
      hasPrev: page > 1,
      start: totalProducts > 0 ? skip + 1 : 0,
      end: Math.min(skip + limit, totalProducts),
    });
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const searchProducts = async (req, res) => {
  const { q } = req.query;
  if (!q || !q.trim()) {
    return res.status(200).json([]);
  }

  try {
    const regex = { $regex: q.trim(), $options: "i" };
    const results = await productCollection
      .find({
        $or: [
          { productName: regex },
          { category: regex },
          { sku: regex },
        ],
      })
      .project({
        productName: 1,
        slug: 1,
        category: 1,
        price: 1,
        discount: 1,
        productImages: 1,
        variantDetails: 1,
      })
      .limit(6)
      .toArray();

    res.status(200).json(results);
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({ message: "Search failed" });
  }
};

export const getNewArriavals = async (req, res) => {
  try {
    const newArriavals = await productCollection
      .find()
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray();
    res.status(200).json(newArriavals);
  } catch (error) {
    console.error("Error fetching new arrivals:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteProduct = async (req, res) => {
  const { id } = req.query;
  try {
    const product = await productCollection.findOne({ _id: new ObjectId(id) });

    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not Found!" });
    }

    if (product.productImages && Array.isArray(product.productImages)) {
      await Promise.all(
        product.productImages.map(async (image) => {
          const deleteImage = image.split("/").pop().split(".");
          try {
            await cloudinary.uploader.destroy(`/products/${deleteImage}`);
            console.log("Deleted Image from Cloudinary");
          } catch (error) {
            console.error("Error Deleting Image", error);
          }
        }),
      );
    }

    await productCollection.deleteOne({ _id: new ObjectId(id) });
    emitRealtimeEvent("product:updated", { action: "deleted", productId: id });
    emitRealtimeEvent("dashboard:update", { type: "product", action: "deleted", productId: id });
    res.status(200).json({ success: true, message: "Product Deleted" });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Failed to delete Product" });
  }
};

export const toggleProductFeatured = async (req, res) => {
  const { id } = req.query;
  if (!id || !ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: "Valid product ID is required" });
  }

  try {
    const product = await productCollection.findOne({ _id: new ObjectId(id) });
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const newFeatured = !product.featured;
    await productCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { featured: newFeatured, updatedAt: new Date() } },
    );

    emitRealtimeEvent("product:updated", {
      action: "featured_toggled",
      productId: id,
      featured: newFeatured,
    });

    return res.status(200).json({
      success: true,
      message: newFeatured ? "Product featured" : "Product unfeatured",
      featured: newFeatured,
    });
  } catch (error) {
    console.error("Error toggling featured:", error);
    return res.status(500).json({ success: false, message: "Failed to toggle featured status" });
  }
};

export const quickUpdateProductStock = async (req, res) => {
  const { id } = req.query;
  const { stock, color, size, attributeValue } = req.body;

  if (!id || !ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: "Valid product ID is required" });
  }

  if (stock === undefined || isNaN(stock)) {
    return res.status(400).json({ success: false, message: "Stock number is required" });
  }

  try {
    const product = await productCollection.findOne({ _id: new ObjectId(id) });
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    // If specific variant & size is specified
    if (color && size && Array.isArray(product.variantDetails)) {
      const updatedVariants = product.variantDetails.map((v) => {
        if (v.color === color) {
          return {
            ...v,
            sizes: (v.sizes || []).map((s) =>
              s.size === size ? { ...s, stock: Number(stock) } : s,
            ),
          };
        }
        return v;
      });

      const totalStock = updatedVariants.reduce((sum, v) => {
        if (Array.isArray(v.sizes) && v.sizes.length > 0) {
          return (
            sum +
            v.sizes.reduce((sSum, s) => sSum + Number(s.stock || 0), 0)
          );
        }
        return sum + Number(v.stock || 0);
      }, 0);

      await productCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            variantDetails: updatedVariants,
            stock: totalStock,
            updatedAt: new Date(),
          },
        },
      );
    } else if (color && Array.isArray(product.variantDetails)) {
      // Specific color (without size / color-only variant)
      const updatedVariants = product.variantDetails.map((v) => {
        if (v.color === color) {
          return {
            ...v,
            stock: Number(stock),
          };
        }
        return v;
      });

      const totalStock = updatedVariants.reduce((sum, v) => {
        if (Array.isArray(v.sizes) && v.sizes.length > 0) {
          return (
            sum +
            v.sizes.reduce((sSum, s) => sSum + Number(s.stock || 0), 0)
          );
        }
        return sum + Number(v.stock || 0);
      }, 0);

      await productCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            variantDetails: updatedVariants,
            stock: totalStock,
            updatedAt: new Date(),
          },
        },
      );
    } else if (size && Array.isArray(product.variantDetails)) {
      // Size without color (Size-only variant)
      const updatedVariants = product.variantDetails.map((v) => {
        if (v.size === size || v.name === size) {
          return {
            ...v,
            stock: Number(stock),
          };
        }
        return v;
      });

      const totalStock = updatedVariants.reduce((sum, v) => {
        if (Array.isArray(v.sizes) && v.sizes.length > 0) {
          return (
            sum +
            v.sizes.reduce((sSum, s) => sSum + Number(s.stock || 0), 0)
          );
        }
        return sum + Number(v.stock || 0);
      }, 0);

      await productCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            variantDetails: updatedVariants,
            stock: totalStock,
            updatedAt: new Date(),
          },
        },
      );
    } else if (attributeValue && Array.isArray(product.variantDetails)) {
      // Custom attribute variant (e.g. Material)
      const updatedVariants = product.variantDetails.map((v) => {
        if (v.attributeValue === attributeValue || v.name === attributeValue) {
          return {
            ...v,
            stock: Number(stock),
          };
        }
        return v;
      });

      const totalStock = updatedVariants.reduce((sum, v) => {
        if (Array.isArray(v.sizes) && v.sizes.length > 0) {
          return (
            sum +
            v.sizes.reduce((sSum, s) => sSum + Number(s.stock || 0), 0)
          );
        }
        return sum + Number(v.stock || 0);
      }, 0);

      await productCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            variantDetails: updatedVariants,
            stock: totalStock,
            updatedAt: new Date(),
          },
        },
      );
    } else {
      // General product stock update
      await productCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { stock: Number(stock), updatedAt: new Date() } },
      );
    }

    emitRealtimeEvent("product:updated", { action: "stock_updated", productId: id, stock });
    return res.status(200).json({ success: true, message: "Stock updated successfully" });
  } catch (error) {
    console.error("Error updating stock:", error);
    return res.status(500).json({ success: false, message: "Failed to update stock" });
  }
};

export const bulkUpdateProducts = async (req, res) => {
  const { action, ids, payload = {} } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: "Product IDs array required" });
  }

  try {
    const validIds = ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));

    if (action === "status") {
      const { status } = payload;
      if (!["published", "draft", "archived"].includes(status)) {
        return res.status(400).json({ success: false, message: "Valid status (published, draft, archived) required" });
      }
      await productCollection.updateMany(
        { _id: { $in: validIds } },
        { $set: { status, updatedAt: new Date() } },
      );
      emitRealtimeEvent("product:updated", { action: "bulk_status", count: validIds.length, status });
      return res.status(200).json({ success: true, message: `Updated status for ${validIds.length} products to ${status}` });
    }

    if (action === "delete") {
      await productCollection.deleteMany({ _id: { $in: validIds } });
      emitRealtimeEvent("product:updated", { action: "bulk_delete", count: validIds.length });
      return res.status(200).json({ success: true, message: `Deleted ${validIds.length} products successfully` });
    }

    if (action === "category") {
      const { category } = payload;
      if (!category) {
        return res.status(400).json({ success: false, message: "Category is required" });
      }
      await productCollection.updateMany(
        { _id: { $in: validIds } },
        { $set: { category, updatedAt: new Date() } },
      );
      emitRealtimeEvent("product:updated", { action: "bulk_category", count: validIds.length, category });
      return res.status(200).json({ success: true, message: `Assigned ${validIds.length} products to category ${category}` });
    }

    return res.status(400).json({ success: false, message: "Invalid bulk action" });
  } catch (error) {
    console.error("Bulk update products error:", error);
    return res.status(500).json({ success: false, message: "Failed to perform bulk action" });
  }
};

export const getCategoryFilters = async (req, res) => {
  const { category } = req.query;
  try {
    const match = {};
    if (category && category !== "all" && category !== "undefined") {
      match.$or = [
        { category: category },
        { category: category.replace(/-/g, " ") },
        { category: { $regex: new RegExp(`^${category.replace(/-/g, "[ -]?")}$`, "i") } },
      ];
    }

    const products = await productCollection
      .find(match)
      .project({
        price: 1,
        variantDetails: 1,
      })
      .toArray();

    let maxPrice = 0;
    const colorsMap = new Map();
    const sizesSet = new Set();
    const stockStatus = [];

    for (const prod of products) {
      if (prod.price !== undefined && prod.price !== null && !isNaN(Number(prod.price))) {
        maxPrice = Math.max(maxPrice, Number(prod.price));
      }

      if (Array.isArray(prod.variantDetails)) {
        for (const variant of prod.variantDetails) {
          if (variant.price !== undefined && variant.price !== null && !isNaN(Number(variant.price))) {
            maxPrice = Math.max(maxPrice, Number(variant.price));
          }
          if (variant.color) {
            colorsMap.set(variant.color, {
              color: variant.color,
              hex: variant.hex,
              swatchImage: variant.swatchImage,
            });
          }
          if (variant.size) {
            sizesSet.add(variant.size);
            if (variant.stock !== undefined) {
              stockStatus.push({
                size: variant.size,
                stock: variant.stock,
              });
            }
          }
          if (Array.isArray(variant.sizes)) {
            for (const sizeObj of variant.sizes) {
              if (sizeObj.price !== undefined && sizeObj.price !== null && !isNaN(Number(sizeObj.price))) {
                maxPrice = Math.max(maxPrice, Number(sizeObj.price));
              }
              if (sizeObj.size) {
                sizesSet.add(sizeObj.size);
              }
              if (sizeObj.size && sizeObj.stock !== undefined) {
                stockStatus.push({
                  size: sizeObj.size,
                  stock: sizeObj.stock,
                });
              }
            }
          }
        }
      }
    }

    res.json({
      minPrice: 0,
      maxPrice: maxPrice > 0 ? Math.ceil(maxPrice) : 10000,
      colors: Array.from(colorsMap.values()),
      sizes: Array.from(sizesSet),
      stockStatus,
    });
  } catch (error) {
    console.error("Filters error:", error);
    res.status(500).json({ message: "Filters error" });
  }
};
