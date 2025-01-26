/**
 * server.ts
 *
 * A custom Fastify server for Next.js + Twilio + OpenAI Realtime API.
 * Demonstrates an outbound AI-driven call with user-defined flow.
 */
import Fastify from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import { WebSocket } from 'ws';
import * as dotenv from 'dotenv';
import * as path from 'path';
import twilio from 'twilio';
import next from 'next';
// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env.local') });
// Retrieve variables from env
const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, DOMAIN: rawDomain, OPENAI_API_KEY, PORT: rawPort } = process.env;
const PHONE_NUMBER_FROM = process.env.PHONE_NUMBER_FROM || '';
if (!PHONE_NUMBER_FROM) {
    throw new Error('PHONE_NUMBER_FROM is not defined in the environment variables.');
}
if (!TWILIO_ACCOUNT_SID ||
    !TWILIO_AUTH_TOKEN ||
    !PHONE_NUMBER_FROM ||
    !rawDomain ||
    !OPENAI_API_KEY) {
    console.error('Missing one or more required environment variables.');
    process.exit(1);
}
const DOMAIN = rawDomain
    .replace(/(^\w+:|^)\/\//, '')
    .replace(/\/+$/, '');
const PORT = parseInt(rawPort || '3000', 10);
const callsData = new Map();
/**
 * Our system message. We'll keep it short and sweet; we’ll also incorporate
 * user flow data at runtime. We can add jokes or personality if we want.
 */
function buildSystemMessage(flow) {
    return `
    You are a helpful, positive AI phone agent representing a business. 
    The business info: ${flow.businessInfo}.
    
    The user specifically wants the conversation to revolve around: ${flow.topic}.
    They want you to greet the callee by saying: "${flow.greeting}" 
    Then, you must eventually ask the following question(s): ${flow.questions.join('; ')}.
    Finally, end the call with: "${flow.ending}".
    
    Always stay polite, helpful, and on-topic. If the user reacts, respond accordingly,
    but keep the conversation aligned with the business's goal. 
  `;
}
// Twilio + OpenAI references
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
// We’ll generate TwiML that instructs Twilio to open a Media Stream websocket
const outboundTwiML = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${DOMAIN}/media-stream" />
  </Connect>
</Response>`;
// Our set of events to log from OpenAI Realtime
const LOG_EVENT_TYPES = [
    'error',
    'response.content.done',
    'rate_limits.updated',
    'response.done',
    'input_audio_buffer.committed',
    'input_audio_buffer.speech_stopped',
    'input_audio_buffer.speech_started',
    'session.created'
];
/**
 * isNumberAllowed checks if `toPhone` is allowed to be called.
 * Here we check if it's a Twilio dev phone or a verified caller ID.
 * You must adapt for your compliance/permission rules in production!
 */
async function isNumberAllowed(to) {
    try {
        // check Twilio incoming phone numbers
        const incomingNumbers = await twilioClient.incomingPhoneNumbers.list({ phoneNumber: to });
        if (incomingNumbers.length > 0) {
            return true;
        }
        // check Twilio verified caller IDs
        const outgoingCallerIds = await twilioClient.outgoingCallerIds.list({ phoneNumber: to });
        if (outgoingCallerIds.length > 0) {
            return true;
        }
        return false;
    }
    catch (error) {
        console.error('Error checking phone number:', error);
        return false;
    }
}
/**
 * Make the call via Twilio
 */
async function makeCall(to) {
    try {
        const allowed = await isNumberAllowed(to);
        if (!allowed) {
            console.warn(`Number ${to} is not recognized or not allowed to be called.`);
            return undefined;
        }
        // Kick off the call
        const call = await twilioClient.calls.create({
            from: PHONE_NUMBER_FROM,
            to,
            twiml: outboundTwiML,
        });
        console.log(`Call started. SID: ${call.sid}`);
        return call.sid;
    }
    catch (err) {
        console.error('Error making call:', err);
        return undefined;
    }
}
/**
 * Setup the Next.js app and integrate it with our Fastify server.
 */
async function buildApp() {
    const dev = process.env.NODE_ENV !== 'production';
    const nextApp = next({ dev });
    const handle = nextApp.getRequestHandler();
    await nextApp.prepare();
    const fastify = Fastify();
    // Register plugins
    fastify.register(fastifyFormBody);
    fastify.register(fastifyWs);
    // A simple route to check server status
    fastify.get('/', async () => {
        return { message: 'Twilio AI Outbound Server is running!' };
    });
    /**
     * POST /api/outbound-call
     *
     * This endpoint accepts a FlowDefinition, initiates the call, and returns a call SID.
     */
    fastify.post('/api/outbound-call', async (request, reply) => {
        const flow = request.body;
        if (!flow || !flow.toPhone) {
            return reply.status(400).send({
                error: 'Missing required fields. "toPhone" is required.'
            });
        }
        // Make the call
        const sid = await makeCall(flow.toPhone);
        if (!sid) {
            return reply.status(400).send({
                error: `Unable to make call to ${flow.toPhone}`
            });
        }
        // Store the flowDefinition for reference
        callsData.set(sid, { flowDefinition: flow });
        console.log(`Stored call data for callSid: ${sid}`);
        return reply.status(200).send({ callSid: sid });
    });
    /**
     * GET /api/call-summary?callSid=...
     *
     * Simple endpoint to retrieve the final summary for a particular call.
     */
    fastify.get('/api/call-summary', async (request, reply) => {
        const { callSid } = request.query;
        if (!callSid) {
            return reply.status(400).send({ error: 'callSid is required' });
        }
        const info = callsData.get(callSid);
        if (!info) {
            return reply.status(404).send({ error: 'No call info found' });
        }
        return reply.status(200).send({
            summary: info.summary || null,
            isComplete: info.isComplete || false
        });
    });
    /**
     * WebSocket route for Twilio -> OpenAI media streams
     */
    fastify.register(async (fastifyInstance) => {
        fastifyInstance.get('/media-stream', { websocket: true }, (connection, req) => {
            console.log('Twilio media-stream connected.');
            let callSid;
            let openAiWs = null;
            let streamSid = null;
            let conversationTextLog = ''; // We'll collect text from assistant.
            // We need to figure out which callSid this stream belongs to. 
            // Twilio includes it in the "start" message. We'll grab it there.
            //
            // Once we know which call this is, we can build the system + initial prompt 
            // based on the user’s FlowDefinition.
            //
            const sendInitialSessionUpdate = (flow) => {
                if (!openAiWs)
                    return;
                const sessionUpdate = {
                    type: 'session.update',
                    session: {
                        turn_detection: { type: 'server_vad' },
                        input_audio_format: 'g711_ulaw',
                        output_audio_format: 'g711_ulaw',
                        voice: 'alloy', // choose your voice from the OpenAI docs
                        instructions: buildSystemMessage(flow),
                        modalities: ['text', 'audio'],
                        temperature: 0.8
                    }
                };
                openAiWs.send(JSON.stringify(sessionUpdate));
                // The AI "talks first" with a greeting from the flow
                const initialConversationItem = {
                    type: 'conversation.item.create',
                    item: {
                        type: 'message',
                        role: 'user',
                        content: [
                            {
                                type: 'input_text',
                                text: flow.greeting || 'Hello! (No greeting set?)'
                            }
                        ]
                    }
                };
                openAiWs.send(JSON.stringify(initialConversationItem));
                // Trigger it to speak
                openAiWs.send(JSON.stringify({ type: 'response.create' }));
            };
            // 1) Open connection to OpenAI
            openAiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
                headers: {
                    Authorization: `Bearer ${OPENAI_API_KEY}`,
                    'OpenAI-Beta': 'realtime=v1'
                }
            });
            // 2) Once the OpenAI connection is open, we might wait to send the session update 
            //    until we know the call’s flow data (which we parse from the Twilio 'start' message).
            openAiWs.on('open', () => {
                console.log('[OpenAI] Realtime WS connected');
            });
            openAiWs.on('message', (rawData) => {
                try {
                    const response = JSON.parse(rawData.toString());
                    if (LOG_EVENT_TYPES.includes(response.type)) {
                        console.log(`(OpenAI) Event: ${response.type}`, response);
                    }
                    // If the AI is sending us audio, forward it to Twilio
                    if (response.type === 'response.audio.delta' && response.delta) {
                        // forward
                        const audioDelta = {
                            event: 'media',
                            streamSid,
                            media: {
                                payload: Buffer.from(response.delta, 'base64').toString('base64')
                            }
                        };
                        connection.send(JSON.stringify(audioDelta));
                    }
                    // If we see conversation text, let's collect it for the final summary
                    if (response.type === 'response.text' && response.text) {
                        conversationTextLog += response.text + '\n';
                    }
                    // If the model finishes, let's do a quick final summary request (optional).
                    // We'll do it after "response.done" so that the call is near finishing.
                    // If you prefer, you could do the summary request even later.
                    if (response.type === 'response.done') {
                        // Make a final "summarize" request from OpenAI
                        console.log('[OpenAI] Conversation ended, requesting summary...');
                        const summaryReq = {
                            type: 'conversation.item.create',
                            item: {
                                type: 'message',
                                role: 'user',
                                content: [
                                    {
                                        type: 'input_text',
                                        text: 'Please provide a short bullet-point summary of our conversation.'
                                    }
                                ]
                            }
                        };
                        openAiWs?.send(JSON.stringify(summaryReq));
                        openAiWs?.send(JSON.stringify({ type: 'response.create' }));
                    }
                    // If the AI returns some text after we ask for summary:
                    if (response.type === 'response.text.done') {
                        // We parse the summary from the conversationTextLog’s last chunk or from this event
                        // We can guess the last chunk is the summary:
                        const finalSummary = conversationTextLog.trim();
                        if (callSid && callsData.has(callSid)) {
                            const info = callsData.get(callSid);
                            if (info) {
                                info.summary = finalSummary;
                                info.isComplete = true;
                                callsData.set(callSid, info);
                            }
                        }
                        console.log(`[OpenAI] Final summary:\n${finalSummary}`);
                    }
                }
                catch (err) {
                    console.error('[OpenAI] Error in onMessage:', err);
                }
            });
            openAiWs.on('error', (err) => {
                console.error('[OpenAI] WebSocket error:', err);
            });
            openAiWs.on('close', () => {
                console.log('[OpenAI] WebSocket closed');
            });
            // 3) Handle Twilio -> Our server messages
            connection.on('message', (msg) => {
                try {
                    const data = JSON.parse(msg.toString());
                    switch (data.event) {
                        case 'start':
                            streamSid = data.start.streamSid;
                            console.log('[Twilio WS] Stream started. SID:', streamSid);
                            // Twilio passes "callSid" in "start.customParameters"
                            // Example: data.start.customParameters might contain `CallSid=CAxxxx`
                            const paramString = data.start.customParameters || '';
                            const match = paramString.match(/CallSid=(?<cid>CA[0-9a-f]+)/);
                            if (match && match.groups && match.groups.cid) {
                                callSid = match.groups.cid;
                                console.log('[Twilio WS] Found callSid =', callSid);
                                // If we have flow data, now we can do the session update
                                const info = callSid ? callsData.get(callSid) : undefined;
                                if (info && openAiWs.readyState === WebSocket.OPEN) {
                                    setTimeout(() => {
                                        sendInitialSessionUpdate(info.flowDefinition);
                                    }, 200); // short delay to ensure it's all connected
                                }
                            }
                            break;
                        case 'media':
                            // If we have an openAiWs, forward the G711 audio up
                            if (openAiWs && openAiWs.readyState === WebSocket.OPEN) {
                                const audioAppend = {
                                    type: 'input_audio_buffer.append',
                                    audio: data.media.payload
                                };
                                openAiWs.send(JSON.stringify(audioAppend));
                            }
                            break;
                        default:
                            console.log('[Twilio WS] Non-media event:', data.event);
                    }
                }
                catch (err) {
                    console.error('[Twilio WS] Error parsing message:', err);
                }
            });
            connection.on('close', () => {
                console.log('[Twilio WS] Connection closed');
                openAiWs?.close();
            });
        });
    });
    // Next.js request handler (for everything else: pages, static files, etc.)
    fastify.all('*', async (req, reply) => {
        return handle(req.raw, reply.raw).then(() => {
            reply.sent = true;
        });
    });
    // Start listening
    fastify.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
        if (err) {
            console.error('Error starting server:', err);
            process.exit(1);
        }
        console.log(`> Fastify server listening on ${address}`);
        console.log('> Next.js is ready to roll!');
        console.log(`> Using domain = ${DOMAIN} -- Remember to expose via ngrok if local!`);
    });
}
// Launch everything
buildApp().catch((err) => {
    console.error('Failed to build app:', err);
    process.exit(1);
});
