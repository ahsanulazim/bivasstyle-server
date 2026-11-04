import { ObjectId } from "mongodb";
import cloudinary from "../lib/cloudinary.js";
import { shippingRateCollection } from "../db/db.collection.js";
import { emitRealtimeEvent } from "../lib/socket.js";

export const createShippingRate = async (req, res) => {
  let {
    baseCharge,
    companyLogo,
    companyName,
    extraCharge,
    location,
    status,
    weightLimit,
  } = req.body;

  const parsedBaseCharge = Number(baseCharge);
  const parsedExtraCharge =
    extraCharge === undefined ||
    extraCharge === "" ||
    isNaN(Number(extraCharge))
      ? 0
      : Number(extraCharge);
  const parsedWeightLimit = Number(weightLimit);
  const parsedStatus = typeof status === "boolean" ? status : status === "true";

  if (
    !companyName ||
    !location ||
    isNaN(parsedBaseCharge) ||
    parsedBaseCharge <= 0 ||
    isNaN(parsedWeightLimit) ||
    parsedWeightLimit <= 0
  ) {
    return res.status(400).json({
      message:
        "Company name, company logo, location, valid base charge (> 0), and weight limit (> 0) are required",
    });
  }

  if (parsedExtraCharge < 0) {
    return res.status(400).json({
      message: "Extra charge cannot be negative",
    });
  }

  if (!Array.isArray(location) || location.length === 0) {
    return res.status(400).json({ message: "Location is required" });
  }

  let companyLogoUrl = "";
  if (companyLogo) {
    try {
      const uploadRes = await cloudinary.uploader.upload(companyLogo, {
        folder: "shipping",
      });
      companyLogoUrl = uploadRes?.secure_url || "";
    } catch (uploadError) {
      console.error("Cloudinary upload failed:", uploadError);
      return res.status(500).json({
        success: false,
        message: "Failed to upload company logo",
      });
    }
  }

  const createdAt = new Date();
  const updatedAt = new Date();

  const shippingRate = {
    baseCharge: parsedBaseCharge,
    companyLogo: companyLogoUrl,
    companyName: companyName.trim(),
    extraCharge: parsedExtraCharge,
    location,
    status: parsedStatus,
    weightLimit: parsedWeightLimit,
    createdAt,
    updatedAt,
  };

  try {
    const result = await shippingRateCollection.insertOne(shippingRate);
    emitRealtimeEvent("shipping:updated", {
      action: "created",
      id: result.insertedId,
    });
    emitRealtimeEvent("dashboard:update", {
      type: "shipping",
      action: "created",
    });
    res
      .status(201)
      .json({
        success: true,
        message: "Shipping rate created successfully",
        rate: shippingRate,
      });
  } catch (error) {
    console.error("Error creating shipping rate:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const updateShippingRate = async (req, res) => {
  const { id } = req.query;

  if (!id) {
    return res
      .status(400)
      .json({ success: false, message: "Shipping rate ID is required" });
  }

  let {
    baseCharge,
    companyLogo,
    companyName,
    extraCharge,
    location,
    status,
    weightLimit,
  } = req.body;

  const parsedBaseCharge = Number(baseCharge);
  const parsedExtraCharge =
    extraCharge === undefined ||
    extraCharge === "" ||
    isNaN(Number(extraCharge))
      ? 0
      : Number(extraCharge);
  const parsedWeightLimit = Number(weightLimit);
  const parsedStatus = typeof status === "boolean" ? status : status === "true";

  if (
    !companyName ||
    !location ||
    isNaN(parsedBaseCharge) ||
    parsedBaseCharge <= 0 ||
    isNaN(parsedWeightLimit) ||
    parsedWeightLimit <= 0
  ) {
    return res.status(400).json({
      message:
        "Company name, location, valid base charge (> 0), and weight limit (> 0) are required",
    });
  }

  if (parsedExtraCharge < 0) {
    return res.status(400).json({
      message: "Extra charge cannot be negative",
    });
  }

  if (!Array.isArray(location) || location.length === 0) {
    return res.status(400).json({ message: "Location is required" });
  }

  try {
    const existingRate = await shippingRateCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!existingRate) {
      return res
        .status(404)
        .json({ success: false, message: "Shipping rate not found" });
    }

    let companyLogoUrl = existingRate.companyLogo;

    // If new base64 image string is provided, upload to cloudinary and replace old image
    if (companyLogo && companyLogo.startsWith("data:image")) {
      try {
        const uploadRes = await cloudinary.uploader.upload(companyLogo, {
          folder: "shipping",
        });
        companyLogoUrl = uploadRes?.secure_url || companyLogoUrl;

        // Clean up old logo if it was hosted on cloudinary
        if (existingRate.companyLogo) {
          const filename = existingRate.companyLogo.split("/").pop();
          const publicId = filename ? filename.split(".")[0] : null;
          if (publicId) {
            await cloudinary.uploader
              .destroy(`shipping/${publicId}`)
              .catch(() => {});
          }
        }
      } catch (uploadError) {
        console.error("Cloudinary upload failed on update:", uploadError);
        return res.status(500).json({
          success: false,
          message: "Failed to upload new company logo",
        });
      }
    } else if (companyLogo && companyLogo.startsWith("http")) {
      companyLogoUrl = companyLogo;
    }

    const updatedData = {
      baseCharge: parsedBaseCharge,
      companyLogo: companyLogoUrl,
      companyName: companyName.trim(),
      extraCharge: parsedExtraCharge,
      location,
      status: parsedStatus,
      weightLimit: parsedWeightLimit,
      updatedAt: new Date(),
    };

    await shippingRateCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedData },
    );

    emitRealtimeEvent("shipping:updated", {
      action: "updated",
      shippingRateId: id,
    });
    emitRealtimeEvent("dashboard:update", {
      type: "shipping",
      action: "updated",
    });

    res.status(200).json({
      success: true,
      message: "Shipping rate updated successfully",
      rate: { ...existingRate, ...updatedData },
    });
  } catch (error) {
    console.error("Error updating shipping rate:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to update shipping rate" });
  }
};

export const getAllShippingRates = async (req, res) => {
  try {
    const shippingRates = await shippingRateCollection
      .find()
      .sort({ createdAt: -1 })
      .toArray();
    res.status(200).json(shippingRates);
  } catch (error) {
    console.error("Error fetching shipping rates:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const getShippingRateByDistrict = async (req, res) => {
  const { district } = req.query;

  if (!district) {
    return res
      .status(400)
      .json({ success: false, message: "District is required" });
  }

  try {
    const districtQuery = [district];
    if (!isNaN(district)) {
      districtQuery.push(Number(district));
    }

    // Find active rate for this specific district
    const insideDistrict = await shippingRateCollection.findOne({
      status: true,
      "location.value": { $in: districtQuery },
    });

    if (insideDistrict) {
      return res.status(200).json(insideDistrict);
    }

    // Fallback to active general/all rate
    const outsideDistrict = await shippingRateCollection.findOne({
      status: true,
      "location.value": "all",
    });

    res.status(200).json(outsideDistrict || null);
  } catch (error) {
    console.error("Error fetching shipping rate:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const deleteShippingRate = async (req, res) => {
  const { id } = req.query;

  if (!id) {
    return res
      .status(400)
      .json({ success: false, message: "Shipping rate ID is required" });
  }

  try {
    const shippingRate = await shippingRateCollection.findOne({
      _id: new ObjectId(id),
    });
    if (!shippingRate) {
      return res
        .status(404)
        .json({ success: false, message: "Shipping rate not found" });
    }

    if (shippingRate.companyLogo) {
      const filename = shippingRate.companyLogo.split("/").pop();
      const publicId = filename ? filename.split(".")[0] : null;
      if (publicId) {
        try {
          await cloudinary.uploader.destroy(`shipping/${publicId}`);
          console.log("Deleted Image from Cloudinary:", publicId);
        } catch (error) {
          console.error("Error Deleting Image", error);
        }
      }
    }

    await shippingRateCollection.deleteOne({ _id: new ObjectId(id) });
    emitRealtimeEvent("shipping:updated", {
      action: "deleted",
      shippingRateId: id,
    });
    emitRealtimeEvent("dashboard:update", {
      type: "shipping",
      action: "deleted",
    });
    res
      .status(200)
      .json({ success: true, message: "Shipping rate deleted successfully" });
  } catch (error) {
    console.error("Error deleting shipping rate:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to delete shipping rate" });
  }
};
