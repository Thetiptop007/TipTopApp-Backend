const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');

const MODEL_ID = process.env.ANTHROPIC_MODEL || 'claude-3-haiku-20240307';

let client = null;

function getClient() {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY not set');
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

async function completePrompt(prompt, system = 'You are a helpful assistant.') {
  const anthropic = getClient();
  logger.info(`AI completion requested with model: ${MODEL_ID}`);
  const resp = await anthropic.messages.create({
    model: MODEL_ID,
    max_tokens: 512,
    temperature: 0.3,
    system,
    messages: [
      { role: 'user', content: prompt }
    ]
  });
  const text = resp?.content?.[0]?.text || '';
  return { model: MODEL_ID, text };
}

module.exports = {
  completePrompt,
};
