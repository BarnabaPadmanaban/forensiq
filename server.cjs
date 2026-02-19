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

    console.log("Calling Groq API...");

    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: fullPrompt }],
        temperature: 0.4,
        max_tokens: 2048,
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        }
      }
    );

    const text = response.data?.choices?.[0]?.message?.content || "";
    console.log("Groq response received, length:", text.length);
    res.json({ text });

  } catch (error) {
    const errMsg = error.response?.data?.error?.message || error.message;
    const errStatus = error.response?.status || 500;
    console.error("Groq Error:", errStatus, errMsg);
    console.error("Details:", JSON.stringify(error.response?.data, null, 2));
    res.status(errStatus).json({ error: errMsg });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    engine: 'groq',
    model: 'llama-3.3-70b-versatile',
    groqKey: process.env.GROQ_API_KEY ? '✅ Loaded' : '❌ MISSING'
  });
});

app.listen(process.env.PORT || 3001, () => {
  console.log(`✅ Server running on port ${process.env.PORT || 3001}`);
  console.log('⚡ Using Groq API — llama-3.3-70b-versatile (free & fast)');
  console.log('🔑 Groq Key:', process.env.GROQ_API_KEY ? '✅ Loaded' : '❌ MISSING — check .env file');
});
