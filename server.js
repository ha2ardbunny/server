import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { VertexAI } from '@google-cloud/vertexai';
import { GoogleAuth } from 'google-auth-library';

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('build'));

app.post('/api/generate-summary', async (req, res) => {
  try {
    const { eventID } = req.body;

    if (!eventID) {
      return res.status(400).json({ error: 'eventID is required' });
    }

    const {
      SERVER_API,
      GOOGLE_CLOUD_PROJECT_ID: PROJECT_ID,
      GOOGLE_CLOUD_LOCATION: LOCATION,
      GOOGLE_CLOUD_ENDPOINT_ID: ENDPOINT_ID,
      GOOGLE_APPLICATION_CREDENTIALS, 
    } = process.env;

    const MODEL_NAME = 'gemini-2.0-flash-001'; 

    if (!PROJECT_ID || !LOCATION || !SERVER_API || !ENDPOINT_ID || !GOOGLE_APPLICATION_CREDENTIALS) {
      return res.status(500).json({ error: 'Missing environment variables' });
    }

    const response = await fetch(`${SERVER_API}Admin_SelectEventIntoCEF?eventID=${encodeURIComponent(eventID)}`);
    if (!response.ok) return res.status(502).json({ error: 'Failed to fetch event data' });

    const json = await response.json();
    if (json.Message) return res.status(500).json({ error: 'Backend API error', details: json.Message });

    const parsed = JSON.parse(json)[0];
    if (parsed.ReturnVal !== 1) return res.status(500).json({ error: 'Backend returned failure', details: parsed.ReturnSqlError });

    const eventData = JSON.parse(parsed.ReturnData)[0];
    if (!eventData) return res.status(404).json({ error: 'No event data found' });

    // Initialize Vertex AI
    const vertexAI = new VertexAI({
      project: PROJECT_ID,
      location: LOCATION,
    });

    // Get generative model
    const model = vertexAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.9,
        topP: 1,
      },
    });

    // Construct the prompt correctly
    const prompt = `You are an intelligent event summarizer. Based on the following JSON data, generate a clear and professional summary. 
Include the key details such as time, location, event description, and any notable highlights:
${JSON.stringify(eventData, null, 2)}
Return the summary in concise, third-person English.`;

    // Generate content with proper structure
    const request = {
      contents: [{
        role: 'user',
        parts: [{ text: prompt }]
      }]
    };

    const result = await model.generateContent(request);
    const vertexResponse = await result.response;
    
    // Safely extract the response
    const summary = vertexResponse.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!summary) {
      return res.status(500).json({ 
        error: 'Empty response from Vertex AI',
        details: 'No summary text was generated'
      });
    }

    return res.json({ summary });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      error: 'Failed to generate summary', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});