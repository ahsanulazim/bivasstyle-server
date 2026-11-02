import { ObjectId } from "mongodb";
import cloudinary from "../lib/cloudinary.js";
import { productCollection } from "../db/db.collection.js";
import { emitRealtimeEvent } from "../lib/socket.js";

export const createProduct = async (req, res) => {
  const {
    productName,
    slug,
    stock,
    productDescription,
    price,
    discount,
    category,
    productImages,
    sku,
    variantDetails,
  } = req.body;

  if (!productName || !slug || !productDescription || !price) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  let uploadedImageUrls = [];

  if (productImages && Array.isArray(productImages)) {
    uploadedImageUrls = await Promise.all(
      productImages.map(async (image) => {
        const uploadRes = await cloudinary.uploader.upload(image, {
          folder: "products",
        });
        return uploadRes?.secure_url || "";
      }),
    );
  }

  if (variantDetails && Array.isArray(variantDetails)) {
    await Promise.all(
      variantDetails.map(async (variant) => {
        if (variant.imageGallery && Array.isArray(variant.imageGallery)) {
          const uploadedGallery = await Promise.all(
            variant.imageGallery.map(async (img) => {
              const uploadRes = await cloudinary.uploader.upload(img, {
                folder: "products",
              });
              return uploadRes?.secure_url || "";
            }),
          );
          variant.imageGallery = uploadedGallery;
        }
        if (variant.swatchImage) {
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

  const createdAt = new Date();
  const updatedAt = new Date();

  const product = {
    productName,
    slug,
    stock,
    category,
    productDescription,
    price,
    discount,
    productImages: uploadedImageUrls,
    sku,
    variantDetails,
    createdAt,
    updatedAt,
  };

  try {
    await productCollection.insertOne(product);
    emitRealtimeEvent("product:updated", { action: "created", slug: product.slug });
    emitRealtimeEvent("dashboard:update", { type: "product", action: "created" });
    res.status(201).json({ message: "Product created successfully", product });
  } catch (error) {
    console.error("Error creating product:", error);
    res.status(500).json({ message: "Internal server error" });
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
    discount,
    category,
    productImages,
    sku,
    variantDetails,
  } = req.body;

  if (!id) {
    return res.status(400).json({ message: "Product ID is required" });
  }

  try {
    const existingProduct = await productCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!existingProduct) {
      return res.status(404).json({ message: "Product not found" });
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

    let processedVariants = variantDetails || existingProduct.variantDetails || [];
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

    const updatedDoc = {
      productName: productName ?? existingProduct.productName,
      slug: slug ?? existingProduct.slug,
      stock: stock ?? existingProduct.stock,
      category: category ?? existingProduct.category,
      productDescription:
        productDescription ?? existingProduct.productDescription,
      price: price ?? existingProduct.price,
      discount: discount ?? existingProduct.discount,
      productImages: uploadedImageUrls,
      sku: sku ?? existingProduct.sku,
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
    res.status(500).json({ message: "Failed to update product" });
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
    const filter = {};

    // Only filter by category if category is provided and not "all"
    if (category && category !== "all" && category !== "undefined") {
      filter.category = category;
    }

    // Search query support
    if (search && search.trim()) {
      const searchRegex = { $regex: search.trim(), $options: "i" };
      filter.$or = [
        { productName: searchRegex },
        { category: searchRegex },
        { sku: searchRegex },
      ];
    }

    if (minPrice || maxPrice) {
      filter["variantDetails.sizes.price"] = {};
      if (minPrice)
        filter["variantDetails.sizes.price"].$gte = Number(minPrice);
      if (maxPrice)
        filter["variantDetails.sizes.price"].$lte = Number(maxPrice);
    }

    if (sizes) {
      filter["variantDetails.sizes.size"] = { $in: sizes.split(",") };
    }

    if (colors) {
      filter["variantDetails.color"] = { $in: colors.split(",") };
    }

    if (stock === "in") {
      filter["variantDetails.sizes.stock"] = { $gt: 0 };
    } else if (stock === "out") {
      filter["variantDetails.sizes.stock"] = { $eq: 0 };
    }

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

export const getCategoryFilters = async (req, res) => {
  const { category } = req.query;
  try {
    const pipeline = [];

    if (category && category !== "all" && category !== "undefined") {
      pipeline.push({ $match: { category } });
    }

    pipeline.push(
      // Flatten variantDetails
      { $unwind: "$variantDetails" },

      // Flatten sizes array inside variantDetails
      { $unwind: "$variantDetails.sizes" },

      {
        $group: {
          _id: null,
          minPrice: { $min: { $toInt: "$variantDetails.sizes.price" } },
          maxPrice: { $max: { $toInt: "$variantDetails.sizes.price" } },
          colors: {
            $addToSet: {
              color: "$variantDetails.color",
              hex: "$variantDetails.hex",
              swatchImage: "$variantDetails.swatchImage",
            },
          },
          sizes: { $addToSet: "$variantDetails.sizes.size" },
          stockStatus: {
            $addToSet: {
              size: "$variantDetails.sizes.size",
              stock: "$variantDetails.sizes.stock",
            },
          },
        },
      },
    );

    const filter = await productCollection.aggregate(pipeline).toArray();
    res.json(
      filter[0] || {
        minPrice: 0,
        maxPrice: 10000,
        colors: [],
        sizes: [],
        stockStatus: [],
      },
    );
  } catch (error) {
    res.status(500).json({ message: "Filters error" });
  }
};
