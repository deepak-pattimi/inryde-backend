const axios = require('axios');

const DEFAULT_MSG91_AUTH_KEY = '565484A5BptsCY2T766aa0125aP1';
const DEFAULT_MSG91_TEMPLATE_ID = '6af19c94110e6f631608d802';
const DEFAULT_MSG91_SENDER_ID = 'INRYDE';
const DEFAULT_OTP_VALIDITY_MINUTES = '5';

const TEMPLATE_CACHE_TTL_MS = 5 * 60 * 1000;
const templateVarCache = new Map();

const extractTemplatePlaceholders = async (authKey, templateId) => {
    const cacheKey = `${authKey}:${templateId}`;
    const cached = templateVarCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.placeholders;
    }

    try {
        const response = await axios.post(
            'https://control.msg91.com/api/v5/sms/getTemplateVersions',
            { template_id: templateId },
            {
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json',
                    authkey: authKey,
                },
                timeout: 5000,
            }
        );

        const versions = Array.isArray(response.data?.data) ? response.data.data : [];
        const activeVersion =
            versions.find((v) => String(v.active_status) === '1' || String(v.status) === '1') ||
            versions[0];

        const templateData = activeVersion?.template_data || '';
        const placeholders = [];
        const regex = /##([a-zA-Z0-9_]+)##/g;
        let match;
        while ((match = regex.exec(templateData)) !== null) {
            if (match[1] && !placeholders.includes(match[1])) {
                placeholders.push(match[1]);
            }
        }

        if (placeholders.length > 0) {
            templateVarCache.set(cacheKey, {
                placeholders,
                expiresAt: Date.now() + TEMPLATE_CACHE_TTL_MS,
            });
        }
        return placeholders;
    } catch (error) {
        console.warn('[MSG91] Could not inspect template variables:', error.message);
        return null;
    }
};

const sendSMS = async (phone, otp) => {
    try {
        const rawDigits = (phone || '').toString().replace(/[^\d]/g, '');
        const tenDigits = rawDigits.length >= 10 ? rawDigits.slice(-10) : rawDigits;
        if (tenDigits.length !== 10) {
            throw new Error('Invalid 10-digit mobile number for SMS.');
        }

        const msg91Mobile = `91${tenDigits}`;
        const authKey = (process.env.MSG91_AUTH_KEY || DEFAULT_MSG91_AUTH_KEY).trim();
        const templateId = (process.env.MSG91_TEMPLATE_ID || DEFAULT_MSG91_TEMPLATE_ID).trim();
        const senderId = (process.env.MSG91_SENDER_ID || DEFAULT_MSG91_SENDER_ID).trim();
        const validityMinutes = (process.env.MSG91_OTP_VALIDITY_MINUTES || DEFAULT_OTP_VALIDITY_MINUTES).toString().trim();

        const recipientPayload = { mobiles: msg91Mobile };
        const placeholders = await extractTemplatePlaceholders(authKey, templateId);

        if (placeholders && placeholders.length > 0) {
            recipientPayload[placeholders[0]] = String(otp);
            if (placeholders.length > 1) {
                recipientPayload[placeholders[1]] = validityMinutes;
            }
        } else {
            Object.assign(recipientPayload, {
                value: String(otp),
                otp: String(otp),
                OTP: String(otp),
                var: String(otp),
                var1: String(otp),
                VAR1: String(otp),
                var2: validityMinutes,
                VAR2: validityMinutes,
                minutes: validityMinutes,
                time: validityMinutes,
                expiry: validityMinutes,
            });
        }

        const payload = {
            template_id: templateId,
            short_url: '0',
            realTimeResponse: '1',
            recipients: [recipientPayload],
        };
        if (senderId) {
            payload.sender = senderId;
        }

        console.log(`[MSG91] Sending OTP to ${msg91Mobile} (template: ${templateId})...`);

        const response = await axios.post(
            'https://control.msg91.com/api/v5/flow',
            payload,
            {
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json',
                    authkey: authKey,
                },
                timeout: 10000,
            }
        );

        console.log('[MSG91] SMS Response:', response.data);

        if (response.data?.type === 'error') {
            throw new Error(response.data?.message || 'MSG91 rejected the SMS request.');
        }

        return response.data;
    } catch (error) {
        const gatewayMessage = error.response?.data?.message || error.message;
        console.error('[MSG91] SMS Gateway Error:', error.response?.data || error.message);
        throw new Error('Failed to send SMS via MSG91: ' + gatewayMessage);
    }
};

module.exports = { sendSMS };