import { WebSocket } from "ws";
import dotenv from "dotenv";
import Fastify from "fastify";
import fastifyFormbody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";

dotenv.config();

const { OPENAI_API_KEY } = process.env;
if(!OPENAI_API_KEY) {
    console.error('Missing OpenAI API key. Please set it in .env file.');
    process.exit(1);
}

const fastify = Fastify();
fastify.register(fastifyFormbody);
fastify.register(fastifyWs);

const SYSTEM_MESSAGE = "You are a helpful and bubbly AI assistant who loves to chat about anything the user is interested about and is prepared to offer them facts.";
const VOICE = 'alloy';
const PORT = 5050;

fastify.get('/', async (request, reply) => {
    reply.send({message: 'Twilio Media Stream Server is running!'});
})

// set of xml instructions that tell twilio what to do with the call

fastify.all('/incoming-call', async (request, reply) => {
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                            <Response>
                                <Say>Please wait while we connect your call to the AI voice assistant.</Say>
                                <Pause length="1"/>
                                <Say>OK you can start talking!</Say>
                                <Connect>
                                    <Stream url="wss://${request.headers.host}/media-stream"/>
                                </Connect>
                            </Response>`;
    reply.type('text/xml').send(twimlResponse);
})

// proxy audio between twilio and openai realtime api

fastify.register(async(fastify) => {
    fastify.get('/media-stream', { websocket: true }, (connection, req) => {
        console.log('Client connected');

        const openAiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "OpenAI-Beta": "realtime=v1",
            }
        });

        let streamSid:any = null;

        const sendSessionUpdate = () => {
            const sessionUpdate = {
                type: "session.update",
                session: {
                    turn_detection: {type: "server_vad"}, // sets up voice activity detection
                    input_audio_format: "g711_ulaw", // required for twilio media streams
                    output_audio_format: "g711_ulaw", // required for twilio media streams
                    voice: VOICE,
                    instructions: SYSTEM_MESSAGE,
                    modalities: ["text", "audio"],
                    temperature: 0.8,
                }
            };

            console.log("Sending session update:", JSON.stringify(sessionUpdate));
            openAiWs.send(JSON.stringify(sessionUpdate));
        };

        openAiWs.on("open", () => {
            console.log("Connected to OpenAI realtime API");
            setTimeout(sendSessionUpdate, 1000);
        });

        openAiWs.on("message", (data:string) => {
            try {
                const response = JSON.parse(data);

                if (response.type === "session.updated") {
                    console.log("Session updated successfully:", response);
                }

                if (response.type === "response.audio.delta" && response.delta){
                    const audioDelta = {
                        event: "media",
                        streamSid: streamSid,
                        media: {
                            payload: Buffer.from(response.delta, "base64").toString("base64"),
                        }
                    };
                    connection.send(JSON.stringify(audioDelta));
                }
            } catch (error) {
                console.error("Error processing OpenAI message:", error, "Raw message:", data);
            }
        });

        connection.on("message", (message:string) => {
            try {
                const data = JSON.parse(message);

                switch(data.event){
                    case "start":
                        streamSid = data.start.streamSid;
                        console.log("Incoming stream has started", streamSid);
                        break;
                    case "media":
                        if (openAiWs.readyState === WebSocket.OPEN) {
                            const audioAppend = {
                                type: "input_audio_buffer.append",
                                audio: data.media.payload,
                            };

                            openAiWs.send(JSON.stringify(audioAppend));
                        }
                        break;
                    default:
                        console.log("Received non-media content: ", data.event);
                }
            } catch (error) {
                console.error("Error parsing message: ", error, "Message: ", message);
            }
        })

        connection.on("close", () => {
            if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
            console.log("Client disconnected.");
        });

        connection.on("close", () => {
            console.log("Disconnected from OpenAI realtime API.");
        });

        connection.on("error", (error) => {
            console.error("Error in OpenAI websocket:", error);
        });
    });
});

fastify.listen({ port: PORT }, (err) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Server is listening on port ${PORT}`);
})