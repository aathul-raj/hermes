import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import { WebSocket } from 'ws';
import * as dotenv from 'dotenv';
import * as path from 'path';
import twilio from 'twilio';
import next from 'next';

dotenv.config({ path: path.join(__dirname, '.env.local') });

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  DOMAIN: rawDomain,
  OPENAI_API_KEY,
  PORT: rawPort,
  PHONE_NUMBER_FROM
} = process.env;
if (!PHONE_NUMBER_FROM) {
  throw new Error('PHONE_NUMBER_FROM is not defined in env vars.');
}
if (
  !TWILIO_ACCOUNT_SID ||
  !TWILIO_AUTH_TOKEN ||
  !PHONE_NUMBER_FROM ||
  !rawDomain ||
  !OPENAI_API_KEY
) {
  console.error('Missing required environment variables.');
  process.exit(1);
}

const DOMAIN = rawDomain.replace(/(^\w+:|^)\/\//, '').replace(/\/+$/, '');
const PORT = parseInt(rawPort || '3000', 10);

let lastFlowDefinition: FlowDefinition | null = null;

interface CallInfo {
  flowDefinition: FlowDefinition;
  summary?: string;
  isComplete?: boolean;
}
const callsData = new Map<string, CallInfo>();

interface FlowDefinition {
  toPhone: string;
  greeting: string;
  topic: string;
  ending: string;
  questions: string[];
  businessInfo: string;
}

function buildSystemMessage(flow: FlowDefinition): string {
  return `
    You are a helpful, positive AI phone agent representing a business. Use the following info if needed, about the business:
    ${flow.businessInfo}.

    The conversation you will be having with the user is about: ${flow.topic}.
    You MUST greet the user by saying: "${flow.greeting}"

    Then at some point, please ask:
      ${flow.questions.join('; ')}

    Make SURE you ask every single one of those questions. Do not skip a single one.
    Finally, end the call with: "${flow.ending}"

    Be polite, helpful, and keep the user engaged. Do not sound too much like a robot.
    If the user asks questions, answer them accurately to the best of your abilities. If they ask a question that you do not know 
    the answer to, explicitly say that you do not know and that they should contact the business directly for more information.
    Use your knowledge cutoff and do the best job you can. Do not let the user distract you from the main goals of this conversation.
    If they attempt to change the topic of conversation or ask unrelated questions, politely steer the conversation back to the main topic.
  `;
}

// Twilio setup
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// TwiML for the outbound call -> instruct Twilio to open a media stream:
const outboundTwiML = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${DOMAIN}/media-stream" />
  </Connect>
</Response>`;

// We’ll log these OpenAI Realtime events
const LOG_EVENT_TYPES = [
  'error',
  'response.content.done',
  'rate_limits.updated',
  'response.done',
  'input_audio_buffer.committed',
  'input_audio_buffer.speech_stopped',
  'input_audio_buffer.speech_started',
  'session.created',
  'session.updated'
];

/** Check if a phone number is allowed to call. */
async function isNumberAllowed(to: string): Promise<boolean> {
  try {
    const incomingNumbers = await twilioClient.incomingPhoneNumbers.list({ phoneNumber: to });
    if (incomingNumbers.length > 0) return true;

    const outgoingCallerIds = await twilioClient.outgoingCallerIds.list({ phoneNumber: to });
    if (outgoingCallerIds.length > 0) return true;

    return false;
  } catch (err) {
    console.error('Error checking phone number:', err);
    return false;
  }
}

/** Actually place the outbound call */
async function makeCall(to: string): Promise<string|undefined> {
  try {
    const allowed = await isNumberAllowed(to);
    if (!allowed) {
      console.warn(`Number ${to} is not recognized or not allowed to be called.`);
      return undefined;
    }
    const call = await twilioClient.calls.create({
      from: PHONE_NUMBER_FROM,
      to,
      twiml: outboundTwiML
    });
    console.log('Call started. SID =', call.sid);
    return call.sid;
  } catch (err) {
    console.error('Error making call:', err);
    return undefined;
  }
}

/** Build & run Fastify + Next.js */
async function buildApp() {
  const dev = process.env.NODE_ENV !== 'production';
  const nextApp = next({ dev });
  const handle = nextApp.getRequestHandler();
  await nextApp.prepare();

  const fastify: FastifyInstance = Fastify();
  fastify.register(fastifyFormBody);
  fastify.register(fastifyWs);

  /**
   * POST /api/outbound-call
   * Accept a FlowDefinition from the user, place the call, store instructions
   */
  fastify.post('/api/outbound-call', async (req: FastifyRequest<{ Body: FlowDefinition }>, reply: FastifyReply) => {
    const flow = req.body;
    if (!flow?.toPhone) {
      return reply.status(400).send({ error: 'Missing "toPhone" in request' });
    }

    const sid = await makeCall(flow.toPhone);
    if (!sid) {
      return reply.status(400).send({ error: `Unable to call ${flow.toPhone}` });
    }

    lastFlowDefinition = flow;

    // Also store it in a map keyed by sid for final summary
    callsData.set(sid, { flowDefinition: flow });
    console.log(`Stored FlowDefinition for callSid = ${sid}`);

    return reply.status(200).send({ callSid: sid });
  });

  /**
   * GET /api/call-summary?callSid=xxx
   * Return final summary after the call
   */
  fastify.get('/api/call-summary', async (req: FastifyRequest<{ Querystring: { callSid: string } }>, reply: FastifyReply) => {
    const { callSid } = req.query;
    if (!callSid) {
      return reply.status(400).send({ error: 'callSid required' });
    }
    const info = callsData.get(callSid);
    if (!info) {
      return reply.status(404).send({ error: 'No info found for that callSid' });
    }
    return reply.status(200).send({
      summary: info.summary || null,
      isComplete: info.isComplete || false
    });
  });

  /**
   * /media-stream (WebSocket)
   * Twilio => Our server => OpenAI => Twilio.
   * A real-time conversation that uses VAD for back-and-forth.
   */
  fastify.register(async (fInstance) => {
    fInstance.get('/media-stream', { websocket: true }, (connection, req) => {
      console.log('[Twilio] media-stream connected');

      // We'll discover callSid from "start" event
      let callSid: string | undefined;
      let openAiWs: WebSocket | null = null;
      let streamSid: string | null = null;
      let conversationTextLog = '';

      // 1) Connect to OpenAI Realtime
      openAiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'OpenAI-Beta': 'realtime=v1'
        }
      });

      // 2) Once the OpenAI WS is open, set up the session
      openAiWs.on('open', () => {
        console.log('[OpenAI] WS connected');
        if (!lastFlowDefinition) {
          console.warn('No FlowDefinition found, the AI might not have instructions...');
        }

        // We enable turn detection, let the user speak, and we use openai STT
        // so the AI sees the user's words as conversation items. The AI
        // automatically produces a new response after the user finishes speaking.
        const sessionUpdate = {
          type: 'session.update',
          session: {
            // Enable server-based VAD so we get user turns
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 2000,
              create_response: true,
            },
            input_audio_format: 'g711_ulaw',
            output_audio_format: 'g711_ulaw',
            input_audio_transcription: { model: 'whisper-1' },
            voice: 'alloy',
            instructions: lastFlowDefinition ? buildSystemMessage(lastFlowDefinition) : 'No instructions found...',
            modalities: ['text', 'audio'],
            temperature: 0.7
          }
        };
        openAiWs!.send(JSON.stringify(sessionUpdate));

        if (lastFlowDefinition?.greeting) {
          const greeting = lastFlowDefinition.greeting;
          const greetingMsg = {
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: greeting }]
            }
          };
          openAiWs!.send(JSON.stringify(greetingMsg));
          openAiWs!.send(JSON.stringify({ type: 'response.create' }));
        }
      });

      // 3) Listen for messages from OpenAI
      openAiWs.on('message', (raw) => {
        try {
          const response = JSON.parse(raw.toString());
          if (LOG_EVENT_TYPES.includes(response.type)) {
            console.log(`[OpenAI] ${response.type}`, response);
          }
          if (response.type === 'input_audio_buffer.speech_started') {
            console.log('[OpenAI] The user started talking => cancel AI speech');
            // 1) Send "response.cancel" to OpenAI
            const interruptMessage = { type: 'response.cancel' };
            openAiWs!.send(JSON.stringify(interruptMessage));

            // 2) Send "clear" event to Twilio so it stops playing the half-said AI response
            const clearTwilio = {
              event: 'clear', // Not an official Twilio event, but we can handle it
              streamSid: streamSid
            };
            connection.send(JSON.stringify(clearTwilio));
            console.log('[OpenAI] Sent response.cancel, told Twilio to "clear" buffer');
          }
          // If the AI is sending audio, forward to Twilio
          if (response.type === 'response.audio.delta' && response.delta) {
            const audioDelta = {
              event: 'media',
              streamSid,
              media: { payload: Buffer.from(response.delta, 'base64').toString('base64') }
            };
            connection.send(JSON.stringify(audioDelta));
          }

          // Collect textual output for summary
          if (response.type === 'response.text' && response.text) {
            conversationTextLog += response.text + '\n';
          }

          // If the AI finishes a response, near the end of call we do a summary request
          if (response.type === 'response.done') {
            // Possibly ask for a short summary. Or do it on call end. 
            // We'll do it now:
            // const summaryReq = {
            //   type: 'conversation.item.create',
            //   item: {
            //     type: 'message',
            //     role: 'user',
            //     content: [
            //       { type: 'input_text', text: 'Give me a quick bullet summary of the conversation so far.' }
            //     ]
            //   }
            // };
            // openAiWs?.send(JSON.stringify(summaryReq));
            // openAiWs?.send(JSON.stringify({ type: 'response.create' }));
          }

          // If the AI returns more text after the summary request
          if (response.type === 'response.text.done') {
            const finalSummary = conversationTextLog.trim();
            if (callSid && callsData.has(callSid)) {
              const info = callsData.get(callSid)!;
              info.summary = finalSummary;
              info.isComplete = true;
              callsData.set(callSid, info);
            }
            console.log('[OpenAI] Final summary:\n', finalSummary);
          }
        } catch (err) {
          console.error('[OpenAI] Error on message:', err);
        }
      });

      openAiWs.on('error', (err) => console.error('[OpenAI] WS error:', err));
      openAiWs.on('close', () => console.log('[OpenAI] WS closed'));

      //
      // 4) Handle Twilio -> Our server messages
      //
      connection.on('message', (msg) => {
        try {
          const data = JSON.parse(msg.toString());

          switch (data.event) {
            case 'connected':
              console.log('[Twilio WS] connected');
              break;

            case 'start':
              streamSid = data.start.streamSid;
              console.log(`[Twilio WS] Stream started, SID = ${streamSid}`);
              callSid = data.start.callSid;
              console.log('[Twilio WS] callSid =', callSid);
              break;

            case 'media':
              // Forward user audio to OpenAI
              if (openAiWs && openAiWs.readyState === WebSocket.OPEN) {
                const audioAppend = {
                  type: 'input_audio_buffer.append',
                  audio: data.media.payload
                };
                openAiWs.send(JSON.stringify(audioAppend));
              }
              break;

            case 'stop':
              console.log('[Twilio WS] stop => call ended?');
              break;

            default:
              console.log('[Twilio WS] Non-media event:', data.event);
          }
        } catch (err) {
          console.error('[Twilio WS] Error parsing message:', err);
        }
      });

      // Close
      connection.on('close', () => {
        console.log('[Twilio WS] Connection closed');
        openAiWs?.close();
      });
    });
  });

  // Next.js routes
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
    console.log(`> Next.js is ready on port ${PORT}`);
    console.log(`> Domain = ${DOMAIN} (expose via ngrok if local!)`);
  });
}

// Launch
buildApp().catch((err) => {
  console.error('Failed to build app:', err);
  process.exit(1);
});
