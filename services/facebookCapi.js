import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

/**
 * SHA-256 hashing helper
 */
export const hashData = (value) => {
  if (!value) return null;
  const str = String(value).trim().toLowerCase();
  if (!str) return null;
  return crypto.createHash("sha256").update(str).digest("hex");
};

/**
 * Normalize phone number for Meta Conversions API
 * Standardizes BD phone numbers (e.g. 017xxxxxxxx -> 88017xxxxxxxx)
 */
export const normalizePhone = (phone) => {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, "");
  if (!digits) return null;

  // Handle local Bangladesh phone formats
  if (digits.startsWith("0") && digits.length === 11) {
    digits = "88" + digits;
  } else if (digits.startsWith("1") && digits.length === 10) {
    digits = "880" + digits;
  } else if (digits.startsWith("880") && digits.length === 13) {
    // already in E.164 without plus
  }

  return hashData(digits);
};

/**
 * Extract real client IP from Express request
 */
export const extractClientIp = (req) => {
  if (!req) return null;
  const forwarded = req.headers?.["x-forwarded-for"];
  if (forwarded) {
    const firstIp = forwarded.split(",")[0].trim();
    if (firstIp) return firstIp;
  }
  const realIp = req.headers?.["x-real-ip"] || req.headers?.["cf-connecting-ip"];
  if (realIp) return realIp;

  const remote = req.socket?.remoteAddress || req.ip;
  if (remote === "::1" || remote === "::ffff:127.0.0.1") {
    return "127.0.0.1";
  }
  return remote || null;
};

/**
 * Extract client user agent from request
 */
export const extractUserAgent = (req) => {
  if (!req) return null;
  return req.headers?.["user-agent"] || null;
};

/**
 * Format user data object according to Meta CAPI specification
 */
export const formatUserData = ({
  customer = {},
  user = {},
  req = null,
  fbp = null,
  fbc = null,
  ip = null,
  userAgent = null,
}) => {
  const userData = {};

  // Email
  const email = customer?.email || user?.email;
  if (email) {
    const hashedEmail = hashData(email);
    if (hashedEmail) userData.em = [hashedEmail];
  }

  // Phone
  const phone = customer?.phone || user?.phone;
  if (phone) {
    const hashedPhone = normalizePhone(phone);
    if (hashedPhone) userData.ph = [hashedPhone];
  }

  // First & Last Name
  const fullName = customer?.name || user?.name || "";
  let firstName = customer?.firstName || user?.firstName;
  let lastName = customer?.lastName || user?.lastName;

  if (!firstName && fullName) {
    const parts = fullName.trim().split(/\s+/);
    firstName = parts[0];
    lastName = parts.slice(1).join(" ");
  }

  if (firstName) {
    const fn = hashData(firstName);
    if (fn) userData.fn = [fn];
  }

  if (lastName) {
    const ln = hashData(lastName);
    if (ln) userData.ln = [ln];
  }

  // City / District
  const city = customer?.district || customer?.city || customer?.thana;
  if (city) {
    const ct = hashData(city);
    if (ct) userData.ct = [ct];
  }

  // Country (Default: Bangladesh 'bd')
  const country = customer?.country || "bd";
  const cn = hashData(country);
  if (cn) userData.country = [cn];

  // IP Address (Unhashed)
  const clientIp = ip || extractClientIp(req);
  if (clientIp) {
    userData.client_ip_address = clientIp;
  }

  // User Agent (Unhashed)
  const clientUa = userAgent || extractUserAgent(req);
  if (clientUa) {
    userData.client_user_agent = clientUa;
  }

  // Meta Cookies _fbp & _fbc (Unhashed)
  const resolvedFbp = fbp || req?.cookies?._fbp || null;
  const resolvedFbc = fbc || req?.cookies?._fbc || null;

  if (resolvedFbp) userData.fbp = resolvedFbp;
  if (resolvedFbc) userData.fbc = resolvedFbc;

  return userData;
};

/**
 * Send event to Meta Conversions API
 */
export const sendFacebookCapiEvent = async ({
  eventName,
  eventId,
  eventSourceUrl,
  customData = {},
  customer = {},
  user = {},
  req = null,
  fbp = null,
  fbc = null,
  ip = null,
  userAgent = null,
}) => {
  const pixelId = process.env.FACEBOOK_PIXEL_ID;
  const accessToken = process.env.FACEBOOK_ACCESS_TOKEN;
  const testEventCode = process.env.FACEBOOK_TEST_EVENT_CODE;

  if (!pixelId || !accessToken) {
    // Graceful skip if Facebook credentials are not yet configured
    console.warn(
      "[Meta Conversions API] Event skipped: FACEBOOK_PIXEL_ID or FACEBOOK_ACCESS_TOKEN is missing in server environment."
    );
    return { success: false, skipped: true, message: "Missing credentials" };
  }

  const userData = formatUserData({
    customer,
    user,
    req,
    fbp,
    fbc,
    ip,
    userAgent,
  });

  const eventPayload = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId ? String(eventId) : undefined,
    event_source_url:
      eventSourceUrl ||
      process.env.FRONTEND_URL ||
      "https://bivasstyle.com",
    action_source: "website",
    user_data: userData,
    custom_data: {
      currency: customData?.currency || "BDT",
      ...customData,
    },
  };

  const requestBody = {
    data: [eventPayload],
  };

  if (testEventCode) {
    requestBody.test_event_code = testEventCode;
  }

  const endpoint = `https://graph.facebook.com/v21.0/${pixelId}/events?access_token=${accessToken}`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(
        `[Meta Conversions API] Failed to send ${eventName}:`,
        JSON.stringify(data)
      );
      return { success: false, error: data };
    }

    console.log(
      `[Meta Conversions API] Successfully sent ${eventName} (ID: ${eventId || "n/a"}, Events Received: ${data?.events_received})`
    );
    return { success: true, data };
  } catch (error) {
    console.error(`[Meta Conversions API] Network/Execution error on ${eventName}:`, error.message);
    return { success: false, error: error.message };
  }
};

