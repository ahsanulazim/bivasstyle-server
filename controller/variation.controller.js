import { ObjectId } from "mongodb";
import { variationCollection } from "../db/db.collection.js";
import { emitRealtimeEvent } from "../lib/socket.js";

export const createVariation = async (req, res) => {
  const { name, slug, attributeSlug, value } = req.body;

  if (!name || !slug || !attributeSlug || !value) {
    return res
      .status(400)
      .json({ success: false, message: "All fields are required" });
  }

  const createdAt = new Date();
  const updatedAt = new Date();
  const newVariation = {
    name,
    slug,
    attributeSlug,
    value,
    createdAt,
    updatedAt,
  };

  try {
    await variationCollection.insertOne(newVariation);
    emitRealtimeEvent("variation:updated", { action: "created", slug, attributeSlug });
    emitRealtimeEvent("dashboard:update", { type: "variation", action: "created" });
    res
      .status(201)
      .json({ success: true, message: "Variation created successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Variation creation Failed" });
  }
};

export const getAllVariationAsType = async (req, res) => {
  const { type } = req.params;

  try {
    const variations = await variationCollection
      .find({ attributeSlug: type })
      .toArray();
    res.status(200).json(variations);
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch variations" });
  }
};

export const getAllVariation = async (req, res) => {
  try {
    const variations = await variationCollection.find().toArray();
    res.status(200).json(variations);
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch variations" });
  }
};

export const deleteVariation = async (req, res) => {
  const { id } = req.query;
  try {
    await variationCollection.deleteOne({ _id: new ObjectId(id) });
    emitRealtimeEvent("variation:updated", { action: "deleted", variationId: id });
    emitRealtimeEvent("dashboard:update", { type: "variation", action: "deleted" });
    res
      .status(200)
      .json({ success: true, message: "Variation deleted successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Failed to delete variation" });
  }
};
