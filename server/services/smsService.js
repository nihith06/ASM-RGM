import config from '../env.js';

// Internal in-memory store of recently dispatched OTPs for testing and SMS verification
const dispatchedOtps = new Map();

export function getLastDispatchedOtp(phone) {
  const cleanPhone = (phone || '').trim().replace(/[^0-9]/g, '');
  return dispatchedOtps.get(cleanPhone) || null;
}

/**
 * Clean SMS gateway interface for dispatching OTPs and notifications.
 * Supports:
 * - 'console': Local simulator for development / debugging (disabled in production if unconfigured)
 * - 'msg91': Ready for enterprise SMS gateway
 * - 'fast2sms': Ready for Fast2SMS gateway
 * - 'none': Fails securely, notifying caller that SMS is not configured
 */
export async function sendOtpSms({ phone, otp, recipientName = 'User', role = 'faculty' }) {
  const cleanPhone = (phone || '').trim().replace(/[^0-9]/g, '');
  dispatchedOtps.set(cleanPhone, otp);
  const provider = config.SMS_PROVIDER;

  // In production with no gateway configured:
  if (!provider || provider === 'none') {
    return {
      success: false,
      error: 'SMS notification service is not configured on this server. Please contact a department administrator for credential assistance.'
    };
  }

  // Console simulator for development and local testing
  if (provider === 'console') {
    if (config.isProduction) {
      console.warn(`[SMS SECURITY WARNING] Console SMS simulator active in production environment for ${phone}`);
    }
    console.log(`\n========================================================`);
    console.log(`📱 [SMS OTP GATEWAY - SIMULATOR]`);
    console.log(`Recipient: ${recipientName} (${role.toUpperCase()})`);
    console.log(`Phone: ${phone}`);
    console.log(`One-Time Password (OTP): ${otp}`);
    console.log(`Validity: 10 minutes`);
    console.log(`========================================================\n`);

    return { success: true, provider: 'console' };
  }

  // MSG91 Provider Integration
  if (provider === 'msg91') {
    const authKey = process.env.MSG91_AUTH_KEY;
    const templateId = process.env.MSG91_TEMPLATE_ID;
    if (!authKey || !templateId) {
      return {
        success: false,
        error: 'MSG91 gateway credentials (MSG91_AUTH_KEY, MSG91_TEMPLATE_ID) are not configured.'
      };
    }

    try {
      const response = await fetch('https://control.msg91.com/api/v5/otp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'authkey': authKey
        },
        body: JSON.stringify({
          template_id: templateId,
          mobile: phone.startsWith('91') ? phone : `91${phone}`,
          otp
        })
      });
      const data = await response.json();
      if (response.ok && data.type !== 'error') {
        return { success: true, provider: 'msg91' };
      }
      return { success: false, error: data.message || 'MSG91 delivery failed' };
    } catch (err) {
      return { success: false, error: `SMS gateway network error: ${err.message}` };
    }
  }

  // Fast2SMS Provider Integration
  if (provider === 'fast2sms') {
    const apiKey = process.env.FAST2SMS_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error: 'Fast2SMS API key (FAST2SMS_API_KEY) is not configured.'
      };
    }

    try {
      const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: {
          'authorization': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          route: 'otp',
          variables_values: otp,
          numbers: phone
        })
      });
      const data = await response.json();
      if (response.ok && data.return === true) {
        return { success: true, provider: 'fast2sms' };
      }
      return { success: false, error: data.message || 'Fast2SMS delivery failed' };
    } catch (err) {
      return { success: false, error: `SMS gateway network error: ${err.message}` };
    }
  }

  return {
    success: false,
    error: `Unsupported SMS provider configured: "${provider}". Supported: console, msg91, fast2sms, none.`
  };
}
