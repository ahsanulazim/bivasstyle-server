import { ObjectId } from "mongodb";
import { attributeCollection } from "../db/db.collection.js";
import { emitRealtimeEvent } from "../lib/socket.js";

export const createAttribute = async (req, res) => {
  const { name, slug, variations } = req.body;

  if (!name || !slug || !variations) {
    return res
      .status(400)
      .json({ success: false, message: "All fields are required" });
  }

  const createdAt = new Date();
  const updatedAt = new Date();

  const attribute = {
    name,
    slug,
    variations,
    createdAt,
    updatedAt,
  };

  try {
    await attributeCollection.insertOne(attribute);
    emitRealtimeEvent("attribute:updated", { action: "created", slug });
    emitRealtimeEvent("dashboard:update", { type: "attribute", action: "created" });
    res
      .status(201)
      .json({ success: true, message: "Attribute created successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Attribute creation Failed" });
  }
};

export const updateAttribute = async (req, res) => {
  const { id } = req.query;
  const { name, slug, variations } = req.body;

  if (!name || !slug || !variations) {
    return res
      .status(400)
      .json({ success: false, message: "All fields are required" });
  }

  const updatedAt = new Date();

  const attribute = {
    name,
    slug,
    variations,
    updatedAt,
  };

  try {
    await attributeCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: attribute },
    );
    emitRealtimeEvent("attribute:updated", { action: "updated", attributeId: id });
    emitRealtimeEvent("dashboard:update", { type: "attribute", action: "updated" });
    res
      .status(200)
      .json({ success: true, message: "Attribute updated successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Attribute update Failed" });
  }
};

export const getAllAttribute = async (req, res) => {
  try {
    const attributes = await attributeCollection.find().toArray();

    res.status(200).json(attributes);
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Attributes finding Failed" });
  }
};

export const deleteAttribute = async (req, res) => {
  const { id } = req.query;

  try {
    await attributeCollection.deleteOne({ _id: new ObjectId(id) });
    emitRealtimeEvent("attribute:updated", { action: "deleted", attributeId: id });
    emitRealtimeEvent("dashboard:update", { type: "attribute", action: "deleted" });
    res
      .status(200)
      .json({ success: true, message: "Attribute deleted successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Attribute deletion Failed" });
  }
};
