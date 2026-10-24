"use strict";

const { AttachmentBuilder } = require("discord.js");
const { getDatabase } = require("../../../database");
const eco = require("./service");

const MAX_IMAGE_BYTES = 7 * 1024 * 1024;
const ALLOWED = new Map([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/webp", "webp"],
    ["image/gif", "gif"]
]);
const VALID_HOSTS = new Set([
    "cdn.discordapp.com",
    "media.discordapp.net"
]);

function images() {
    return getDatabase().collection("economy_item_images");
}

function key(guildId, itemKey) {
    return guildId + ":" + eco.slug(itemKey);
}

function detectMime(bytes) {
    if (bytes.length > 8 &&
        bytes.subarray(0, 8).equals(
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
        )) return "image/png";
    if (bytes.length > 3 && bytes[0] === 0xFF &&
        bytes[1] === 0xD8 && bytes[2] === 0xFF) {
        return "image/jpeg";
    }
    if (bytes.length > 12 &&
        bytes.subarray(0, 4).toString() === "RIFF" &&
        bytes.subarray(8, 12).toString() === "WEBP") {
        return "image/webp";
    }
    if (bytes.length > 6 &&
        ["GIF87a", "GIF89a"].includes(
            bytes.subarray(0, 6).toString()
        )) return "image/gif";
    return null;
}

async function readAttachment(attachment) {
    if (!attachment?.url) return null;
    const parsed = new URL(attachment.url);
    if (parsed.protocol !== "https:" ||
        !VALID_HOSTS.has(parsed.hostname)) {
        throw new Error("Upload an image attachment directly to Discord.");
    }

    const declared = attachment.contentType?.split(";")[0]
        ?.toLowerCase();
    if (!ALLOWED.has(declared)) {
        throw new Error("Use a PNG, JPEG, WebP or GIF image.");
    }
    if (attachment.size > MAX_IMAGE_BYTES) {
        throw new Error("Image must be smaller than 7 MB.");
    }
    const response = await fetch(attachment.url, {
        signal: AbortSignal.timeout(12000),
        redirect: "error"
    });
    if (!response.ok) throw new Error("Could not read Discord image.");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 10 || bytes.length > MAX_IMAGE_BYTES ||
        detectMime(bytes) !== declared) {
        throw new Error("Invalid image data or wrong image format.");
    }
    return { bytes, mime: declared };
}

async function saveImage(guildId, itemKey, prepared) {
    if (!prepared) return;
    const id = key(guildId, itemKey);
    await images().updateOne({ _id: id }, {
        $set: {
            guildId, itemKey: eco.slug(itemKey),
            mime: prepared.mime,
            data: prepared.bytes,
            updatedAt: new Date()
        }
    }, { upsert: true });
    await eco.catalog().updateOne(
        { _id: id, guildId },
        { $set: { hasImage: true, updatedAt: new Date() } }
    );
}

async function removeImage(guildId, itemKey) {
    const id = key(guildId, itemKey);
    await images().deleteOne({ _id: id });
    await eco.catalog().updateOne(
        { _id: id, guildId },
        { $set: { hasImage: false, updatedAt: new Date() } }
    );
}

async function productImage(guildId, itemKey) {
    const found = await images().findOne({
        _id: key(guildId, itemKey)
    });
    if (!found || !ALLOWED.has(found.mime)) return null;
    // The MongoDB driver can return either Buffer or BSON Binary.
    const bytes = Buffer.isBuffer(found.data)
        ? found.data
        : Buffer.from(found.data?.buffer || found.data || []);
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES ||
        detectMime(bytes) !== found.mime) return null;
    const ext = ALLOWED.get(found.mime);
    return {
        attachment: new AttachmentBuilder(bytes, {
            name: "item-image." + ext
        }),
        url: "attachment://item-image." + ext
    };
}

module.exports = {
    readAttachment, saveImage, removeImage, productImage,
    detectMime, MAX_IMAGE_BYTES
};
