import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import { WebSocket } from 'ws';
import * as dotenv from 'dotenv';
import * as path from 'path';
import twilio from 'twilio';
import next from 'next';
import OpenAI from 'openai';
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

dotenv.config({ path: path.join(__dirname, '.env.local') });

const CallAnalysisSchema = z.object({
  sentiment: z.enum(["positive", "neutral", "negative"]),
  summary: z.string(),
  tag: z.string(),
});

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

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

const DOMAIN = rawDomain.replace(/(^\w+:|^)\/\//, '').replace(/\/+$/, '');
const PORT = parseInt(rawPort || '3000', 10);

let lastFlowDefinition: FlowDefinition | null = null;
let currentSpeaker = 'Assistant';

interface CallInfo {
  flowDefinition: FlowDefinition;
  callLogId: number;  // Add this
  summary?: string;
  transcript?: string;
  isComplete?: boolean;
  callEndTime?: Date;
}
const callsData = new Map<string, CallInfo>();

interface FlowDefinition {
  toPhone: string;
  greeting: string;
  topic: string;
  ending: string;
  questions: string[];
  businessInfo: string;
  callLogId: number;  // Add this
}

function buildSystemMessage(flow: FlowDefinition): string {
  return `
    You are a helpful, positive AI phone agent representing a business on a phone call with a customer. Your goal is to assist customers effectively while staying polite, empathetic, and engaging. Here is the context of your role:
    - **Business Overview**: ${flow.businessInfo}.
    - **Call Purpose**: ${flow.topic}.
    - **Mandatory Flow**:
    1. Start by warmly greeting the customer with: "${flow.greeting}". Introduce yourself as an AI helper for the company. Wait for the user to respond before moving on. DO NOT SAY ANYTHING ELSE UNTIL THE USER HAS RESPONSED TO THIS.
    2. Ask the following required questions in order, one at a time. Let the user respond to each question before asking the next: ${flow.questions.join('; ')}
    3. Conclude the call with:  "${flow.ending}"

    Before asking a question, use a transition to make the customer feel comfortable. Example:
    - "I’d like to ask a few quick questions to ensure we’re on the same page."
    - "This next question will help us serve you better."

    Be flexible in tone but stay focused on the call objectives.
    Address the customer by name ONLY IF YOU KNOW THEIR NAME during the conversation to make the interaction more personal.

    ### Key Rules:
    1. **Tone**: Always remain friendly, empathetic, and conversational. Speak in a natural, human-like manner, avoiding overly robotic phrasing.
    2. **User Guidance**: If the customer asks unrelated questions, politely redirect the conversation back to the main topic. If you cannot answer, apologize and recommend contacting the business for details.
    3. **Customer Experience**: Recognize user frustration or happiness through their tone and adjust your responses to match their mood. Always start with a warm, inviting tone. If the customer is known (based on name or history), acknowledge them by name.
    4. **Transparency**: If unsure of something, clearly state: "I’m not sure about that, but the business can assist you further."
    5. **Efficiency**: Ensure all required questions are answered while maintaining conversational flow. Don’t skip questions, even if the customer seems ready to end the call.
    6. **Flagging**: If the user says they want to speak to a human,  inform them that you will transfer them to a human representative to reach back to you. Then, end the call.
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
async function makeCall(to: string): Promise<string | undefined> {
  try {
      const allowed = await isNumberAllowed(to);
      if (!allowed) {
          console.warn(`Number ${to} is not recognized or not allowed to be called.`);
          return undefined;
      }
      const call = await twilioClient.calls.create({
          from: PHONE_NUMBER_FROM,
          to,
          twiml: outboundTwiML,
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
  fastify.post('/api/outbound-call', async (req, reply) => {
    const flow = req.body;
    if (!flow?.toPhone || !flow?.callLogId) {
        return reply.status(400).send({ error: 'Missing required fields in request' });
    }

    const sid = await makeCall(flow.toPhone);
    if (!sid) {
        console.warn(`Failed to start call to ${flow.toPhone}. Updating database...`);
        await prisma.callLog.update({
            where: { id: flow.callLogId },
            data: { 
                status: 'error', 
                summary: 'Failed to initiate call',
            },
        });
        return reply.status(400).send({ error: `Unable to call ${flow.toPhone}` });
    }

    lastFlowDefinition = flow;

    await prisma.callLog.update({
        where: { id: flow.callLogId },
        data: {
            startTime: new Date(),
            status: 'in-progress',
        },
    });

    callsData.set(sid, { 
        flowDefinition: flow, 
        callLogId: flow.callLogId,
    });

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
    
    console.log('Sending transcript for callSid:', callSid);
    console.log('Transcript content:', info.transcript);
    
    return reply.status(200).send({
      transcript: info.transcript || null,
      isComplete: info.isComplete || false
    });
  });

  /**
   * /media-stream (WebSocket)
   * Twilio => Our server => OpenAI => Twilio.
   * A real-time conversation that uses VAD for back-and-forth.
   */
  fastify.register(async (fInstance) => {
    fInstance.get("/media-stream", { websocket: true }, (connection, req) => {
      console.log("[Twilio] media-stream connected");
  
      let callSid;
      let openAiWs = null;
      let streamSid = null;
      let conversationTextLog = "";
  
      // OpenAI WebSocket connection
      openAiWs = new WebSocket(
        "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01",
        {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "OpenAI-Beta": "realtime=v1"
          }
        }
      );
  
      openAiWs.on("open", () => {
        console.log("[OpenAI] WS connected");
        if (!lastFlowDefinition) {
          console.warn("No FlowDefinition found, the AI might not have instructions...");
        }
  
        setTimeout(() => {
          const sessionUpdate = {
            type: "session.update",
            session: {
              turn_detection: {
                type: "server_vad",
                threshold: 0.8,
                prefix_padding_ms: 0,
                silence_duration_ms: 2000,
                create_response: true,
              },
              input_audio_format: "g711_ulaw",
              output_audio_format: "g711_ulaw",
              input_audio_transcription: { model: "whisper-1" },
              voice: "alloy",
              instructions: lastFlowDefinition
                ? buildSystemMessage(lastFlowDefinition)
                : "No instructions found...",
              modalities: ["text", "audio"],
              temperature: 0.6,
            },
          };
    
          openAiWs.send(JSON.stringify(sessionUpdate));
          console.log("[OpenAI] Session update sent after 1-second delay.");
        }, 1000);
      });
  
      openAiWs.on("message", (raw) => {
        try {
          const response = JSON.parse(raw.toString());
      
          if (LOG_EVENT_TYPES.includes(response.type)) {
            console.log(`[OpenAI] ${response.type}`, response);
          }

          if (response.type === "input_audio_buffer.speech_started") {
            console.log("[OpenAI] User started speaking, interrupting AI response...");
      
            // Clear Twilio buffer
            const clearTwilio = {
              streamSid,
              event: "clear", // Clear Twilio's buffer
            };
            connection.send(JSON.stringify(clearTwilio));
      
            // Cancel current AI response
            const interruptMessage = {
              type: "response.cancel", // Stop AI response
            };
            isResponding = false;
            openAiWs.send(JSON.stringify(interruptMessage));
            console.log("[OpenAI] AI response canceled.");

            openAiWs.send(JSON.stringify({ type: "response.create" }));
            console.log("[OpenAI] Ready for next input.");
          }
      
          // Update log for user input transcription
          if (response.type === "conversation.item.input_audio_transcription.completed" && response.transcript) {
            conversationTextLog += `User: ${response.transcript.trim()}\n`;
            if (callSid && callsData.has(callSid)) {
              const info = callsData.get(callSid);
              info.transcript = conversationTextLog.trim();
              callsData.set(callSid, info);
            }
          }
      
          // Update log for assistant responses
          if (response.type === "response.audio_transcript.done" && response.transcript) {
            conversationTextLog += `Assistant: ${response.transcript.trim()}\n`;
            if (callSid && callsData.has(callSid)) {
              const info = callsData.get(callSid);
              info.transcript = conversationTextLog.trim();
              callsData.set(callSid, info);
      
              // Update transcript in database but don't mark as complete
              const updateTranscript = async () => {
                try {
                  await prisma.callLog.update({
                    where: { id: info.callLogId },
                    data: {
                      transcript: conversationTextLog.trim()
                    }
                  });
                } catch (err) {
                  console.error("Error updating transcript:", err);
                }
              };
              updateTranscript();
            }
          }
      
          // Stream audio to Twilio if provided
          if (response.type === "response.audio.delta" && response.delta) {
            const audioDelta = {
              event: "media",
              streamSid,
              media: { payload: Buffer.from(response.delta, "base64").toString("base64") }
            };
            connection.send(JSON.stringify(audioDelta));
          }
        } catch (err) {
          console.error("[OpenAI] Error processing message:", err);
        }
      });
      let isCallComplete = false;
      connection.on("message", (msg) => {
        try {
          const data = JSON.parse(msg.toString());
  
          switch (data.event) {
            case "start":
              streamSid = data.start.streamSid;
              callSid = data.start.callSid;
              console.log("[Twilio WS] Stream started with callSid:", callSid);
              break;
  
            case "media":
              if (openAiWs && openAiWs.readyState === WebSocket.OPEN) {
                const audioAppend = {
                  type: "input_audio_buffer.append",
                  audio: data.media.payload
                };
                openAiWs.send(JSON.stringify(audioAppend));
              }
              break;
  
              case "stop":
                console.log("[Twilio WS] Stream stopped.");
                isCallComplete = true;
                if (callSid && callsData.has(callSid)) {
                  const info = callsData.get(callSid);
                  info.isComplete = true;
                  
                  const updateCallLog = async () => {
                    try {
                      await prisma.callLog.update({
                        where: { id: info.callLogId },
                        data: {
                          status: "completed",
                          transcript: conversationTextLog.trim(),
                          endTime: new Date()  // Add end time when call completes
                        }
                      });
                    } catch (err) {
                      console.error("Error updating call log on completion:", err);
                    }
                  };
                  updateCallLog();
                }
                break;
  
            default:
              console.log("[Twilio WS] Unhandled event:", data.event);
          }
        } catch (err) {
          console.error("[Twilio WS] Error processing message:", err);
        }
      });
  
      connection.on("close", () => {
        console.log("[Twilio WS] Connection closed");
        openAiWs?.close();
      });
    });
  });
  
  /**
   * POST /api/analyze-call
   * Analyze a transcript using OpenAI API.
   */
  
fastify.post('/api/analyze-call', async (req: FastifyRequest<{ Body: { transcript: string } }>, reply: FastifyReply) => {
  const { transcript } = req.body;

  if (!transcript) {
    return reply.status(400).send({ error: 'Missing "transcript" in request body.' });
  }

  try {
    // Use structured outputs for analysis
    const completion = await openai.beta.chat.completions.parse({
      model: 'gpt-4o-2024-08-06',
      messages: [
        { role: 'system', content: 'You are an assistant that analyzes call transcripts and an expert at structured data extraction. You will be given unstructured transcript from a customer service call and should convert it into the given structure. When converting, talk from the perspective of the assistant.' },
        {
          role: 'user',
          content: `Analyze the following transcript. Provide the sentiment of the customer throughout the call in one word (positive, neutral, negative), a brief summary of the call with the next steps the business should take with respect to this customer and call topic, and one short but relevant tag describing the call in less than 3 words ("needs follow up", "interested in blank", etc). If the customer indicated that they wanted to speak with a human, your flag for this call should simply be "Needs Review":\n\n"${transcript}"`,
        },
      ],
      response_format: zodResponseFormat(CallAnalysisSchema, "call_analysis"),
    });

    const analysis = completion.choices[0]?.message.parsed;

    if (!analysis) {
      return reply.status(500).send({ error: 'Failed to parse the analysis result.' });
    }

    return reply.status(200).send(analysis);
  } catch (error) {
    console.error('Error analyzing transcript:', error);
    return reply.status(500).send({ error: 'Internal server error', details: error.message });
  }
});

fastify.post('/api/business-signup', async (req: FastifyRequest, reply: FastifyReply) => {
  const { name, phone, location, description, hours, employees } = req.body;

  try {
    const business = await prisma.business.create({
      data: {
        name,
        phone,
        location,
        description,
        hours: {
          createMany: {
            data: hours.map((hour) => ({
              dayOfWeek: hour.dayOfWeek,
              openTime: hour.openTime,
              closeTime: hour.closeTime,
            })),
          },
        },
        employees: {
          createMany: {
            data: employees.map((employee) => ({
              name: employee.name,
              role: employee.role,
            })),
          },
        },
      },
      include: {
        hours: true,
        employees: true,
      },
    });

    // Create employee hours
    for (const [index, employee] of employees.entries()) {
      await prisma.hours.createMany({
        data: employee.hours.map((hour) => ({
          dayOfWeek: hour.dayOfWeek,
          openTime: hour.openTime,
          closeTime: hour.closeTime,
          employeeId: business.employees[index].id,
        })),
      });
    }

    return reply.status(201).send(business);
  } catch (error) {
    console.error('Error creating business:', error);
    return reply.status(500).send({ error: 'Internal server error' });
  }
});

fastify.get('/api/business-info', async (req: FastifyRequest<{ Querystring: { name: string } }>, reply: FastifyReply) => {
  const { name } = req.query;

  if (!name) {
    return reply.status(400).send({ error: 'Business name is required.' });
  }

  try {
    // Query the database for the business and its related information
    const business = await prisma.business.findFirst({
      where: { name },
      include: {
        hours: true,
        employees: {
          include: {
            hours: true, // Include employee-specific hours
          },
        },
        customers: true, // Include related customers
      },
    });

    if (!business) {
      return reply.status(404).send({ error: 'Business not found.' });
    }

    return reply.status(200).send(business);
  } catch (error) {
    console.error('Error fetching business info:', error);
    return reply.status(500).send({ error: 'Internal server error.' });
  }
});

fastify.get('/api/business-names', async (req, reply) => {
  try {
    const businesses = await prisma.business.findMany({
      select: { name: true }, // Only fetch business names
    });

    return reply.status(200).send(businesses);
  } catch (error) {
    console.error("Error fetching business names:", error);
    return reply.status(500).send({ error: "Internal server error." });
  }
});

fastify.post('/api/add-customer', async (req, reply) => {
  const { name, phone, businessId } = req.body;

  if (!name || !phone || !businessId) {
    return reply.status(400).send({ error: "Missing required fields." });
  }

  try {
    // Add the customer to the database
    const customer = await prisma.customer.create({
      data: {
        name,
        phone,
        businessId,
      },
    });

    // Fetch the updated business with customers
    const updatedBusiness = await prisma.business.findUnique({
      where: { id: businessId },
      include: {
        hours: true,
        employees: { include: { hours: true } },
        customers: true,
      },
    });

    return reply.status(200).send(updatedBusiness);
  } catch (error) {
    console.error('Error adding customer:', error);
    return reply.status(500).send({ error: 'Internal server error.' });
  }
});


fastify.post('/api/add-intent', async (req: FastifyRequest<{ Body: { 
  businessName: string, 
  name: string,
  greetingMessage: string, 
  conversationTopic: string, 
  endingMessage: string, 
  questions: string[], 
  businessInfo: string 
} }>, reply: FastifyReply) => {
  const { businessName, name, greetingMessage, conversationTopic, endingMessage, questions, businessInfo } = req.body;

  if (!businessName || !name || !greetingMessage || !conversationTopic || !endingMessage || !questions || !businessInfo) {
    return reply.status(400).send({ error: "Missing required fields." });
  }

  try {
    // Find the business by name
    const business = await prisma.business.findUnique({
      where: { name: businessName },
    });

    if (!business) {
      return reply.status(404).send({ error: "Business not found." });
    }

    // Create the intent
    const intent = await prisma.intent.create({
      data: {
        name, // Include the name field
        greetingMessage,
        conversationTopic,
        endingMessage,
        questions,
        businessInfo,
        businessId: business.id,
      },
    });

    return reply.status(201).send(intent);
  } catch (error) {
    console.error("Error creating intent:", error);
    return reply.status(500).send({ error: "Internal server error." });
  }
});

/**
 * GET /api/get-intents
 * Retrieve all intents associated with a business name
 */
fastify.get('/api/get-intents', async (req: FastifyRequest<{ Querystring: { businessName: string } }>, reply: FastifyReply) => {
  const { businessName } = req.query;

  if (!businessName) {
    return reply.status(400).send({ error: "Business name is required." });
  }

  try {
    // Find the business by name
    const business = await prisma.business.findUnique({
      where: { name: businessName },
      include: {
        intents: true, // Include intents in the response
      },
    });

    if (!business) {
      return reply.status(404).send({ error: "Business not found." });
    }

    return reply.status(200).send(business.intents);
  } catch (error) {
    console.error("Error retrieving intents:", error);
    return reply.status(500).send({ error: "Internal server error." });
  }
});

fastify.post("/api/add-call-log", async (req, reply) => {
  const { name, phone, intentName, status, businessId } = req.body;

  try {
    const callLog = await prisma.callLog.create({
      data: {
        name,
        phoneNumber: phone,
        intentName,
        status,
        businessId,
      },
    });

    return reply.status(201).send(callLog);
  } catch (error) {
    console.error("Error adding call log:", error);
    return reply.status(500).send({ error: "Internal server error" });
  }
});

fastify.get('/api/call-status', async (req: FastifyRequest<{ Querystring: { callSid: string } }>, reply: FastifyReply) => {
  const { callSid } = req.query;

  try {
    const call = callsData.get(callSid);
    if (!call) {
      return reply.status(404).send({ error: "Call not found" });
    }

    // Get current call log status from database
    const callLog = await prisma.callLog.findUnique({
      where: { id: call.callLogId }
    });

    return reply.status(200).send({
      isComplete: callLog?.status === "completed",
      transcript: call.transcript || "",
      callLogId: call.callLogId,
      status: callLog?.status
    });
  } catch (error) {
    console.error("Error checking call status:", error);
    return reply.status(500).send({ error: "Internal server error" });
  }
});

fastify.put("/api/update-call-log/:id", async (req, reply) => {
  const { id } = req.params;
  const { status, transcript, sentiment, summary, flag } = req.body;

  try {
    const updatedCallLog = await prisma.callLog.update({
      where: { id: parseInt(id, 10) },
      data: {
        status,
        transcript,
        sentiment,
        summary,
        flag,
      },
    });

    return reply.status(200).send(updatedCallLog);
  } catch (error) {
    console.error("Error updating call log:", error);
    return reply.status(500).send({ error: "Internal server error" });
  }
});

fastify.get("/api/get-call-logs", async (req, reply) => {
  try {
    const logs = await prisma.callLog.findMany();
    console.log("Fetched call logs:", logs);
    return reply.status(200).send(logs);
  } catch (error) {
    console.error("Error fetching call logs:", error);
    return reply.status(500).send({ error: "Internal server error." });
  }
});

fastify.get("/api/get-intent-info", async (req, reply) => {
  const { intentName } = req.query;

  try {
    const intent = await prisma.intent.findUnique({
      where: { name: intentName },
    });

    if (!intent) {
      return reply.status(404).send({ error: "Intent not found" });
    }

    return reply.status(200).send(intent);
  } catch (error) {
    console.error("Error fetching intent info:", error);
    return reply.status(500).send({ error: "Internal server error" });
  }
});



  fastify.get('/api/test', async (req, reply) => {
    return reply.status(200).send({ message: 'Hello, world! The server is running.' });
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