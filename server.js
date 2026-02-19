const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.post('/api/gemini', async (req, res) => {
  try {
    const { prompt, systemPrompt } = req.body;

    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [{ text: fullPrompt }]
        }
      ],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 2048
      }
    };

    console.log("Calling Gemini API...");
    const response = await axios.post(url, requestBody, {
      headers: { 'Content-Type': 'application/json' }
    });

    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    console.log("Response received, length:", text.length);
    res.json({ text });

  } catch (error) {
    const errMsg = error.response?.data?.error?.message || error.message;
    const errStatus = error.response?.status || 500;
    console.error("Gemini Error", errStatus, errMsg);
    console.error("Details:", JSON.stringify(error.response?.data, null, 2));
    res.status(errStatus).json({ error: errMsg });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    geminiKey: process.env.GEMINI_API_KEY ? 'loaded' : 'MISSING'
  });
});

app.listen(3001, () => {
  console.log('✅ Gemini proxy server running on http://localhost:3001');
  console.log('🔑 API Key:', process.env.GEMINI_API_KEY ? '✅ Loaded' : '❌ MISSING');
});